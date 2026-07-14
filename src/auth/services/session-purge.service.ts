import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { SessionService } from './session.service';

/**
 * Job de purga de sessões expiradas (F3 — item 3.5).
 *
 * Sem ele, `DTabela` acumularia linhas de sessão vencidas indefinidamente: elas
 * nunca são lidas (o {@link SessionService.inspect} já as trata como `expired`),
 * mas engordam o índice de lookup — que está no caminho quente do refresh.
 *
 * A purga é **soft-delete** (`excluido = true` + `revokedReason: 'expired'`):
 * preserva a trilha forense (quando/como a sessão morreu) sem custo de leitura.
 * Hard-delete de linhas antigas, se um dia fizer sentido, é decisão separada.
 *
 * Frequência: de hora em hora. Expiração é da ordem de dias (idle 7 d /
 * absoluta 30 d) — não há ganho em varrer mais que isso, e o custo é 1 UPDATE
 * em lote (índice parcial cobre o predicado).
 *
 * @see SessionService.purgeExpired — a query em si
 */
@Injectable()
export class SessionPurgeService {
  private readonly logger = new Logger(SessionPurgeService.name);

  constructor(private readonly sessions: SessionService) {}

  /**
   * Varre e revoga sessões vencidas (idle OU absoluta).
   *
   * NUNCA lança: um erro aqui não pode derrubar o scheduler do processo.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async purgarSessoesExpiradas(): Promise<void> {
    if (!this.sessions.isEnabled()) {
      return;
    }

    try {
      await this.sessions.purgeExpired();
    } catch (err) {
      this.logger.error(`Falha na purga de sessões expiradas: ${(err as Error).message}`);
    }
  }
}
