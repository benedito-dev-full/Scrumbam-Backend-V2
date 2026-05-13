import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../common/services/correlation-id.service';
import { RoleResolverService } from '../../auth/services/role-resolver.service';
import { AUTOMATION_CLASS_IDS } from '../constants/automation-class-ids';
import { RemoteExecutionClient } from '../runtime/remote-execution-client';
import { SetAgentEnvDto } from './dto/set-agent-env.dto';
import { SetGitBotDto } from './dto/set-git-bot.dto';
import { EnvStatusResponseDto } from './dto/env-status-response.dto';

interface SetEnvAck {
  accepted?: unknown;
  varsWritten?: unknown;
  createdNew?: unknown;
  restartScheduled?: unknown;
}

interface AgentRuntime {
  chave: bigint;
  idLocEscritu: bigint | null;
  dados: Record<string, unknown>;
}

interface EnvStatusInDb {
  hasGithubToken: boolean;
  hasAnthropicKey: boolean;
  lastEnvUpdatedAt: string | null;
}

/**
 * Service para gestao de credenciais e identidade Git no agente via API.
 *
 * 3 operacoes:
 *  - `setEnv(agentId, dto, userId)` — escreve PAT/ANTHROPIC_KEY no env file
 *    via `SET_ENV` outbound, persiste `envStatus` em `dados`, emite
 *    `agent.env.updated`. Backend NUNCA persiste plaintext.
 *  - `getEnvStatus(agentId, userId)` — le `dados.envStatus` (sem outbound).
 *  - `setGitBot(agentId, dto, userId)` — atualiza `gitBotName/Email` em
 *    `dados`, dispara `SET_ENV` com `GIT_BOT_NAME/EMAIL`, emite
 *    `agent.gitbot.updated`.
 *
 * RBAC:
 *  - Mutacoes (PUT) requerem ADMIN da organizacao dona (`agent.idLocEscritu`
 *    quando `idClasse` da entidade pai === organizacao). Para agente
 *    standalone (`idLocEscritu` aponta para o usuario que gerou o token),
 *    apenas esse usuario tem permissao implicita.
 *  - Leitura (GET) requer apenas autenticacao JWT (membership amplo).
 *
 * @see ADR-V2-041 (Env Management via API outbound HMAC)
 */
@Injectable()
export class AgentEnvService {
  private readonly logger = new Logger(AgentEnvService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly remoteClient: RemoteExecutionClient,
    private readonly eventProducer: EventProducerService,
    private readonly correlationIdService: CorrelationIdService,
    private readonly roleResolver: RoleResolverService,
  ) {}

