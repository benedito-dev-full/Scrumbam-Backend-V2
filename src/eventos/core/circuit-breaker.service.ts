import { Injectable, Logger } from '@nestjs/common';

/**
 * Estado interno por consumer.
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

interface BreakerEntry {
  state: CircuitBreakerState;
  /** Timestamps (ms) das falhas dentro da janela atual. */
  failureTimestamps: number[];
  /** Quando o circuit foi aberto (ms desde epoch). */
  openedAt: number | null;
}

/**
 * Configuração do CircuitBreaker (V2 MVP — sem persistência).
 */
const FAILURE_THRESHOLD = 5;
const FAILURE_WINDOW_MS = 60_000; // 1 min
const RECOVER_AFTER_MS = 30_000; // 30s no estado open antes de half-open

/**
 * CircuitBreaker para isolamento de consumers (Pattern Half-Open).
 *
 * Estados:
 *  - CLOSED: tudo passa, conta falhas em janela 60s.
 *  - OPEN: rejeita execuções (após 5 falhas em 60s).
 *  - HALF_OPEN: após 30s no OPEN, permite UMA tentativa.
 *    Sucesso → CLOSED, falha → OPEN.
 *
 * Estado em memória (Map<consumerName, BreakerEntry>). Não persiste.
 * Process restart reseta — aceitável em V2 MVP (ADR-V2-019 a redigir).
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly state = new Map<string, BreakerEntry>();

  /**
   * Retorna `true` se o consumer pode ser invocado agora.
   * Em estado OPEN, verifica timeout para transitar para HALF_OPEN.
   *
   * @param consumerName - Nome curto (kebab-case) do consumer.
   */
  canExecute(consumerName: string): boolean {
    const entry = this.getOrCreate(consumerName);
    if (entry.state === 'closed') return true;

    if (entry.state === 'open') {
      const opened = entry.openedAt ?? Date.now();
      const elapsed = Date.now() - opened;
      if (elapsed >= RECOVER_AFTER_MS) {
        entry.state = 'half-open';
        this.logger.warn(
          `CircuitBreaker[${consumerName}] open → half-open (elapsed=${elapsed}ms)`,
        );
        return true;
      }
      return false;
    }

    // half-open: permite apenas 1 tentativa, então até a próxima decisão deixa passar.
    return true;
  }

  /**
   * Reporta sucesso: half-open → closed; closed mantém-se.
   */
  reportSuccess(consumerName: string): void {
    const entry = this.getOrCreate(consumerName);
    if (entry.state === 'half-open') {
      this.logger.log(`CircuitBreaker[${consumerName}] half-open → closed (success)`);
    }
    entry.state = 'closed';
    entry.failureTimestamps = [];
    entry.openedAt = null;
  }

  /**
   * Reporta falha: incrementa contador. Se atingir threshold em janela,
   * abre o circuit. Em half-open, falha reabre imediatamente.
   */
  reportFailure(consumerName: string): void {
    const entry = this.getOrCreate(consumerName);
    const now = Date.now();

    if (entry.state === 'half-open') {
      entry.state = 'open';
      entry.openedAt = now;
      entry.failureTimestamps = [now];
      this.logger.error(
        `CircuitBreaker[${consumerName}] half-open → open (re-failure)`,
      );
      return;
    }

    // Append + descarta falhas antigas (fora da janela)
    entry.failureTimestamps.push(now);
    entry.failureTimestamps = entry.failureTimestamps.filter(
      (ts) => now - ts <= FAILURE_WINDOW_MS,
    );

    if (entry.failureTimestamps.length >= FAILURE_THRESHOLD && entry.state === 'closed') {
      entry.state = 'open';
      entry.openedAt = now;
      this.logger.error(
        `CircuitBreaker[${consumerName}] closed → open ` +
          `(${entry.failureTimestamps.length} falhas em ${FAILURE_WINDOW_MS}ms)`,
      );
    }
  }

  /**
   * Estado atual (snapshot).
   */
  getState(consumerName: string): CircuitBreakerState {
    return this.getOrCreate(consumerName).state;
  }

  /**
   * Métricas do consumer (read-only). Usado pelo `/events/health`.
   */
  getMetrics(consumerName: string): {
    state: CircuitBreakerState;
    failuresInWindow: number;
    lastFailureAt: Date | null;
    openedAt: Date | null;
  } {
    const entry = this.getOrCreate(consumerName);
    const last =
      entry.failureTimestamps.length > 0
        ? entry.failureTimestamps[entry.failureTimestamps.length - 1]
        : null;
    return {
      state: entry.state,
      failuresInWindow: entry.failureTimestamps.length,
      lastFailureAt: last !== null ? new Date(last) : null,
      openedAt: entry.openedAt !== null ? new Date(entry.openedAt) : null,
    };
  }

  /**
   * Snapshot completo (todos consumers conhecidos). Usado em health.
   */
  getAllMetrics(): Record<
    string,
    { state: CircuitBreakerState; failuresInWindow: number }
  > {
    const out: Record<string, { state: CircuitBreakerState; failuresInWindow: number }> = {};
    for (const [name, entry] of this.state.entries()) {
      out[name] = {
        state: entry.state,
        failuresInWindow: entry.failureTimestamps.length,
      };
    }
    return out;
  }

  /**
   * Reseta um consumer específico (útil em testes e em endpoints
   * administrativos futuros). NÃO usar em produção sem cuidado.
   */
  reset(consumerName: string): void {
    this.state.delete(consumerName);
  }

  private getOrCreate(consumerName: string): BreakerEntry {
    let entry = this.state.get(consumerName);
    if (!entry) {
      entry = { state: 'closed', failureTimestamps: [], openedAt: null };
      this.state.set(consumerName, entry);
    }
    return entry;
  }
}
