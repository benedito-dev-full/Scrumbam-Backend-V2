import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000] as const;

/**
 * Servico de logica de retentativas e auto-desabilitacao (Pilar 2).
 *
 * Define os delays entre tentativas e o limite de falhas consecutivas antes
 * de desativar o webhook.
 */
@Injectable()
export class WebhooksRetryService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Calcula o delay para a proxima tentativa.
   *
   * @param attempt - Numero da tentativa (1, 2, 3).
   * @returns Delay em milissegundos.
   */
  calcDelay(attempt: number): number {
    return RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[2];
  }

  /**
   * Verifica se o webhook deve ser desabilitado automaticamente.
   *
   * @param failureCount - Contador de falhas consecutivas.
   * @returns Verdadeiro se atingiu o threshold (default 10).
   */
  shouldAutoDisable(failureCount: number): boolean {
    const rawThreshold = this.configService.get<string>(
      'WEBHOOK_AUTO_DISABLE_THRESHOLD',
      '10',
    );
    const threshold = /^\d+$/.test(rawThreshold) ? BigInt(rawThreshold) : 10n;
    return BigInt(failureCount) >= threshold;
  }
}
