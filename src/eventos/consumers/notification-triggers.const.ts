import { EVENT_TYPES } from '../core/event-types';

/**
 * Eventos que geram notificacoes in-app (`DEvento.idClasse=-490`).
 */
export const NOTIFICATION_TRIGGERS: ReadonlySet<string> = new Set<string>([
  EVENT_TYPES.TASK_STATUS_CHANGED,
  EVENT_TYPES.TASK_ASSIGNED,
  EVENT_TYPES.EXECUTION_AWAITING_APPROVAL,
  EVENT_TYPES.EXECUTION_COMPLETED,
  EVENT_TYPES.EXECUTION_FAILED,
]);

/**
 * Verifica se um tipo canonico deve acionar `NotificationConsumer`.
 */
export function isNotificationTrigger(type: string): boolean {
  return NOTIFICATION_TRIGGERS.has(type);
}
