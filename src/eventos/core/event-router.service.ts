import { Injectable, Logger } from '@nestjs/common';
import { AuditLogConsumer } from '../consumers/audit-log.consumer';
import type { IEvent } from '../interfaces/event.interface';
import type { IEventConsumer } from '../interfaces/consumer.interface';

/**
 * Decide quais consumers invocar para um dado evento.
 *
 * Em Task#1 F7, somente `AuditLogConsumer` está habilitado — é
 * catch-all e SEMPRE invocado. Task#2 adiciona Notification e Webhook
 * consumers, com lógica de detecção via prefix.
 *
 * Helpers `isXxxEvent` ficam aqui (privados) para Task#2 simplesmente
 * descomentar e ligar consumers extras. Reviewer pode validar que a
 * lógica de roteamento NÃO está dentro do Producer ou dos Consumers.
 */
@Injectable()
export class EventRouterService {
  private readonly logger = new Logger(EventRouterService.name);

  constructor(private readonly auditConsumer: AuditLogConsumer) {}

  /**
   * Retorna a lista de consumers a invocar para o evento.
   *
   * Em Task#1 F7: SEMPRE retorna `[auditConsumer]`. Task#2 estende.
   *
   * @param event - Evento canônico V2.
   * @returns Lista (não-vazia em Task#1) de consumers a invocar.
   */
  route(event: IEvent): ReadonlyArray<IEventConsumer> {
    const consumers: IEventConsumer[] = [this.auditConsumer];

    // Task#2 (placeholders intencionais — remover ao implementar):
    // if (this.isNotifyTrigger(event.type)) consumers.push(this.notificationConsumer);
    // if (this.isWebhookTrigger(event.type)) consumers.push(this.webhookConsumer);

    this.logger.debug(
      `Route: type=${event.type} consumers=[${consumers.map((c) => c.name).join(',')}]`,
    );
    return consumers;
  }

  // ============== Helpers de detecção (privados — para Task#2) ==============

  /** Audit: catch-all em Task#1 — TODOS os eventos vão para audit. */
  // private isAuditEvent(_type: string): boolean {
  //   return true;
  // }

  /** Notification triggers: eventos relevantes para usuários (Task#2). */
  // private isNotifyTrigger(type: string): boolean {
  //   return (
  //     type.startsWith('task.') ||
  //     type.startsWith('execution.awaiting_approval') ||
  //     type.startsWith('execution.completed') ||
  //     type.startsWith('execution.failed')
  //   );
  // }

  /** Webhook triggers: eventos que disparam outbound (Task#2). */
  // private isWebhookTrigger(type: string): boolean {
  //   return (
  //     type.startsWith('task.') ||
  //     type.startsWith('project.') ||
  //     type.startsWith('execution.')
  //   );
  // }
}
