import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { AgentTunnelService } from '../../automation/agents/agent-tunnel.service';
import { AUTOMATION_CLASS_IDS } from '../../automation/constants/automation-class-ids';
import { ExecutionRuntimeLogService } from '../../automation/runtime/execution-runtime-log.service';
import {
  RemoteAgentRuntime,
  RemoteExecutionClient,
} from '../../automation/runtime/remote-execution-client';
import { EXECUTION_QUEUE_NAME } from '../queues/execution-queue.constants';
import { ExecutionRunJobData } from '../queues/execution-queue.service';

const EXECUTION_CLASSES = [
  AUTOMATION_CLASS_IDS.EXEC_LOW,
  AUTOMATION_CLASS_IDS.EXEC_MEDIUM,
  AUTOMATION_CLASS_IDS.EXEC_HIGH,
];

/**
 * Timeout default (segundos) entregue ao agente caso `DPedido.dados.timeoutSec`
 * (ou equivalente) nao esteja preenchido. Plan-task1 §4 sugere 1800s (30min)
 * para execucoes Claude Code.
 */
const DEFAULT_TIMEOUT_SEC = 1800;

interface ExecutionPedido {
  chave: bigint;
  idClasse: bigint;
  idLocEscritu: bigint | null;
  dados: Record<string, unknown>;
}

interface RuntimeProject {
  chave: bigint;
  dados: Record<string, unknown>;
}

interface RuntimeAgent {
  chave: bigint;
  dados: Record<string, unknown>;
}

/**
 * Processor BullMQ que dispara execucoes Claude Code remotamente.
 *
 * Modelo V2 (apos ADR-V2-030/-032/-033, Sub-tarefa 2.2 do
 * `plan-automation-backend-side-task2.md`):
 *
 * 1. Carrega `DPedido` (idClasse=-301/-302/-303), `DProject`, agente.
 * 2. Resolve `projectSlug`, `prompt`, `resumeSessionId`, `idClasseRisk`.
 * 3. Marca execucao como RUNNING e emite `execution.started`.
 * 4. Chama `remoteClient.execute()` (payload `RUN_CLAUDE_CODE`, ACK sincrono).
 * 5. Retorna apos ACK. **O resultado real (exitCode, claudeSessionId,
 *    outcome) chega via callback `POST /agents/:id/execution-result`**
 *    (Sub-tarefa 2.4 — ainda nao implementada nesta sub-tarefa 2.2).
 *
 * Git operations (worktree, commit, push, rollback) deixaram de ser
 * orquestradas pelo backend — sao responsabilidade do Claude Code dentro
 * do projeto remoto (resolvido via `~/.claude/CLAUDE.md`).
 */
@Injectable()
@Processor(EXECUTION_QUEUE_NAME, { concurrency: 3 })
export class ExecutionRunProcessor extends WorkerHost {
  private readonly logger = new Logger(ExecutionRunProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventProducer: EventProducerService,
    private readonly agentTunnel: AgentTunnelService,
    private readonly remoteClient: RemoteExecutionClient,
    private readonly logService: ExecutionRuntimeLogService,
  ) {
    super();
  }

