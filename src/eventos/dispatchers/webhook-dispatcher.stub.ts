import { Injectable, Logger } from '@nestjs/common';
import type { IEvent } from '../interfaces/event.interface';
import type {
  IWebhookDispatcher,
  WebhookDispatchConfig,
  WebhookDispatchResult,
} from '../interfaces/webhook-dispatcher.interface';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function maskEndpoint(endpoint: unknown): string {
  if (typeof endpoint !== 'string' || endpoint.length === 0) return '<unset>';
  try {
    const parsed = new URL(endpoint);
    return `${parsed.protocol}//${parsed.host}/***`;
  } catch {
    return endpoint.length <= 12 ? '***' : `${endpoint.slice(0, 8)}***`;
  }
}

/**
 * Stub de dispatcher outbound. Nao executa chamada externa nesta task.
 *
 * Este provider fixa o contrato de integracao para F7 Task #2 sem antecipar
 * HTTP real, HMAC, retry de rede ou persistencia de tentativa `DEvento -491`.
 *
 * @see ADR-V2-030 Contrato de dispatcher stub.
 */
@Injectable()
export class WebhookDispatcherStub implements IWebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcherStub.name);

  /**
   * Registra a intencao de dispatch e retorna resultado fake.
   *
   * @param config - Configuracao `DTabela -470` selecionada pelo consumer.
   * @param event - Evento canonico que seria enviado ao endpoint externo.
   * @returns Resultado stub indicando que o envio externo foi ignorado.
   *
   * @example
   * ```typescript
   * const result = await dispatcher.dispatch(config, event);
   * // result.skipped === true
   * ```
   */
  async dispatch(
    config: WebhookDispatchConfig,
    event: IEvent,
  ): Promise<WebhookDispatchResult> {
    const meta = asRecord(config.metaDados);
    const endpoint = maskEndpoint(meta.url ?? meta.endpoint);

    this.logger.debug(
      `webhook stub skipped: config=${config.chave.toString()} endpoint=${endpoint} ` +
        `type=${event.type} correlationId=${event.correlationId}`,
    );

    return { skipped: true, reason: 'stub' };
  }
}
