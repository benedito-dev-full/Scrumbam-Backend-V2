import { Injectable, Logger } from '@nestjs/common';

type TelegramMetricType = 'text' | 'voice' | 'command' | 'intent';

/**
 * Metricas leves em memoria para F10 Bloco D.
 *
 * Mantem contadores por tipo de mensagem e amostras recentes de latencia da
 * transcricao Groq. Nao cria tabela, migration ou dependencia externa.
 */
@Injectable()
export class TelegramMetricsService {
  private readonly logger = new Logger(TelegramMetricsService.name);
  private readonly counters = new Map<TelegramMetricType, number>();
  private readonly transcriptionLatenciesMs: number[] = [];

  /**
   * Incrementa contador de evento Telegram por tipo.
   *
   * @param type - Tipo de evento observado
   * @param correlationId - update_id do Telegram como string
   */
  recordEvent(type: TelegramMetricType, correlationId: string): void {
    const nextValue = (this.counters.get(type) ?? 0) + 1;
    this.counters.set(type, nextValue);
    this.logger.debug(
      `telegram_metric_event type=${type} count=${nextValue} correlationId=${correlationId}`,
    );
  }

  /**
   * Registra latencia de download + transcricao Groq e calcula P95 local.
   *
   * @param durationMs - Duracao em milissegundos
   * @param correlationId - update_id do Telegram como string
   */
  recordTranscriptionLatency(durationMs: number, correlationId: string): void {
    this.transcriptionLatenciesMs.push(durationMs);
    if (this.transcriptionLatenciesMs.length > 200) {
      this.transcriptionLatenciesMs.shift();
    }

    this.logger.log(
      `telegram_metric_transcription_latency durationMs=${durationMs} p95Ms=${this.getTranscriptionP95()} correlationId=${correlationId}`,
    );
  }

  getCount(type: TelegramMetricType): number {
    return this.counters.get(type) ?? 0;
  }

  getTranscriptionP95(): number {
    if (this.transcriptionLatenciesMs.length === 0) {
      return 0;
    }

    const sorted = [...this.transcriptionLatenciesMs].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[Math.max(index, 0)];
  }
}
