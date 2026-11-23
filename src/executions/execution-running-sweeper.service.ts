import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { ExecutionRuntimeLogService } from '../automation/runtime/execution-runtime-log.service';
import { TasksService } from '../tasks/tasks.service';
import OperacaoExecucaoClaude, {
  ExecucaoEncerradaRow,
} from '../engine/lib/operacao/OperacaoExecucaoClaude';
import {
  ExecutionLifecycleConfig,
  resolveExecutionLifecycleConfig,
  systemFailureMovedBy,
} from './constants/execution-lifecycle.const';

/**
 * Sweeper de execuções presas em RUNNING (ADR-V2-082).
 *
 * Cron 1/min. Encerra como FAILED (`source='system'`) as execuções -518 cujo
 * callback `execution-result` nunca chegou:
 *  - `TIMEOUT_NO_CALLBACK`: `startedAt + timeoutSec + 300s` vencido;
 *  - `AGENT_RESTARTED`: heartbeat mostra que o agente reiniciou depois do início;
 *  - `QUEUE_STALE` (Ciclo 2 / M3): QUEUED/APPROVED sem dispatch há mais de
 *    `EXECUTION_QUEUE_STALE_SEC` (job perdido no Redis ou modo sem Redis) — sem
 *    isso a task ficaria bloqueada por 409 `execution_in_progress` para sempre.
 *
 * O SQL de domínio (UPDATE em lote com CAS + RETURNING) mora no Engine
 * (`OperacaoExecucaoClaude.encerrarVencidas`). Este service só orquestra os
 * efeitos APÓS a persistência (Padrão #7), e SOMENTE para as linhas que ele
 * próprio encerrou (RETURNING) — seguro com várias réplicas:
 *  1. task vinculada EXECUTING → FAILED (leitura batch; não pisa em humano);
 *  2. log -496 (`recordSystem`);
 *  3. evento `execution.failed { reason }` (notificação/webhook/audit existentes).
 *
 * Se o callback real chegar depois, `registrarOutcome` substitui este desfecho
 * sintético uma única vez (decisão CEO P1).
 *
 * Eventos emitidos: `execution.failed`.
 */
@Injectable()
export class ExecutionRunningSweeperService {
  private readonly logger = new Logger(ExecutionRunningSweeperService.name);
  private readonly lifecycle: ExecutionLifecycleConfig = resolveExecutionLifecycleConfig();
  /** Guarda de reentrância: um ciclo lento não se sobrepõe ao próximo. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventProducer: EventProducerService,
    private readonly logService: ExecutionRuntimeLogService,
    private readonly tasksService: TasksService,
  ) {}

  /**
   * Varre e encerra execuções RUNNING vencidas (ver JSDoc da classe).
   *
   * @returns Quantidade de execuções encerradas neste ciclo (0 se reentrante)
   *
   * @example
   * ```typescript
   * const n = await sweeper.sweepStaleRunning(); // chamado pelo @Cron a cada minuto
   * ```
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async sweepStaleRunning(): Promise<number> {
    if (this.running) {
      this.logger.debug('execution_sweeper_skip_reentrant');
      return 0;
    }
    this.running = true;
    try {
      return await this.sweepOnce();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`execution_sweeper_error error=${message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /**
   * Um ciclo do sweeper: encerra o lote vencido via Engine e emite efeitos só
   * para as linhas devolvidas pelo `RETURNING` (seguro com várias réplicas).
   *
   * @returns Quantidade de execuções encerradas neste ciclo
   */
  private async sweepOnce(): Promise<number> {
    const rows = await OperacaoExecucaoClaude.encerrarVencidas(this.prisma, {
      marginSec: this.lifecycle.deadlineMarginSec,
      defaultTimeoutSec: this.lifecycle.defaultTimeoutSec,
      queueStaleSec: this.lifecycle.queueStaleSec,
      limit: this.lifecycle.sweeperBatchLimit,
    });
    if (rows.length === 0) return 0;

    await this.releaseLinkedTasks(rows);

    const reasons: Record<string, number> = {};
    for (const row of rows) {
      reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
      await this.emitEffects(row);
    }

    this.logger.warn(
      `execution_sweeper_failed count=${rows.length} reasons=${JSON.stringify(reasons)}`,
    );
    return rows.length;
  }

