import { Injectable, Logger } from '@nestjs/common';
import { AuditLogConsumer } from '../consumers/audit-log.consumer';
import { NotificationConsumer } from '../consumers/notification.consumer';
import { WebhookConsumer } from '../consumers/webhook.consumer';
import { isNotificationTrigger } from '../consumers/notification-triggers.const';
import { isWebhookTrigger } from '../consumers/webhook-triggers.const';
import type { IEvent } from '../interfaces/event.interface';
import type { IEventConsumer } from '../interfaces/consumer.interface';

/**
 * Decide quais consumers invocar para um dado evento.
 *
 * AuditLogConsumer e catch-all e SEMPRE invocado. Notification e Webhook
 * entram apenas para triggers explicitos.
 */
@Injectable()
export class EventRouterService {
  private readonly logger = new Logger(EventRouterService.name);

  constructor(
    private readonly auditConsumer: AuditLogConsumer,
    private readonly notificationConsumer: NotificationConsumer,
    private readonly webhookConsumer: WebhookConsumer,
  ) {}

  /**
   * Retorna a lista de consumers a invocar para o evento.
   *
   * @param event - Evento canonico V2.
   * @returns Lista de consumers a invocar.
   */
  route(event: IEvent): ReadonlyArray<IEventConsumer> {
    const consumers: IEventConsumer[] = [this.auditConsumer];

    if (isNotificationTrigger(event.type)) {
      consumers.push(this.notificationConsumer);
    }
    if (isWebhookTrigger(event.type)) {
      consumers.push(this.webhookConsumer);
    }

    this.logger.debug(
      `Route: type=${event.type} consumers=[${consumers.map((c) => c.name).join(',')}]`,
    );
    return consumers;
  }
}
