import type { IEvent } from './event.interface';

export const WEBHOOK_DISPATCHER_TOKEN = Symbol('WEBHOOK_DISPATCHER');

/**
 * Configuracao canonica de webhook carregada de `DTabela.idClasse=-470`.
 */
export interface WebhookDispatchConfig {
  /**
   * Chave da linha `DTabela` de configuracao.
   */
  chave: bigint;
  /**
   * Nome administrativo da configuracao.
   */
  nome: string;
  /**
   * Organizacao proprietaria da configuracao.
   */
  idLocEscrituracao: bigint | null;
  /**
   * JSON livre da configuracao, incluindo `events` e endpoint futuro.
   */
  metaDados: unknown;
}

/**
 * Resultado minimo do dispatcher outbound.
 */
export interface WebhookDispatchResult {
  /**
   * Indica que a entrega externa foi ignorada pelo stub.
   */
  skipped: boolean;
  /**
   * Razao textual para auditoria/log.
   */
  reason: string;
}

/**
 * Contrato do dispatcher outbound de webhooks.
 *
 * F7 Task #2 registra uma implementacao stub. O dispatcher real de F12 deve
 * manter este contrato e acrescentar HMAC/retry/auto-disable sem mudar o
 * consumer.
 */
export interface IWebhookDispatcher {
  /**
   * Despacha um evento para uma configuracao de webhook.
   *
   * @param config - Configuracao `DTabela -470` ja filtrada por organizacao.
   * @param event - Evento canonico V2 a ser despachado.
   * @returns Resultado da tentativa de dispatch.
   */
  dispatch(config: WebhookDispatchConfig, event: IEvent): Promise<WebhookDispatchResult>;
}
