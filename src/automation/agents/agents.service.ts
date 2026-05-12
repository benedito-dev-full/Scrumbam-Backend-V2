import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../common/services/correlation-id.service';
import OperacaoExecucaoClaude from '../../engine/lib/operacao/OperacaoExecucaoClaude';
import { IExecucaoData } from '../../engine/lib/interfaces/IExecucaoData';
import { AUTOMATION_CLASS_IDS } from '../constants/automation-class-ids';
import { InstallAgentDto, InstallAgentResponseDto } from './dto/install-agent.dto';
import { HeartbeatDto, HeartbeatResponseDto } from './dto/heartbeat.dto';
import { ExecutionResultDto, ExecutionResultResponseDto } from './dto/execution-result.dto';
import { AgentInstallTokenService } from './agent-install-token.service';
import { AgentKeyService } from './agent-key.service';
import { AgentPortAllocatorService } from './agent-port-allocator.service';

/**
 * Conjunto de idClasse válidas para DPedido de execução Claude Code.
 * Alinhado com ADR-V2-006 (risk via idClasse, não campo).
 */
const EXECUTION_CLASSES_SET: ReadonlySet<bigint> = new Set([
  BigInt(-301),
  BigInt(-302),
  BigInt(-303),
]);

export interface AuthenticatedAgent {
  chave: bigint;
  dados: Record<string, unknown>;
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly installTokenService: AgentInstallTokenService,
    private readonly agentKeyService: AgentKeyService,
    private readonly portAllocator: AgentPortAllocatorService,
    private readonly eventProducer: EventProducerService,
    private readonly correlationIdService: CorrelationIdService,
  ) {}

  /**
   * Instala um agente usando token one-shot.
   *
   * Comportamento condicional:
   * - Se o token foi gerado COM `projectId`: cria DEntidade -156 com
   *   `idLocEscritu = projectId` E cria DVincula -185 (agente↔projeto)
   *   atomicamente. Comportamento histórico preservado (backward-compat).
   * - Se o token foi gerado SEM `projectId` (standalone): cria DEntidade
   *   -156 com `idLocEscritu = createdBy` (usuário que gerou o token
   *   torna-se o "dono" inicial para audit) e **NÃO** cria DVincula -185.
   *   Vínculos de projeto devem ser criados depois via
   *   `POST /agents/:id/projects` (sub-tarefa 4.3).
   *
   * Audit: `dados.installedBy` registra SEMPRE o usuário que gerou o token
   * (independente de standalone ou vinculado), permitindo trilha de auditoria
   * mesmo após o agente ser vinculado/desvinculado de projetos.
   *
   * @param dto Payload com installToken + hostname + metadados do agente.
   * @returns Agent ID, API key plaintext (exibida uma única vez), command secret e porta de túnel.
   */
  async install(dto: InstallAgentDto): Promise<InstallAgentResponseDto> {
    const agentApiKey = this.agentKeyService.generateSecret(32);
    const agentCommandSecret = this.agentKeyService.generateSecret(32);
    const apiKeyHash = this.agentKeyService.hashSecret(agentApiKey);
    const agentCommandSecretEncrypted =
      this.agentKeyService.encryptCommandSecret(agentCommandSecret);

    const result = await this.prisma.$transaction(async (tx) => {
      const consumed = await this.installTokenService.consumeInstallToken(tx, dto.installToken);
      const tunnelPort = await this.portAllocator.allocate(tx);

      // Standalone (projectId=null): `idLocEscritu` recai sobre o usuário que
      // gerou o token (createdBy) para preservar dono operacional inicial.
      // Vinculado (projectId!=null): comportamento histórico.
      const idLocEscritu = consumed.projectId !== null ? consumed.projectId : consumed.createdBy;

      const agent = await tx.dEntidade.create({
        data: {
          idClasse: AUTOMATION_CLASS_IDS.AGENT,
          nome: dto.hostname,
          idLocEscritu,
          dados: {
            projectId: consumed.projectId !== null ? consumed.projectId.toString() : null,
            installTokenId: consumed.tokenId.toString(),
            installedBy: consumed.createdBy.toString(),
            hostname: dto.hostname,
            os: dto.os ?? null,
            agentVersion: dto.agentVersion ?? null,
            claudeVersion: dto.claudeVersion ?? null,
            publicKeyFingerprint: dto.publicKeyFingerprint ?? null,
            tunnelPort,
            apiKeyHash,
            agentCommandSecretEncrypted,
            statusCode: AUTOMATION_CLASS_IDS.AGENT_STATUS_NEVER_CONNECTED.toString(),
            lastSeen: null,
            installedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
        select: { chave: true },
      });

      // Vínculo agente↔projeto: SOMENTE quando o token tinha projectId.
      // Standalone vincula projetos depois via POST /agents/:id/projects.
      if (consumed.projectId !== null) {
        await tx.dVincula.create({
          data: {
            idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT,
            idLocEscritu: consumed.projectId,
            idEntidade: agent.chave,
            tipo: 'agent',
            metaDados: {
              installedAt: new Date().toISOString(),
              installTokenId: consumed.tokenId.toString(),
            } as Prisma.InputJsonValue,
          },
        });
      }

      return { agentId: agent.chave, tunnelPort };
    });

    await this.eventProducer.addInternalEvent(
      'agent.registered',
      {
        agentId: result.agentId.toString(),
        tunnelPort: result.tunnelPort,
      },
      this.correlationIdService.getOrGenerate(),
      { source: AgentsService.name },
    );

    return {
      agentId: result.agentId.toString(),
      agentApiKey,
      agentCommandSecret,
      tunnelPort: result.tunnelPort,
    };
  }

  async heartbeat(agent: AuthenticatedAgent, dto: HeartbeatDto): Promise<HeartbeatResponseDto> {
    const previousStatus = agent.dados.statusCode?.toString();
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.dEntidade.update({
        where: { chave: agent.chave },
        data: {
          dados: {
            ...agent.dados,
            ...(dto.agentVersion !== undefined && { agentVersion: dto.agentVersion }),
            ...(dto.claudeVersion !== undefined && { claudeVersion: dto.claudeVersion }),
            ...(dto.os !== undefined && { os: dto.os }),
            statusCode: AUTOMATION_CLASS_IDS.AGENT_STATUS_ONLINE.toString(),
            lastSeen: now.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });

      await tx.dEvento.create({
        data: {
          idClasse: AUTOMATION_CLASS_IDS.AGENT_HEARTBEAT_EVENT,
          idEntidade: agent.chave,
          descricao: 'agent.heartbeat',
          metaDados: {
            agentId: agent.chave.toString(),
            at: now.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
    });

    if (previousStatus === AUTOMATION_CLASS_IDS.AGENT_STATUS_OFFLINE.toString()) {
      await this.eventProducer.addInternalEvent(
        'agent.online',
        { agentId: agent.chave.toString(), lastSeen: now.toISOString() },
        this.correlationIdService.getOrGenerate(),
        { source: AgentsService.name },
      );
    }

    return {
      ok: true,
      agentId: agent.chave.toString(),
      statusCode: AUTOMATION_CLASS_IDS.AGENT_STATUS_ONLINE.toString(),
      lastSeen: now.toISOString(),
    };
  }

  async findAgentForAuth(agentId: bigint): Promise<AuthenticatedAgent> {
    const agent = await this.prisma.dEntidade.findFirst({
      where: {
        chave: agentId,
        idClasse: AUTOMATION_CLASS_IDS.AGENT,
        excluido: false,
      },
      select: { chave: true, dados: true },
    });
    if (!agent) {
      throw new NotFoundException('Agent nao encontrado');
    }

    return {
      chave: agent.chave,
      dados: (agent.dados as Record<string, unknown> | null) ?? {},
    };
  }

  /**
   * Registra outcome de execução Claude Code reportado pelo agente V2 via callback.
   *
   * Endpoint: POST /agents/:id/execution-result (autenticado por AgentAuthGuard).
   * Fluxo:
   *   1. Carrega DPedido por executionId
   *   2. Valida que idClasse pertence a {-301,-302,-303} (ADR-V2-006)
   *   3. Isolation: agente autenticado === agente registrado em DPedido.dados.audit.agentId
   *   4. Idempotência: se `dados.audit.outcome` já presente, retorna alreadyPersisted=true
   *   5. Instancia OperacaoExecucaoClaude e chama registrarOutcome() — Engine encapsula UPDATE
   *      (Pilar 1 PRESERVADO: zero prisma.dPedido.update direto neste handler)
   *   6. Materializa DEvento via EventProducerService APÓS persistência (Padrão #7):
   *      - agent.execution.finished | agent.execution.failed (idClasse -496)
   *      - agent.session.created (idClasse -505) se claudeSessionId presente e resumedFrom null
   *      - agent.session.resumed (idClasse -506) se claudeSessionId presente e resumedFrom != null
   *
   * SEGURANÇA:
   *   - HMAC + nonce + rate limit já validados pelo AgentAuthGuard
   *   - claudeSessionPath persiste em DPedido.dados.claude.sessionPath (INTERNAL audit)
   *     mas NÃO é exposto em ExecutionResponseDto (Risco #7 plan)
   *   - Isolation por agentId previne forja de outcome em execução de outro projeto (Risco #6)
   *
   * @param params.agentId ID do agente do path param (validado pelo guard contra header x-agent-id)
   * @param params.agentEntity Agente autenticado (populado pelo AgentAuthGuard)
   * @param params.dto Payload do callback
   * @returns {accepted:true, persistedAt, alreadyPersisted?}
   *
   * @throws {NotFoundException} executionId não encontrado em DPedido
   * @throws {BadRequestException} DPedido.idClasse fora de {-301,-302,-303}
   * @throws {ForbiddenException} agentId do path != agentId registrado em DPedido.dados.audit
   *
   * @see ADR-V2-005 (Pilar 1: Engine para INSERT/UPDATE em DPedido transacional)
   * @see ADR-V2-006 (risk via idClasse, não campo)
   * @see ADR-V2-032 (claudeSessionId em DPedido.dados.claude)
   * @see ADR-V2-033 (contrato callback execution-result inbound)
   */
  async recordExecutionResult(params: {
    agentId: string;
    agentEntity: AuthenticatedAgent;
    dto: ExecutionResultDto;
  }): Promise<ExecutionResultResponseDto> {
    const { agentId, agentEntity, dto } = params;
    let executionId: bigint;
    try {
      executionId = BigInt(dto.executionId);
    } catch {
      throw new BadRequestException(`executionId inválido: ${dto.executionId}`);
    }

    // 1. Carrega DPedido — validação de existência ANTES de isolation
    const pedido = await this.prisma.dPedido.findFirst({
      where: { chave: executionId, excluido: false },
      select: { chave: true, idClasse: true, dados: true },
    });
    if (!pedido) {
      throw new NotFoundException(`Execução ${dto.executionId} não encontrada`);
    }

    // 2. Validação de classe (Risk Gate range — ADR-V2-006)
    if (!EXECUTION_CLASSES_SET.has(pedido.idClasse)) {
      throw new BadRequestException(
        `DPedido ${dto.executionId} não é execução (idClasse=${pedido.idClasse.toString()}). ` +
          `Esperado: -301, -302 ou -303.`,
      );
    }

    // 3. Isolation: agente do path/header DEVE casar com agentId registrado em dados.audit
    const dadosExecucao = (pedido.dados ?? {}) as unknown as IExecucaoData;
    const registeredAgentId = dadosExecucao.audit?.agentId;
    if (!registeredAgentId || registeredAgentId !== agentId) {
      this.logger.warn(
        `[isolation] Agente ${agentId} tentou reportar outcome de execução ${dto.executionId} ` +
          `pertencente ao agente ${registeredAgentId ?? 'desconhecido'}`,
      );
      throw new ForbiddenException(
        `Agente ${agentId} não autorizado para execução ${dto.executionId}`,
      );
    }

    // Sanity check redundante: agentEntity.chave deve casar com agentId do path
    if (agentEntity.chave.toString() !== agentId) {
      throw new ForbiddenException('Agent id mismatch (guard inconsistency)');
    }

    // 4. Idempotência: se outcome já persistido, retorna NO-OP com persistedAt original
    const auditExisting = dadosExecucao.audit as
      | (IExecucaoData['audit'] & { outcome?: { recordedAt?: string } })
      | undefined;
    if (auditExisting?.outcome?.recordedAt) {
      this.logger.log(
        `[idempotent] Outcome para execução ${dto.executionId} já persistido em ${auditExisting.outcome.recordedAt}`,
      );
      return {
        accepted: true,
        alreadyPersisted: true,
        persistedAt: auditExisting.outcome.recordedAt,
      };
    }

    // 5. Persistência via Engine (Pilar 1 — zero Prisma direto neste handler)
    const correlationId =
      dadosExecucao.audit?.correlationId ?? this.correlationIdService.getOrGenerate();
    const projectId = dadosExecucao.audit?.projectId ?? '0';
    const command = dadosExecucao.command ?? { text: '' };

    const operacao = new OperacaoExecucaoClaude({
      usuario: agentEntity.chave.toString(),
      classe: pedido.idClasse.toString(),
      bd: this.prisma,
      projectId,
      agentId,
      correlationId,
      command,
      agentTunnelService: { runClaudeCode: () => Promise.resolve({}) },
      eventProducer: this.eventProducer,
    });

    await operacao.registrarOutcome({
      dadosExistentes: {
        chave: pedido.chave,
        dados: dadosExecucao,
        idClasse: pedido.idClasse,
      },
      claudeSessionId: dto.claudeSessionId ?? null,
      claudeSessionPath: dto.claudeSessionPath ?? null,
      resumedFrom: dto.resumedFrom ?? null,
      exitCode: dto.exitCode,
      success: dto.success,
      durationMs: dto.durationMs,
      stdoutTruncated: dto.stdoutTruncated,
      stderrTruncated: dto.stderrTruncated,
      errorCode: dto.errorCode,
    });

    const persistedAt = new Date().toISOString();

    // 6. Materializa DEventos via EventProducerService (APÓS persistência — Padrão #7)
    //    Não bloqueia o response: producer absorve erros internamente.
    const baseEventPayload = {
      executionId: dto.executionId,
      agentId,
      projectId,
      exitCode: dto.exitCode,
      durationMs: dto.durationMs,
      errorCode: dto.errorCode ?? null,
    };

    await this.eventProducer.addInternalEvent(
      dto.success ? 'agent.execution.finished' : 'agent.execution.failed',
      baseEventPayload,
      correlationId,
      { source: AgentsService.name },
    );

    // Session lifecycle: emite SOMENTE se claudeSessionId presente
    if (dto.claudeSessionId) {
      const sessionEventType = dto.resumedFrom ? 'agent.session.resumed' : 'agent.session.created';
      await this.eventProducer.addInternalEvent(
        sessionEventType,
        {
          executionId: dto.executionId,
          agentId,
          projectId,
          claudeSessionId: dto.claudeSessionId,
          resumedFrom: dto.resumedFrom ?? null,
        },
        correlationId,
        { source: AgentsService.name },
      );
    }

    return { accepted: true, persistedAt };
  }
}