  /**
   * Atualiza credenciais sensiveis (PAT/ANTHROPIC_KEY) no env file do agente.
   *
   * Fluxo:
   *  1. Carrega agente (DEntidade -156, excluido=false) — 404 se nao.
   *  2. Valida RBAC: ADMIN da org dona OU dono direto (standalone).
   *  3. Monta `vars` com APENAS os campos preenchidos no DTO. Rejeita
   *     422 se nenhum campo foi enviado.
   *  4. Dispara `SET_ENV` outbound via `RemoteExecutionClient.dispatch`.
   *     Agente devolve ACK sincrono `{accepted, varsWritten, restartScheduled}`.
   *  5. Atualiza `dados.envStatus` (merge: hasGithubToken/hasAnthropicKey
   *     OR-merged com booleanos previos; `lastEnvUpdatedAt = now`).
   *  6. Emite `agent.env.updated` (APOS persistencia — Padrao #7).
   *
   * LOGS NUNCA CONTEM PLAINTEXT: o logger so registra `varsKeys` (nomes
   * das chaves enviadas) e `varsWritten` retornado pelo agente.
   *
   * @throws {NotFoundException} Agente nao existe (-156, excluido=false)
   * @throws {ForbiddenException} Usuario sem permissao (nao e ADMIN da org)
   * @throws {BadRequestException} DTO vazio (nenhum campo preenchido)
   * @throws {ServiceUnavailableException} Agente offline / HMAC falha / ACK invalido
   */
  async setEnv(
    agentId: bigint,
    dto: SetAgentEnvDto,
    userId: bigint,
  ): Promise<EnvStatusResponseDto> {
    const agent = await this.loadAgentForMutation(agentId, userId);

    const vars = this.buildVarsFromDto(dto);
    if (Object.keys(vars).length === 0) {
      throw new BadRequestException(
        'Nenhuma credencial preenchida (envie pelo menos um dos campos opcionais)',
      );
    }

    const runtime = this.extractRuntime(agent);
    const correlationId = this.correlationIdService.getOrGenerate();

    // Dispara SET_ENV — agente escreve env file atomicamente + restart.
    let ack: SetEnvAck;
    try {
      ack = await this.remoteClient.dispatch<
        { vars: Record<string, string>; restartAfter: boolean },
        SetEnvAck
      >(
        'SET_ENV',
        { vars, restartAfter: true },
        {
          agent: {
            agentId: agent.chave.toString(),
            tunnelPort: runtime.tunnelPort,
            agentCommandSecretEncrypted: runtime.agentCommandSecretEncrypted,
          },
          correlationId,
        },
      );
    } catch (err) {
      this.logger.warn(
        `set-env outbound falhou agentId=${agent.chave.toString()} varsKeys=[${Object.keys(vars).join(',')}]`,
      );
      throw err;
    }

    if (ack?.accepted !== true) {
      throw new ServiceUnavailableException(
        `Agent ${agent.chave.toString()} nao confirmou SET_ENV (accepted!=true)`,
      );
    }

    // Persiste envStatus em dados (merge OR — flags so sobem para true).
    const now = new Date().toISOString();
    const previous = this.parseEnvStatus(agent.dados);
    const nextStatus: EnvStatusInDb = {
      hasGithubToken: previous.hasGithubToken || dto.githubToken !== undefined,
      hasAnthropicKey:
        previous.hasAnthropicKey ||
        dto.anthropicApiKey !== undefined ||
        dto.anthropicAuthToken !== undefined,
      lastEnvUpdatedAt: now,
    };

    await this.prisma.dEntidade.update({
      where: { chave: agent.chave },
      data: {
        dados: {
          ...agent.dados,
          envStatus: nextStatus,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    // LOG audit-friendly: NUNCA logamos plaintext, apenas nomes das chaves.
    this.logger.log(
      `set-env aplicado agentId=${agent.chave.toString()} userId=${userId.toString()} ` +
        `varsKeys=[${Object.keys(vars).join(',')}] restartScheduled=${ack?.restartScheduled === true}`,
    );

    // Emite evento APOS persistencia (Padrao #7).
    await this.eventProducer.addInternalEvent(
      'agent.env.updated',
      {
        agentId: agent.chave.toString(),
        userId: userId.toString(),
        varsKeys: Object.keys(vars),
        restartScheduled: ack?.restartScheduled === true,
      },
      correlationId,
      { source: AgentEnvService.name },
    );

    return {
      hasGithubToken: nextStatus.hasGithubToken,
      hasAnthropicKey: nextStatus.hasAnthropicKey,
      lastEnvUpdatedAt: nextStatus.lastEnvUpdatedAt,
    };
  }

  /**
   * Retorna o `envStatus` (booleanos + lastEnvUpdatedAt) sem chamada outbound.
   *
   * Permissao: qualquer usuario autenticado (decisao MVP — dados nao-sensiveis).
   *
   * @throws {NotFoundException} Agente nao existe
   */
  async getEnvStatus(agentId: bigint, _userId: bigint): Promise<EnvStatusResponseDto> {
    const agent = await this.findAgentOrThrow(agentId);
    const status = this.parseEnvStatus(agent.dados);
    return {
      hasGithubToken: status.hasGithubToken,
      hasAnthropicKey: status.hasAnthropicKey,
      lastEnvUpdatedAt: status.lastEnvUpdatedAt,
    };
  }

  /**
   * Atualiza identidade do bot Git (`gitBotName` / `gitBotEmail`) em
   * `dados`, dispara `SET_ENV` com `GIT_BOT_NAME/EMAIL`, emite
   * `agent.gitbot.updated`.
   *
   * Estes dados NAO sao sensiveis (publicos em `git log`), entao
   * persistimos plaintext em `dados` para o frontend poder mostrar os
   * valores atuais (UX).
   *
   * @throws {NotFoundException} Agente nao existe
   * @throws {ForbiddenException} Usuario sem permissao
   * @throws {ServiceUnavailableException} Agente offline / HMAC falha
   */
  async setGitBot(
    agentId: bigint,
    dto: SetGitBotDto,
    userId: bigint,
  ): Promise<{ name: string; email: string; updatedAt: string }> {
    const agent = await this.loadAgentForMutation(agentId, userId);
    const runtime = this.extractRuntime(agent);
    const correlationId = this.correlationIdService.getOrGenerate();

    const vars = {
      GIT_BOT_NAME: dto.name,
      GIT_BOT_EMAIL: dto.email,
    };

    let ack: SetEnvAck;
    try {
      ack = await this.remoteClient.dispatch<
        { vars: Record<string, string>; restartAfter: boolean },
        SetEnvAck
      >(
        'SET_ENV',
        { vars, restartAfter: true },
        {
          agent: {
            agentId: agent.chave.toString(),
            tunnelPort: runtime.tunnelPort,
            agentCommandSecretEncrypted: runtime.agentCommandSecretEncrypted,
          },
          correlationId,
        },
      );
    } catch (err) {
      this.logger.warn(`set-git-bot outbound falhou agentId=${agent.chave.toString()}`);
      throw err;
    }

    if (ack?.accepted !== true) {
      throw new ServiceUnavailableException(
        `Agent ${agent.chave.toString()} nao confirmou SET_ENV (git-bot)`,
      );
    }

    const updatedAt = new Date().toISOString();
    await this.prisma.dEntidade.update({
      where: { chave: agent.chave },
      data: {
        dados: {
          ...agent.dados,
          gitBotName: dto.name,
          gitBotEmail: dto.email,
          gitBotUpdatedAt: updatedAt,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `set-git-bot aplicado agentId=${agent.chave.toString()} userId=${userId.toString()} ` +
        `name=${dto.name} email=${dto.email}`,
    );

    await this.eventProducer.addInternalEvent(
      'agent.gitbot.updated',
      {
        agentId: agent.chave.toString(),
        userId: userId.toString(),
        name: dto.name,
        email: dto.email,
      },
      correlationId,
      { source: AgentEnvService.name },
    );

    return { name: dto.name, email: dto.email, updatedAt };
  }

  // ---------- Helpers privados ----------

  /**
   * Filtra o DTO para o shape `Record<string,string>` esperado pelo agente.
   * Apenas campos definidos (`!== undefined`) viram chaves no payload.
   */
  private buildVarsFromDto(dto: SetAgentEnvDto): Record<string, string> {
    const vars: Record<string, string> = {};
    if (dto.githubToken !== undefined) vars.GITHUB_TOKEN = dto.githubToken;
    if (dto.anthropicApiKey !== undefined) vars.ANTHROPIC_API_KEY = dto.anthropicApiKey;
    if (dto.anthropicAuthToken !== undefined) vars.ANTHROPIC_AUTH_TOKEN = dto.anthropicAuthToken;
    return vars;
  }

  private parseEnvStatus(dados: Record<string, unknown>): EnvStatusInDb {
    const raw = (dados.envStatus as Record<string, unknown> | undefined) ?? {};
    return {
      hasGithubToken: raw.hasGithubToken === true,
      hasAnthropicKey: raw.hasAnthropicKey === true,
      lastEnvUpdatedAt:
        typeof raw.lastEnvUpdatedAt === 'string' ? (raw.lastEnvUpdatedAt as string) : null,
    };
  }

  /**
   * Extrai `tunnelPort` e `agentCommandSecretEncrypted` do `dados` do agente.
   * Falha 503 se algum esta ausente (estado invalido — agente nunca instalou).
   */
  private extractRuntime(agent: AgentRuntime): {
    tunnelPort: number;
    agentCommandSecretEncrypted: string;
  } {
    const tunnelPortRaw = agent.dados.tunnelPort;
    const secretRaw = agent.dados.agentCommandSecretEncrypted;
    if (typeof tunnelPortRaw !== 'number' || !Number.isInteger(tunnelPortRaw)) {
      throw new ServiceUnavailableException(
        `Agent ${agent.chave.toString()} sem tunnelPort registrado (estado invalido)`,
      );
    }
    if (typeof secretRaw !== 'string' || secretRaw.length === 0) {
      throw new ServiceUnavailableException(
        `Agent ${agent.chave.toString()} sem agentCommandSecretEncrypted (estado invalido)`,
      );
    }
    return { tunnelPort: tunnelPortRaw, agentCommandSecretEncrypted: secretRaw };
  }

  private async findAgentOrThrow(agentId: bigint): Promise<AgentRuntime> {
    const agent = await this.prisma.dEntidade.findFirst({
      where: {
        chave: agentId,
        idClasse: AUTOMATION_CLASS_IDS.AGENT,
        excluido: false,
      },
      select: { chave: true, idLocEscritu: true, dados: true },
    });
    if (!agent) {
      throw new NotFoundException(`Agente ${agentId.toString()} nao encontrado`);
    }
    return {
      chave: agent.chave,
      idLocEscritu: agent.idLocEscritu,
      dados: (agent.dados as Record<string, unknown> | null) ?? {},
    };
  }

  /**
   * Carrega o agente e valida que `userId` pode mutar (PUT).
   *
   * Permissao:
   *  - Se `agent.idLocEscritu` aponta para uma DProject: usuario deve ser
   *    ADMIN da `project.idEstab` OU MANAGER do projeto. (Modelo legado:
   *    instalacao vinculada a projeto.)
   *  - Se `agent.idLocEscritu` aponta para uma DEntidade (organizacao):
   *    usuario deve ser ADMIN dessa org.
   *  - Se `agent.idLocEscritu` aponta para usuario (standalone): apenas
   *    o proprio dono pode mutar.
   *  - Outros casos: 403 padrao.
   *
   * Estrategia pragmatica: tentamos os 3 caminhos em ordem; o primeiro
   * que aceita retorna. Se nenhum aceita, 403.
   */
  private async loadAgentForMutation(agentId: bigint, userId: bigint): Promise<AgentRuntime> {
    const agent = await this.findAgentOrThrow(agentId);

    if (agent.idLocEscritu === null) {
      throw new ForbiddenException(
        `Agente ${agentId.toString()} sem dono (idLocEscritu=null) — bloqueado`,
      );
    }

    // 1) Tenta tratar idLocEscritu como projectId.
    const project = await this.prisma.dProject.findFirst({
      where: { chave: agent.idLocEscritu, excluido: false },
      select: { chave: true, idEstab: true },
    });
    if (project) {
      const projectRole = await this.roleResolver.getProjectRole(userId, project.chave);
      if (projectRole === 'MANAGER') return agent;

      if (project.idEstab) {
        const orgRole = await this.roleResolver.getOrgRole(userId, project.idEstab);
        if (orgRole === 'ADMIN') return agent;
      }

      throw new ForbiddenException(
        'Acesso negado: requer MANAGER do projeto dono do agent ou ADMIN da organizacao',
      );
    }

    // 2) Tenta tratar idLocEscritu como organizacao (DEntidade -152).
    const org = await this.prisma.dEntidade.findFirst({
      where: {
        chave: agent.idLocEscritu,
        excluido: false,
      },
      select: { chave: true, idClasse: true },
    });
    if (org) {
      // ORGANIZATION = -152 (canonico V2). Se for org, valida ADMIN role.
      // Standalone (idLocEscritu aponta para usuario, idClasse -150): so
      // o proprio user pode.
      const orgRole = await this.roleResolver.getOrgRole(userId, org.chave);
      if (orgRole === 'ADMIN') return agent;

      // Standalone: agent.idLocEscritu === userId
      if (org.chave === userId) return agent;

      throw new ForbiddenException(
        'Acesso negado: requer ADMIN da organizacao dona do agent ou ser o instalador (standalone)',
      );
    }

    throw new ForbiddenException(
      `Agente ${agentId.toString()} com dono invalido (idLocEscritu nao resolve)`,
    );
  }
}