  async process(job: Job<ExecutionRunJobData>): Promise<void> {
    const { executionId, projectId, agentId } = job.data;
    const pedido = await this.loadExecution(executionId);
    if (!pedido) return;

    const dados = pedido.dados;
    const correlationId =
      this.asString(this.asRecord(dados.audit)?.correlationId) ?? `execution-${executionId}`;

    const [project, agent] = await Promise.all([
      this.loadProject(projectId),
      this.loadAgent(agentId),
    ]);

    if (!project || !agent) {
      await this.failExecution(pedido, correlationId, 'PROJECT_OR_AGENT_NOT_FOUND');
      return;
    }

    let runtimeAgent: RemoteAgentRuntime;
    try {
      runtimeAgent = this.resolveRuntimeAgent(agent);
      const probe = await this.agentTunnel.probe(runtimeAgent.tunnelPort);
      if (!probe.tunnelOk) {
        await this.failExecution(pedido, correlationId, probe.error ?? 'TUNNEL_UNAVAILABLE');
        return;
      }

      const transitioned = await this.markRunning(executionId);
      if (!transitioned) {
        this.logger.warn(`execution_run_skip_stale executionId=${executionId}`);
        return;
      }

      await this.safeEmit('execution.started', { executionId, projectId, agentId }, correlationId);

      await this.dispatchRunClaudeCode({
        pedido,
        project,
        agent: runtimeAgent,
        correlationId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failExecution(pedido, correlationId, message);
    }
  }

  /**
   * Monta o payload V2 e dispara `RUN_CLAUDE_CODE`. Retorna apos receber
   * ACK sincrono do agente — resultado completo chega via callback.
   */
  private async dispatchRunClaudeCode(input: {
    pedido: ExecutionPedido;
    project: RuntimeProject;
    agent: RemoteAgentRuntime;
    correlationId: string;
  }): Promise<void> {
    const executionId = input.pedido.chave.toString();
    const projectId = input.project.chave.toString();

    const projectSlug = this.resolveProjectSlug(input.project);
    const prompt = this.resolvePrompt(input.pedido.dados);
    const resumeSessionId = this.resolveResumeSessionId(input.pedido.dados);
    const timeoutSec = this.resolveTimeoutSec(input.pedido.dados);
    const idClasseRisk = Number(input.pedido.idClasse);

    if (!Number.isInteger(idClasseRisk) || idClasseRisk > 0) {
      throw new Error(`idClasseRisk invalido (${idClasseRisk}) — esperado -301/-302/-303`);
    }

    await this.remoteClient.execute({
      executionId,
      projectId,
      correlationId: input.correlationId,
      projectSlug,
      idClasseRisk,
      prompt,
      resumeSessionId,
      timeoutSec,
      agent: input.agent,
    });

    this.logger.log(
      `execution_dispatched executionId=${executionId} projectSlug=${projectSlug} idClasseRisk=${idClasseRisk}`,
    );

    // Aguardar callback `POST /agents/:id/execution-result` (Sub-tarefa 2.4)
    // para fechar a execucao (finishExecution / emitFinished). Por enquanto
    // a execucao permanece em RUNNING ate sweeper ou callback.
  }

  /**
   * Extrai `projectSlug` de `DProject.dados.slug`. Falha barulhento se
   * ausente — sub-tarefa 2.3 (backfill) deve garantir que todo DProject
   * tenha slug antes desta funcao rodar em producao.
   */
  private resolveProjectSlug(project: RuntimeProject): string {
    const slug = this.asString(project.dados.slug);
    if (!slug) {
      throw new InternalServerErrorException(
        `DProject.dados.slug ausente para projectId=${project.chave.toString()} — execute Sub-tarefa 2.3 (backfill) antes de disparar execucoes V2`,
      );
    }
    return slug;
  }

  /**
   * Extrai prompt do usuario do `DPedido.dados`. Tenta na ordem:
   * 1. `dados.prompt` (canonico V2)
   * 2. `dados.command.text` (legado — texto livre que virava command shell)
   *
   * Falha se ambos ausentes.
   */
  private resolvePrompt(dados: Record<string, unknown>): string {
    const direct = this.asString(dados.prompt);
    if (direct) return direct;

    const command = this.asRecord(dados.command);
    const fromCommand = this.asString(command?.text);
    if (fromCommand) return fromCommand;

    throw new Error(
      'DPedido.dados.prompt ausente (e dados.command.text tambem) — prompt obrigatorio no protocolo V2',
    );
  }

  /**
   * Extrai `resumeSessionId` opcional de `DPedido.dados.resumeSessionId`.
   * Retorna `null` se ausente (sessao nova).
   */
  private resolveResumeSessionId(dados: Record<string, unknown>): string | null {
    const direct = this.asString(dados.resumeSessionId);
    return direct ?? null;
  }

  /**
   * Extrai timeout em segundos de `DPedido.dados.timeoutSec`. Default
   * `DEFAULT_TIMEOUT_SEC` (1800s = 30min).
   */
  private resolveTimeoutSec(dados: Record<string, unknown>): number {
    const direct = this.asNumber(dados.timeoutSec);
    if (direct && direct > 0 && Number.isFinite(direct)) return direct;
    return DEFAULT_TIMEOUT_SEC;
  }

  private async loadExecution(executionId: string): Promise<ExecutionPedido | null> {
    const pedido = await this.prisma.dPedido.findFirst({
      where: {
        chave: BigInt(executionId),
        idClasse: { in: EXECUTION_CLASSES },
        excluido: false,
      },
      select: { chave: true, idClasse: true, idLocEscritu: true, dados: true },
    });

    if (!pedido) return null;
    return {
      chave: pedido.chave,
      idClasse: pedido.idClasse,
      idLocEscritu: pedido.idLocEscritu,
      dados: (pedido.dados ?? {}) as Record<string, unknown>,
    };
  }

  private async loadProject(projectId: string): Promise<RuntimeProject | null> {
    const project = await this.prisma.dProject.findFirst({
      where: { chave: BigInt(projectId), excluido: false },
      select: { chave: true, dados: true },
    });
    if (!project) return null;
    return {
      chave: project.chave,
      dados: (project.dados ?? {}) as Record<string, unknown>,
    };
  }

  private async loadAgent(agentId: string): Promise<RuntimeAgent | null> {
    const agent = await this.prisma.dEntidade.findFirst({
      where: {
        chave: BigInt(agentId),
        idClasse: AUTOMATION_CLASS_IDS.AGENT,
        excluido: false,
      },
      select: { chave: true, dados: true },
    });
    if (!agent) return null;
    return {
      chave: agent.chave,
      dados: (agent.dados ?? {}) as Record<string, unknown>,
    };
  }

  private resolveRuntimeAgent(agent: RuntimeAgent): RemoteAgentRuntime {
    const tunnelPortRaw = agent.dados.tunnelPort;
    const tunnelPort =
      typeof tunnelPortRaw === 'number'
        ? tunnelPortRaw
        : typeof tunnelPortRaw === 'string'
          ? Number(tunnelPortRaw)
          : NaN;
    const agentCommandSecretEncrypted = this.asString(agent.dados.agentCommandSecretEncrypted);
    if (!Number.isInteger(tunnelPort) || !agentCommandSecretEncrypted) {
      throw new Error('Agent sem tunnelPort ou agentCommandSecretEncrypted.');
    }
    return {
      agentId: agent.chave.toString(),
      tunnelPort,
      agentCommandSecretEncrypted,
    };
  }

  private async markRunning(executionId: string): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "DPedido"
      SET dados = jsonb_set(
            jsonb_set(
              COALESCE(dados, '{}'::jsonb),
              '{runtime}',
              COALESCE(dados->'runtime', '{}'::jsonb) || jsonb_build_object('startedAt', NOW()::text),
              true
            ),
            '{statusCode}',
            to_jsonb(${AUTOMATION_CLASS_IDS.EXEC_STATUS_RUNNING.toString()}::text),
            true
          ),
          "atualizadoEm" = NOW()
      WHERE chave = ${BigInt(executionId)}
        AND idClasse IN (${Prisma.join(EXECUTION_CLASSES)})
        AND (
          dados->>'statusCode' IN (
            ${AUTOMATION_CLASS_IDS.EXEC_STATUS_QUEUED.toString()},
            ${AUTOMATION_CLASS_IDS.EXEC_STATUS_APPROVED.toString()}
          )
          OR dados->'approval'->>'status' IN ('queued', 'approved')
        )
    `;
    return updated > 0;
  }

  private async failExecution(
    pedido: ExecutionPedido,
    correlationId: string,
    reason: string,
  ): Promise<void> {
    const executionId = pedido.chave.toString();
    const dadosAudit = this.asRecord(pedido.dados.audit);
    const projectId = this.asString(dadosAudit?.projectId) ?? pedido.idLocEscritu?.toString() ?? '';
    const agentId = this.asString(dadosAudit?.agentId) ?? '0';
    await this.safeRecordSystem({
      executionId,
      projectId,
      agentId,
      correlationId,
      line: reason,
      code: reason,
    });
    await this.finishExecution(pedido.chave, {
      statusCode: AUTOMATION_CLASS_IDS.EXEC_STATUS_FAILED.toString(),
      claude: {
        exitCode: -1,
        stderr: reason,
        finishedAt: new Date().toISOString(),
      },
    });
    await this.emitFinished('execution.failed', executionId, projectId, agentId, correlationId);
  }

  private async finishExecution(
    executionId: bigint,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const pedido = await this.prisma.dPedido.findFirst({
      where: { chave: executionId, excluido: false },
      select: { dados: true },
    });
    const dados = (pedido?.dados ?? {}) as Record<string, unknown>;
    const runtime = {
      ...this.asRecord(dados.runtime),
      finishedAt: new Date().toISOString(),
    };
    await this.prisma.dPedido.update({
      where: { chave: executionId },
      data: {
        dados: {
          ...dados,
          ...patch,
          runtime,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async emitFinished(
    type: 'execution.succeeded' | 'execution.failed' | 'execution.expired',
    executionId: string,
    projectId: string,
    agentId: string,
    correlationId: string,
  ): Promise<void> {
    await this.safeEmit(type, { executionId, projectId, agentId }, correlationId);
  }

  private async safeEmit(
    type: string,
    payload: Record<string, unknown>,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.eventProducer.addInternalEvent(type, payload, correlationId, {
        source: ExecutionRunProcessor.name,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`execution_event_emit_failed type=${type} error=${message}`);
    }
  }

  private async safeRecordSystem(
    input: Parameters<ExecutionRuntimeLogService['recordSystem']>[0],
  ): Promise<void> {
    try {
      await this.logService.recordSystem(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`execution_system_log_failed error=${message}`);
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }
}
