import { Injectable, Logger } from '@nestjs/common';
import { ExecutionRunJobData } from './execution-queue.service';

/**
 * Implementação in-memory do ExecutionQueueService para ambientes sem Redis.
 *
 * Executa jobs de forma síncrona (sem fila real).
 * Jobs não persistem entre restarts.
 */
@Injectable()
export class InMemoryQueueService {
  private readonly logger = new Logger(InMemoryQueueService.name);

  async enqueueExecution(input: Omit<ExecutionRunJobData, 'enqueuedAt'>): Promise<ExecutionRunJobData> {
    const data: ExecutionRunJobData = {
      ...input,
      enqueuedAt: new Date().toISOString(),
    };

    this.logger.log(
      `execution_queued_inmemory executionId=${data.executionId} projectId=${data.projectId} agentId=${data.agentId}`,
    );

    return data;
  }

  /**
   * Paridade de interface com `ExecutionQueueService.enqueueRetry` (ADR-V2-082).
   * Sem Redis não há processor — apenas loga (modo sem fila é fora de escopo).
   *
   * @param input - Dados do job
   * @param opts - Tentativa e atraso
   * @returns Dados do job (não enfileirado de fato)
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
    this.logger.log(
      `execution_requeued_busy_inmemory executionId=${data.executionId} attempt=${opts.attempt} delayMs=${opts.delayMs} (no-op)`,
    );
    return data;
  }
}