  /**
   * Tasks vinculadas ainda EXECUTING → FAILED (`movedBy` = marcador da execução).
   *
   * Ciclo 2 / M2 — corrida com callback tardio que substitui o desfecho
   * sintético entre o UPDATE do sweeper e a liberação da task:
   *  1. **pré-checagem:** relê `audit.outcome` das execuções (1 `findMany`) e só
   *     libera tasks cuja execução AINDA tem outcome `source='system'`;
   *  2. move EXECUTING → FAILED com `movedBy=system:execution-<id>` (o callback
   *     que chegar depois reconhece o marcador e promove FAILED → DONE);
   *  3. **pós-checagem (compensação):** relê de novo; se nesse intervalo o
   *     callback real gravou sucesso (`source='agent'`, success=true), devolve a
   *     task para DONE. Qualquer intercalação converge para DONE.
   *
   * Leituras em batch (ZERO N+1); o update é por task via `TasksService`
   * (telemetria/workSession/eventos de status). Task movida por humano (READY,
   * DONE…) não é tocada.
   */
  private async releaseLinkedTasks(rows: ExecucaoEncerradaRow[]): Promise<void> {
    const taskByExecution = new Map<string, string>();
    for (const r of rows) {
      const taskId = r.dados?.task?.id;
      if (typeof taskId === 'string' && /^\d+$/.test(taskId)) {
        taskByExecution.set(r.chave.toString(), taskId);
      }
    }
    if (taskByExecution.size === 0) return;

    // 1. Pré-checagem: execução ainda com desfecho sintético?
    const stillSynthetic = await this.readOutcomes([...taskByExecution.keys()]);
    const candidates = [...taskByExecution.entries()].filter(
      ([execId]) => stillSynthetic.get(execId)?.source === 'system',
    );
    if (candidates.length === 0) return;

    // Status V3 da task = dados.v3.state (mesma derivação do TasksService).
    const tasks = await this.prisma.dTask.findMany({
      where: { chave: { in: candidates.map(([, t]) => BigInt(t)) }, excluido: false },
      select: { chave: true, dados: true },
    });
    const executing = new Set(
      tasks
        .filter((t) => (t.dados as { v3?: { state?: string } } | null)?.v3?.state === 'EXECUTING')
        .map((t) => t.chave.toString()),
    );

    // 2. Libera com marcador.
    const moved: Array<[string, string]> = [];
    for (const [execId, taskId] of candidates) {
      if (!executing.has(taskId)) continue;
      try {
        await this.tasksService.updateStatus(taskId, {
          status: 'FAILED',
          movedBy: systemFailureMovedBy(execId),
        });
        moved.push([execId, taskId]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`execution_sweeper_task_release_failed taskId=${taskId} error=${message}`);
      }
    }
    if (moved.length === 0) return;

    // 3. Pós-checagem: callback real chegou no meio? Compensa para DONE.
    const after = await this.readOutcomes(moved.map(([execId]) => execId));
    for (const [execId, taskId] of moved) {
      const outcome = after.get(execId);
      if (outcome?.source !== 'agent' || outcome.success !== true) continue;
      try {
        await this.tasksService.updateStatus(taskId, {
          status: 'DONE',
          movedBy: systemFailureMovedBy(execId),
        });
        this.logger.warn(`execution_sweeper_task_compensated taskId=${taskId} executionId=${execId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`execution_sweeper_task_compensate_failed taskId=${taskId} error=${message}`);
      }
    }
  }

  /** Lê `audit.outcome` atual de um lote de execuções (1 query). */
  private async readOutcomes(
    executionIds: string[],
  ): Promise<Map<string, { source?: string; success?: boolean }>> {
    const pedidos = await this.prisma.dPedido.findMany({
      where: { chave: { in: executionIds.map((id) => BigInt(id)) } },
      select: { chave: true, dados: true },
    });
    const map = new Map<string, { source?: string; success?: boolean }>();
    for (const p of pedidos) {
      const outcome = (p.dados as { audit?: { outcome?: { source?: string; success?: boolean } } } | null)
        ?.audit?.outcome;
      if (outcome) map.set(p.chave.toString(), outcome);
    }
    return map;
  }

  /**
   * Efeitos colaterais de uma execução encerrada pelo sweeper: linha de log de
   * sistema e evento `execution.failed`. Falhas são logadas e não propagam —
   * a persistência já ocorreu (Padrão #7: efeitos só após persistir).
   *
   * @param row - Linha devolvida pelo `encerrarVencidas` (RETURNING)
   */
  private async emitEffects(row: ExecucaoEncerradaRow): Promise<void> {
    const executionId = row.chave.toString();
    const audit = row.dados?.audit;
    const projectId = audit?.projectId ?? row.idLocEscritu?.toString() ?? '';
    const agentId = audit?.agentId ?? '0';
    const correlationId = audit?.correlationId ?? `sweeper-${executionId}`;
    const taskId = row.dados?.task?.id;

    try {
      await this.logService.recordSystem({
        executionId,
        projectId,
        agentId,
        correlationId,
        line: `Execucao encerrada pelo sistema: ${row.reason}`,
        code: row.reason,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`execution_sweeper_log_failed executionId=${executionId} error=${message}`);
    }

    try {
      await this.eventProducer.addInternalEvent(
        'execution.failed',
        {
          executionId,
          projectId,
          agentId,
          ...(taskId ? { taskId } : {}),
          reason: row.reason,
          errorCode: row.reason,
        },
        correlationId,
        { source: ExecutionRunningSweeperService.name },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`execution_sweeper_emit_failed executionId=${executionId} error=${message}`);
    }
  }
}
