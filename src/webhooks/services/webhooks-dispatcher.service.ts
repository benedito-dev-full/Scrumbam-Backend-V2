import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import {
  WEBHOOK_DISPATCH_QUEUE,
  WebhookDispatchJobData,
} from '../types/webhook-dispatch-job';

export interface EnqueueWebhookDispatchInput {
  webhookId: string;
  eventType: string;
  eventId: string;
  payload: unknown;
  deliveryId?: string;
  attempt?: number;
}

@Injectable()
export class WebhooksDispatcherService {
  private readonly logger = new Logger(WebhooksDispatcherService.name);

  constructor(
    @InjectQueue(WEBHOOK_DISPATCH_QUEUE)
    private readonly queue: Queue<WebhookDispatchJobData>,
  ) {}

  async enqueueDispatch(input: EnqueueWebhookDispatchInput): Promise<WebhookDispatchJobData> {
    const data: WebhookDispatchJobData = {
      webhookId: BigInt(input.webhookId).toString(),
      eventType: input.eventType,
      eventId: BigInt(input.eventId).toString(),
      payload: input.payload,
      deliveryId: input.deliveryId ?? randomUUID(),
      attempt: input.attempt ?? 1,
    };

    await this.queue.add('dispatch', data, {
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
      jobId: `${data.deliveryId}:${data.attempt}`,
    });

    this.logger.log(
      `webhook_dispatch_enqueued webhookId=${data.webhookId} eventType=${data.eventType} ` +
        `eventId=${data.eventId} deliveryId=${data.deliveryId} attempt=${data.attempt}`,
    );

    return data;
  }
}
