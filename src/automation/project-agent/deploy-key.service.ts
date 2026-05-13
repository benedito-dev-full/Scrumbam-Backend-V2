import {
  ConflictException,
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
import { DeployKeyResponseDto } from './dto/deploy-key-response.dto';

interface GenerateDeployKeyAck {
  accepted?: unknown;
  publicKey?: unknown;
  fingerprint?: unknown;
  alreadyExisted?: unknown;
}

interface LinkRecord {
  chave: bigint;
  metaDados: Record<string, unknown>;
}

interface AgentRuntime {
  chave: bigint;
  tunnelPort: number;
  agentCommandSecretEncrypted: string;
}

/**
 * Service que orquestra Deploy Key SSH per-projeto (ADR-V2-042).
 *
 * Fluxo:
 *  - `generateDeployKey(projectId, agentId, comment, userId)` — dispara
 *    `GENERATE_DEPLOY_KEY` no agent, recebe pubkey + fingerprint, persiste
 *    em `DVincula -185 metaDados.deployKeyPub/Fingerprint/lastDeployKeyGeneratedAt`,
 *    emite `project.deploy-key.generated`.
 *  - `getDeployKey(projectId, agentId, userId)` — le `metaDados` sem
 *    outbound; retorna 404 se nunca gerada.
 *  - `revokeDeployKey(projectId, agentId, userId)` — apaga campos do
 *    `metaDados` (NAO chama agente — cleanup manual aceitavel). Emite
 *    `project.deploy-key.revoked`.
 *
 * RBAC: MANAGER do projeto OU ADMIN da org dona. Mesma cadeia que
 * `ProjectAgentLinkService.requireProjectManagerOrOrgAdmin`.
 *
 * Privada NUNCA sai da VPS (decisao CEO + ADR-V2-042).
 *
 * @see ADR-V2-042 (Deploy Key Automation pull-only)
 */
@Injectable()
export class DeployKeyService {
  private readonly logger = new Logger(DeployKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly remoteClient: RemoteExecutionClient,
    private readonly eventProducer: EventProducerService,
    private readonly correlationIdService: CorrelationIdService,
    private readonly roleResolver: RoleResolverService,
  ) {}

  /**
   * Gera (ou regenera idempotente) deploy key SSH per-projectSlug no agent.
   *
   * Idempotencia em 2 niveis:
   *  - Agent: se `/etc/scrumban-agent/ssh-keys/<slug>` ja existe, reusa
   *    (retorna `alreadyExisted=true`).
   *  - Backend: simplesmente sobrescreve `metaDados.deployKeyPub` —
   *    nao bloqueia regeneracao.
   *
   * Para regenerar (rotacionar), o operador apaga o arquivo manualmente
   * na VPS e chama POST novamente — esta task NAO implementa endpoint de
   * "force regenerate" (decisao CEO: complexidade desnecessaria para MVP).
   *
   * @throws {NotFoundException} Projeto/agent/vinculo nao encontrado
   * @throws {ConflictException} Vinculo sem `projectSlug` em metaDados (estado invalido)
   * @throws {ForbiddenException} Usuario sem permissao
   * @throws {ServiceUnavailableException} Agent offline / HMAC falha
   */
  async generateDeployKey(
    projectId: bigint,
    agentId: bigint,
    comment: string | undefined,
    userId: bigint,
  ): Promise<DeployKeyResponseDto> {
    await this.requireProjectManagerOrOrgAdmin(projectId, userId);

    const { link, agent, projectSlug } = await this.loadLinkAndAgent(projectId, agentId);

    const correlationId = this.correlationIdService.getOrGenerate();
    const effectiveComment = comment ?? `scrumban-agent@${projectSlug}`;

    let ack: GenerateDeployKeyAck;
    try {
      ack = await this.remoteClient.dispatch<
        { projectSlug: string; comment: string },
        GenerateDeployKeyAck
      >(
        'GENERATE_DEPLOY_KEY',
        { projectSlug, comment: effectiveComment },
        {
          agent: {
            agentId: agent.chave.toString(),
            tunnelPort: agent.tunnelPort,
            agentCommandSecretEncrypted: agent.agentCommandSecretEncrypted,
          },
          correlationId,
        },
      );
    } catch (err) {
      this.logger.warn(
        `generate-deploy-key outbound falhou projectId=${projectId.toString()} agentId=${agentId.toString()} slug=${projectSlug}`,
      );
      throw err;
    }

    if (
      ack?.accepted !== true ||
      typeof ack.publicKey !== 'string' ||
      typeof ack.fingerprint !== 'string'
    ) {
      throw new ServiceUnavailableException(
        `Agent ${agent.chave.toString()} nao retornou pubkey valida (slug=${projectSlug})`,
      );
    }

    const publicKey = ack.publicKey as string;
    const fingerprint = ack.fingerprint as string;
    const alreadyExisted = ack.alreadyExisted === true;
    const generatedAt = new Date().toISOString();

    // Persiste em DVincula -185 metaDados (merge — preserva campos existentes
    // como projectSlug, repoUrl, defaultBranch).
    await this.prisma.dVincula.update({
      where: { chave: link.chave },
      data: {
        metaDados: {
          ...link.metaDados,
          deployKeyPub: publicKey,
          deployKeyFingerprint: fingerprint,
          lastDeployKeyGeneratedAt: generatedAt,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `generate-deploy-key projectId=${projectId.toString()} agentId=${agentId.toString()} ` +
        `slug=${projectSlug} alreadyExisted=${alreadyExisted} fingerprint=${fingerprint}`,
    );

    // Emite APOS persistencia (Padrao #7)
    await this.eventProducer.addInternalEvent(
      'project.deploy-key.generated',
      {
        projectId: projectId.toString(),
        agentId: agentId.toString(),
        userId: userId.toString(),
        projectSlug,
        fingerprint,
        alreadyExisted,
      },
      correlationId,
      { source: DeployKeyService.name },
    );

    return this.buildResponse({
      publicKey,
      fingerprint,
      projectSlug,
      generatedAt,
      alreadyExisted,
    });
  }

  /**
   * Le deploy key persistida em `metaDados` (sem outbound).
   *
   * @throws {NotFoundException} Vinculo nao encontrado OU deploy key nunca gerada
   * @throws {ForbiddenException} Usuario nao e membro do projeto
   */
  async getDeployKey(
    projectId: bigint,
    agentId: bigint,
    userId: bigint,
  ): Promise<DeployKeyResponseDto> {
    await this.requireProjectMemberOrOrgAdmin(projectId, userId);

    const link = await this.findLinkOrThrow(projectId, agentId);
    const meta = link.metaDados;
    const publicKey = typeof meta.deployKeyPub === 'string' ? (meta.deployKeyPub as string) : null;
    const fingerprint =
      typeof meta.deployKeyFingerprint === 'string' ? (meta.deployKeyFingerprint as string) : null;
    const generatedAt =
      typeof meta.lastDeployKeyGeneratedAt === 'string'
        ? (meta.lastDeployKeyGeneratedAt as string)
        : null;
    const projectSlug = typeof meta.projectSlug === 'string' ? (meta.projectSlug as string) : null;

    if (!publicKey || !fingerprint || !generatedAt || !projectSlug) {
      throw new NotFoundException(
        `Deploy key nao gerada para projectId=${projectId.toString()} agentId=${agentId.toString()}`,
      );
    }

    return this.buildResponse({
      publicKey,
      fingerprint,
      projectSlug,
      generatedAt,
      alreadyExisted: true,
    });
  }

  /**
   * Apaga campos da deploy key em `metaDados` (NAO chama agente — cleanup
   * manual aceitavel; arquivo da chave continua na VPS ate operador apagar
   * manualmente). Emite `project.deploy-key.revoked`.
   *
   * @throws {NotFoundException} Vinculo nao encontrado
   * @throws {ForbiddenException} Usuario sem permissao
   */
  async revokeDeployKey(
    projectId: bigint,
    agentId: bigint,
    userId: bigint,
  ): Promise<{ revoked: true; revokedAt: string }> {
    await this.requireProjectManagerOrOrgAdmin(projectId, userId);

    const link = await this.findLinkOrThrow(projectId, agentId);
    const revokedAt = new Date().toISOString();

    // Filtra os 3 campos da deploy key — preserva resto.
    const cleanedMeta: Record<string, unknown> = { ...link.metaDados };
    delete cleanedMeta.deployKeyPub;
    delete cleanedMeta.deployKeyFingerprint;
    delete cleanedMeta.lastDeployKeyGeneratedAt;
    cleanedMeta.deployKeyRevokedAt = revokedAt;

    await this.prisma.dVincula.update({
      where: { chave: link.chave },
      data: { metaDados: cleanedMeta as unknown as Prisma.InputJsonValue },
    });

    this.logger.log(
      `revoke-deploy-key projectId=${projectId.toString()} agentId=${agentId.toString()} userId=${userId.toString()}`,
    );

    await this.eventProducer.addInternalEvent(
      'project.deploy-key.revoked',
      {
        projectId: projectId.toString(),
        agentId: agentId.toString(),
        userId: userId.toString(),
      },
      this.correlationIdService.getOrGenerate(),
      { source: DeployKeyService.name },
    );

    return { revoked: true, revokedAt };
  }

  // ---------- Helpers privados ----------

  private buildResponse(args: {
    publicKey: string;
    fingerprint: string;
    projectSlug: string;
    generatedAt: string;
    alreadyExisted: boolean;
  }): DeployKeyResponseDto {
    const { publicKey, fingerprint, projectSlug, generatedAt, alreadyExisted } = args;
    return {
      publicKey,
      fingerprint,
      sshConfigSnippet: this.buildSshConfigSnippet(projectSlug),
      instructions: this.buildInstructions(),
      generatedAt,
      alreadyExisted,
    };
  }

  private buildSshConfigSnippet(projectSlug: string): string {
    return (
      `Host github.com-${projectSlug}\n` +
      `  HostName github.com\n` +
      `  User git\n` +
      `  IdentityFile /etc/scrumban-agent/ssh-keys/${projectSlug}\n` +
      `  IdentitiesOnly yes`
    );
  }

  private buildInstructions(): string[] {
    return [
      'Abra https://github.com/<org>/<repo>/settings/keys no navegador.',
      'Clique em "Add deploy key".',
      'Cole o conteudo de `publicKey` no campo "Key".',
      'Marque "Allow write access" para permitir `git push` automatico (PR write).',
      'Salve. A partir de agora o agente pode fazer push para este repositorio.',
    ];
  }

  private async loadLinkAndAgent(
    projectId: bigint,
    agentId: bigint,
  ): Promise<{ link: LinkRecord; agent: AgentRuntime; projectSlug: string }> {
    const link = await this.findLinkOrThrow(projectId, agentId);
    const projectSlug =
      typeof link.metaDados.projectSlug === 'string' ? (link.metaDados.projectSlug as string) : '';
    if (!projectSlug) {
      throw new ConflictException(
        `Vinculo projectId=${projectId.toString()} agentId=${agentId.toString()} sem projectSlug em metaDados. ` +
          `Re-link o agente (linkAgent gera slug automaticamente em Task ${projectId.toString()}).`,
      );
    }

    const agent = await this.prisma.dEntidade.findFirst({
      where: {
        chave: agentId,
        idClasse: AUTOMATION_CLASS_IDS.AGENT,
        excluido: false,
      },
      select: { chave: true, dados: true },
    });
    if (!agent) {
      throw new NotFoundException(`Agente ${agentId.toString()} nao encontrado`);
    }

    const dados = (agent.dados as Record<string, unknown> | null) ?? {};
    const tunnelPortRaw = dados.tunnelPort;
    const secretRaw = dados.agentCommandSecretEncrypted;
    if (typeof tunnelPortRaw !== 'number' || !Number.isInteger(tunnelPortRaw)) {
      throw new ServiceUnavailableException(
        `Agent ${agentId.toString()} sem tunnelPort (estado invalido)`,
      );
    }
    if (typeof secretRaw !== 'string' || secretRaw.length === 0) {
      throw new ServiceUnavailableException(
        `Agent ${agentId.toString()} sem agentCommandSecretEncrypted (estado invalido)`,
      );
    }

    return {
      link,
      agent: {
        chave: agent.chave,
        tunnelPort: tunnelPortRaw,
        agentCommandSecretEncrypted: secretRaw,
      },
      projectSlug,
    };
  }

  private async findLinkOrThrow(projectId: bigint, agentId: bigint): Promise<LinkRecord> {
    const link = await this.prisma.dVincula.findFirst({
      where: {
        idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT,
        idLocEscritu: projectId,
        idEntidade: agentId,
        excluido: false,
      },
      select: { chave: true, metaDados: true },
    });
    if (!link) {
      throw new NotFoundException(
        `Vinculo projectId=${projectId.toString()} agentId=${agentId.toString()} nao encontrado`,
      );
    }
    return {
      chave: link.chave,
      metaDados: (link.metaDados as Record<string, unknown> | null) ?? {},
    };
  }

  private async requireProjectManagerOrOrgAdmin(projectId: bigint, userId: bigint): Promise<void> {
    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { chave: true, idEstab: true },
    });
    if (!project) {
      throw new NotFoundException(`Projeto ${projectId.toString()} nao encontrado`);
    }
    const projectRole = await this.roleResolver.getProjectRole(userId, projectId);
    if (projectRole === 'MANAGER') return;
    if (project.idEstab) {
      const orgRole = await this.roleResolver.getOrgRole(userId, project.idEstab);
      if (orgRole === 'ADMIN') return;
    }
    throw new ForbiddenException(
      'Acesso negado: requer MANAGER do projeto ou ADMIN da organizacao',
    );
  }

  private async requireProjectMemberOrOrgAdmin(projectId: bigint, userId: bigint): Promise<void> {
    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { chave: true, idEstab: true },
    });
    if (!project) {
      throw new NotFoundException(`Projeto ${projectId.toString()} nao encontrado`);
    }
    const projectRole = await this.roleResolver.getProjectRole(userId, projectId);
    if (projectRole) return; // MANAGER, MEMBER, VIEWER — qualquer membro
    if (project.idEstab) {
      const orgRole = await this.roleResolver.getOrgRole(userId, project.idEstab);
      if (orgRole === 'ADMIN') return;
    }
    throw new ForbiddenException('Acesso negado: requer membro do projeto ou ADMIN da organizacao');
  }
}
