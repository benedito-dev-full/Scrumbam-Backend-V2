import { SupportedEvent } from '../constants/supported-events';

export const WEBHOOK_DISPATCH_QUEUE = 'webhook-dispatch-queue';
export const WEBHOOK_ATTEMPT_CLASS_ID = BigInt(-491);
export const WEBHOOK_USER_AGENT = 'Scrumban-Webhooks/1.0';

export interface WebhookDispatchJobData {
  webhookId: string;
  eventType: SupportedEvent | string;
  eventId: string;
  payload: unknown;
  deliveryId: string;
  attempt: number;
}

export interface StoredWebhookDados {
  url: string;
  events: Array<SupportedEvent | string>;
  secretEncrypted: string;
  disabled: boolean;
  failureCount: number;
  createdAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}
