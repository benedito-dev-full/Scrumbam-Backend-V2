import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EXECUTION_QUEUE_NAME } from './execution-queue.constants';

export interface ExecutionRunJobData {
  executionId: string;
  projectId: string;
  agentId: string;
  enqueuedAt: string;
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
}
