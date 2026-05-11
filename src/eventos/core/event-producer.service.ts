import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { CorrelationIdService } from '../../common/services/correlation-id.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { IntelligentRetryService } from './intelligent-retry.service';
import { EventRouterService } from './event-router.service';
import { TelemetryService } from '../monitoring/telemetry.service';
import { SensitiveDataSanitizerService } from '../../common/security/sensitive-data-sanitizer.service';
import { ALL_EVENT_TYPES_SET } from './event-types';
import type { IEvent } from '../interfaces/event.interface';
import type { IEventProducer } from '../interfaces/event-producer.interface';
import type { IEventConsumer } from '../interfaces/consumer.interface';

/**
 * `EventProducerService` — ponto único de emissão de eventos no V2.
 *
 * Regras (Padrão #14, devari-backend-patterns):
 *  - Adapters NUNCA emitem direto via BullMQ ou prisma.dEvento.create.
 *  - Producer é injetado via `IEventProducer` quando o módulo emissor não
 *    pode importar `EventProducerService` (Engine — ADR-V2-005).
 *  - É chamado APÓS persistência bem-sucedida (Padrão #7). Falha de
 *    consumer NÃO derruba o caller.
 *
 * Workflow do `addInternalEvent`:
 *  1. Valida `type ∈ ALL_EVENT_TYPES_SET` (throw BadRequest se inválido).
 *  2. Enriquece com `metadata.source`/`timestamp`/`correlationId`.
 *  3. `Telemetry.trackEmitted(type)`.
 *  4. `Router.route(event)` → lista de consumers.
 *  5. Para cada consumer:
 *     a. `CircuitBreaker.canExecute(consumer.name)` → skip se aberto.
 *     b. `Promise.allSettled([consumer.handle(event)])` em paralelo.
 *     c. Sucesso → `CB.reportSuccess` + `Telemetry.trackSucceeded`.
 *     d. Falha → `CB.reportFailure` + `Telemetry.trackFailed`
 *        + `IntelligentRetry.schedule`.
 *  6. Resolve void (fire-and-forget para o caller).
 *
 * V2 MVP: sync mode (Promise.allSettled). ADR-V2-019 (a redigir) documenta
 * a migração para BullMQ/Redis em F14.
 */
@Injectable()
export class EventProducerService implements IEventProducer {
  private readonly logger = new Logger(EventProducerService.name);

  constructor(
    private readonly router: EventRouterService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly retry: IntelligentRetryService,
    private readonly telemetry: TelemetryService,
    private readonly correlationIdService: CorrelationIdService,
    private readonly sanitizer: SensitiveDataSanitizerService,
  ) {}

  async addInternalEvent<TPayload extends Record<string, unknown>>(
    type: string,
    payload: TPayload,
    correlationId: string,
    options?: { source?: string },
  ): Promise<void> {
    if (!ALL_EVENT_TYPES_SET.has(type)) {
      // Reviewer rejeita emissão de tipos desconhecidos. Retornar erro
      // explícito para que o desenvolvedor adicione em event-types.ts.
      throw new BadRequestException(
        `EventProducer: type "${type}" não está em ALL_EVENT_TYPES. ` +
          `Adicione em src/eventos/core/event-types.ts antes de emitir.`,
      );
    }

    const effectiveCorrelationId =
      correlationId || this.correlationIdService.getOrGenerate();
    const source = options?.source ?? 'unknown';

    const event: IEvent<TPayload> = {
      type,
      payload: this.sanitizer.sanitizeRecord(payload),
      correlationId: effectiveCorrelationId,
      metadata: {
        source,
        timestamp: new Date().toISOString(),
        correlationId: effectiveCorrelationId,
      },
    };

    this.telemetry.trackEmitted(type);
    const consumers = this.router.route(event);

    if (consumers.length === 0) {
      this.logger.debug(
        `No consumers for type=${type} correlationId=${effectiveCorrelationId}`,
      );
      return;
    }

    // Executa todos os consumers em paralelo. Falhas isoladas — não
    // derrubam o caller nem outros consumers.
    const tasks = consumers.map((consumer) => this.executeConsumer(consumer, event));

    // Aguarda todos terminarem (sucesso ou falha) antes de resolver.
    // Caller já fez await da persistência — aguardar mais alguns ms aqui é OK.
    // Se a latência se tornar problema (R4 do plano), trocar por
    // `void Promise.allSettled(tasks)` para fire-and-forget total.
    await Promise.allSettled(tasks);
  }

  /**
   * Executa 1 consumer com proteção CB + retry. Não relança erros para
   * o caller (isolamento).
   */
  private async executeConsumer(consumer: IEventConsumer, event: IEvent): Promise<void> {
    if (!this.circuitBreaker.canExecute(consumer.name)) {
      this.logger.warn(
        `CircuitBreaker[${consumer.name}] open — skipping event ` +
          `type=${event.type} correlationId=${event.correlationId}`,
      );
      this.telemetry.trackFailed(event.type);
      return;
    }

    const startedAt = Date.now();
    try {
      await consumer.handle(event);
      const elapsed = Date.now() - startedAt;
      this.circuitBreaker.reportSuccess(consumer.name);
      this.telemetry.trackSucceeded(event.type, elapsed);
    } catch (err: unknown) {
      const elapsed = Date.now() - startedAt;
      this.circuitBreaker.reportFailure(consumer.name);
      this.telemetry.trackFailed(event.type);
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Consumer[${consumer.name}] failed: type=${event.type} ` +
          `correlationId=${event.correlationId} elapsedMs=${elapsed} error=${errMsg}`,
      );
      // Agenda retry (attempt 1) via IntelligentRetry. Executor invoca
      // CB+telemetry recursivamente via este mesmo método.
      this.retry.schedule(event, consumer, 1, (e, c) => this.executeConsumer(c, e));
    }
  }
}
