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
}
