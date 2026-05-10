import type { IEvent } from './event.interface';

/**
 * Contrato canônico de Consumer V2.
 *
 * Todo consumer (audit-log, notification, webhook) implementa esta
 * interface. O `EventRouterService` retorna uma lista deles e o
 * `EventProducerService` invoca `handle()` em paralelo via Promise.allSettled.
 *
 * Falha de um consumer NÃO derruba os outros (regra de isolamento).
 */
export interface IEventConsumer {
  /**
   * Nome curto do consumer (usado pelo CircuitBreaker e logs).
   * Convenção: `kebab-case` (ex: `audit-log`, `notification`, `webhook`).
   */
  readonly name: string;

  /**
   * Processa o evento. Deve ser idempotente quando possível
   * (consumers podem ser invocados em retry).
   *
   * @param event - Evento canônico V2
   * @throws qualquer Error → CircuitBreaker conta falha + Retry agenda
   */
  handle(event: IEvent): Promise<void>;
}
