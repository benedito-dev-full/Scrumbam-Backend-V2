import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EXECUTION_QUEUE_NAME } from './execution-queue.constants';

export interface ExecutionRunJobData {
  executionId: string;
  projectId: string;
  agentId: string;
  enqueuedAt: string;
  /**
   * Nº de 409 PROJECT_BUSY já recebidos (ADR-V2-082). Ausente = 1º dispatch.
   * Preenchido por `enqueueRetry`.
   */
  busyAttempt?: number;
  /**
   * ISO do 1º 409 PROJECT_BUSY desta execução — base da espera POR TEMPO
   * (ADR-V2-083, decisão CEO P4). Preenchido por `enqueueRetry`.
   */
  busySince?: string;
}

@Injectable()
export class ExecutionQueueService {
  private readonly logger = new Logger(ExecutionQueueService.name);

  constructor(
    @InjectQueue(EXECUTION_QUEUE_NAME)
    private readonly queue: Queue<ExecutionRunJobData>,
  ) {}

  async enqueueExecution(input: Omit<ExecutionRunJobData, 'enqueuedAt'>): Promise<ExecutionRunJobData> {
    const data: ExecutionRunJobData = {
      ...input,
      enqueuedAt: new Date().toISOString(),
    };

    await this.queue.add('run', data, {
      jobId: input.executionId,
      attempts: 1,
      removeOnComplete: { count: 500, age: 86400 },
      removeOnFail: { count: 1000, age: 604800 },
    });

    this.logger.log(
      `execution_queued executionId=${data.executionId} projectId=${data.projectId} agentId=${data.agentId}`,
    );

    return data;
  }

  /**
   * Re-enfileira uma execução devolvida para QUEUED após 409 PROJECT_BUSY
   * do agente (ADR-V2-082), com atraso (backoff calculado pelo processor).
   *
   * `jobId = ${executionId}-busy-${attempt}` — único por tentativa (o jobId
   * original `executionId` fica retido por `removeOnComplete` e deduplicaria
   * o retry). Sem `:` (BullMQ rejeita `:` em custom id).
   *
   * @param input - Dados do job (executionId/projectId/agentId/busySince)
   * @param opts.attempt - Tentativa (1-based) que gerou o retry
   * @param opts.delayMs - Atraso até o próximo dispatch
   * @returns Dados do job enfileirado
   *
   * @example
   * ```typescript
   * await queue.enqueueRetry({ executionId: '123', projectId: '20', agentId: '30' }, { attempt: 1, delayMs: 30000 });
   * ```
   */
  async enqueueRetry(
    input: Omit<ExecutionRunJobData, 'enqueuedAt' | 'busyAttempt'>,
    opts: { attempt: number; delayMs: number },
  ): Promise<ExecutionRunJobData> {
    const data: ExecutionRunJobData = {
      ...input,
      busyAttempt: opts.attempt,
      enqueuedAt: new Date().toISOString(),
    };

    await this.queue.add('run', data, {
      jobId: buildBusyRetryJobId(input.executionId, opts.attempt),
      delay: opts.delayMs,
      attempts: 1,
      removeOnComplete: { count: 500, age: 86400 },
      removeOnFail: { count: 1000, age: 604800 },
    });

    this.logger.log(
      `execution_requeued_busy executionId=${data.executionId} attempt=${opts.attempt} delayMs=${opts.delayMs}`,
    );

    return data;
  }
}

/**
 * jobId do retry de PROJECT_BUSY — único por tentativa e sem `:`.
 *
 * @param executionId - DPedido.chave
 * @param attempt - Tentativa (1-based)
 * @returns `${executionId}-busy-${attempt}`
 */
export function buildBusyRetryJobId(executionId: string, attempt: number): string {
  return `${executionId}-busy-${attempt}`;
}
