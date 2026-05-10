import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as crypto from 'crypto';
import type { IEvent } from '../interfaces/event.interface';
import type { IEventConsumer } from '../interfaces/consumer.interface';

/** Backoff em milissegundos por tentativa (1s, 2s, 4s, 8s, 16s). */
const BACKOFF_SCHEDULE_MS: ReadonlyArray<number> = [1_000, 2_000, 4_000, 8_000, 16_000];

/**
 * Estado de retry pendente.
 */
interface RetryEntry {
  /** Identificador único da entrada (event correlationId + consumer.name + nonce). */
  id: string;
  attempt: number;
  consumerName: string;
  timeoutHandle: NodeJS.Timeout;
}

/**
 * Backoff exponencial: 1/2/4/8/16s. Máximo 5 tentativas.
 *
 * Implementação V2 MVP: `setTimeout` em memória — simples e suficiente
 * para escala MVP. ADR-V2-019 (a redigir) documenta a migração para
 * BullMQ/Redis em F14 (hardening).
 *
 * Limitação aceita: process restart perde retries pendentes. Mitigado
 * por idempotência dos consumers (audit é INSERT, NotificationConsumer
 * deve checar `identificadorExterno` em Task#2).
 */
@Injectable()
export class IntelligentRetryService implements OnModuleDestroy {
  private readonly logger = new Logger(IntelligentRetryService.name);
  private readonly pending = new Map<string, RetryEntry>();
  private maxAttemptsExceeded = 0;

  /**
   * Agenda uma nova tentativa. Se a tentativa exceder o máximo, registra
   * "exhausted" e descarta.
   *
   * @param event - Evento a reprocessar.
   * @param consumer - Consumer alvo.
   * @param attempt - Número da próxima tentativa (1..5).
   * @param executor - Função que invoca o consumer (recebe event + consumer).
   *                   Deve retornar Promise. Se rejeitar, o retry é re-agendado.
   *
   * @returns ID interno do retry (útil para `cancel`).
   */
  schedule(
    event: IEvent,
    consumer: IEventConsumer,
    attempt: number,
    executor: (e: IEvent, c: IEventConsumer) => Promise<void>,
  ): string | null {
    if (attempt > BACKOFF_SCHEDULE_MS.length) {
      this.maxAttemptsExceeded += 1;
      this.logger.error(
        `Retry exhausted: consumer=${consumer.name} type=${event.type} ` +
          `correlationId=${event.correlationId} (max ${BACKOFF_SCHEDULE_MS.length} tentativas)`,
      );
      return null;
    }

    const delayMs = BACKOFF_SCHEDULE_MS[attempt - 1];
    const id = `${event.correlationId}:${consumer.name}:${crypto.randomUUID()}`;

    const handle = setTimeout(() => {
      this.pending.delete(id);
      executor(event, consumer)
        .then(() => {
          this.logger.log(
            `Retry success: consumer=${consumer.name} type=${event.type} ` +
              `attempt=${attempt} correlationId=${event.correlationId}`,
          );
        })
        .catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Retry attempt=${attempt} failed: consumer=${consumer.name} ` +
              `type=${event.type} correlationId=${event.correlationId} error=${errMsg}`,
          );
          this.schedule(event, consumer, attempt + 1, executor);
        });
    }, delayMs);

    // Em testes (jest fakeTimers) o handle pode não suportar unref().
    if (typeof handle.unref === 'function') {
      handle.unref();
    }

    this.pending.set(id, {
      id,
      attempt,
      consumerName: consumer.name,
      timeoutHandle: handle,
    });

    this.logger.debug(
      `Retry scheduled: consumer=${consumer.name} type=${event.type} ` +
        `attempt=${attempt} delayMs=${delayMs} correlationId=${event.correlationId}`,
    );
    return id;
  }

  /**
   * Cancela um retry pendente (best-effort).
   */
  cancel(id: string): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    clearTimeout(entry.timeoutHandle);
    this.pending.delete(id);
    return true;
  }

  /**
   * Quantidade de retries pendentes em memória.
   */
  getPendingCount(): number {
    return this.pending.size;
  }

  /**
   * Quantidade total de eventos que excederam o máximo de tentativas
   * desde o último restart.
   */
  getMaxAttemptsExceeded(): number {
    return this.maxAttemptsExceeded;
  }

  /**
   * Limpa todos os timers pendentes (graceful shutdown).
   */
  onModuleDestroy(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeoutHandle);
    }
    this.pending.clear();
  }
}

export const __TEST_BACKOFF_SCHEDULE_MS = BACKOFF_SCHEDULE_MS;
