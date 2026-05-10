import { Injectable } from '@nestjs/common';

/** Janela de 1 minuto. */
const MINUTE_MS = 60_000;
/** Janela de 1 hora. */
const HOUR_MS = 60 * 60 * 1000;

interface CounterEntry {
  /** Timestamp da emissão (ms desde epoch). */
  ts: number;
  /** Tipo do evento (key). */
  type: string;
  /** Resultado: emitido / sucesso / falha. */
  outcome: 'emitted' | 'succeeded' | 'failed';
  /** Latência em ms (apenas em outcome=succeeded). */
  latencyMs?: number;
}

/**
 * Telemetria simples em memória — contadores por tipo em janelas
 * deslizantes (1min e 1h).
 *
 * Não persiste. Reseta no restart. Adequado para V2 MVP. F14 substitui
 * por Prometheus/OpenTelemetry.
 */
@Injectable()
export class TelemetryService {
  private readonly entries: CounterEntry[] = [];
  /** Tamanho máximo do buffer para evitar memory leak em alta carga. */
  private readonly maxEntries = 10_000;

  trackEmitted(type: string): void {
    this.push({ ts: Date.now(), type, outcome: 'emitted' });
  }

  trackSucceeded(type: string, latencyMs: number): void {
    this.push({ ts: Date.now(), type, outcome: 'succeeded', latencyMs });
  }

  trackFailed(type: string): void {
    this.push({ ts: Date.now(), type, outcome: 'failed' });
  }

  /**
   * Eventos por minuto agrupados por tipo (apenas emitidos na janela
   * 1min).
   */
  getEventsPerMinute(): Record<string, number> {
    const cutoff = Date.now() - MINUTE_MS;
    const out: Record<string, number> = {};
    for (const e of this.entries) {
      if (e.ts >= cutoff && e.outcome === 'emitted') {
        out[e.type] = (out[e.type] ?? 0) + 1;
      }
    }
    return out;
  }

  /**
   * Total de eventos emitidos na última 1 hora.
   */
  getTotalLastHour(): number {
    const cutoff = Date.now() - HOUR_MS;
    let total = 0;
    for (const e of this.entries) {
      if (e.ts >= cutoff && e.outcome === 'emitted') total += 1;
    }
    return total;
  }

  /**
   * Taxa de falha por tipo na última 1 hora.
   */
  getFailureRateLastHour(): Record<string, { emitted: number; failed: number }> {
    const cutoff = Date.now() - HOUR_MS;
    const out: Record<string, { emitted: number; failed: number }> = {};
    for (const e of this.entries) {
      if (e.ts < cutoff) continue;
      const key = e.type;
      out[key] ??= { emitted: 0, failed: 0 };
      if (e.outcome === 'emitted') out[key].emitted += 1;
      if (e.outcome === 'failed') out[key].failed += 1;
    }
    return out;
  }

  private push(entry: CounterEntry): void {
    this.entries.push(entry);
    // Limpa entries antigas e força tamanho máximo
    const cutoff = Date.now() - HOUR_MS;
    if (this.entries.length > this.maxEntries) {
      // O buffer estourou — drop antigos preservando os mais recentes
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    while (this.entries.length > 0 && this.entries[0].ts < cutoff) {
      this.entries.shift();
    }
  }
}
