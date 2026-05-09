import { Injectable } from '@nestjs/common';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subMonths,
  parseISO,
} from 'date-fns';

/** Timezone canônico do sistema V2 (America/Sao_Paulo). */
const BRAZIL_TIMEZONE = 'America/Sao_Paulo';

/** Estrutura de intervalo de datas retornado pelos helpers. */
export interface DateRange {
  gte: Date;
  lte: Date;
}

/**
 * Serviço canônico de timezone — America/Sao_Paulo (UTC-3).
 *
 * Centraliza TODA construção de intervalos de data no sistema V2.
 * Usar este serviço em QUALQUER lugar que precise filtrar por data para
 * garantir consistência com o timezone de Brasília.
 *
 * Regra canônica (devari-backend-patterns.md §4):
 * - NUNCA usar `new Date(str + 'T00:00:00.000Z')` — UTC, não Brasília
 * - NUNCA usar `setHours()` — depende do timezone do servidor
 * - SEMPRE usar TimezoneService
 *
 * @example
 * ```typescript
 * // Em um service com filtro de data
 * constructor(private readonly timezoneService: TimezoneService) {}
 *
 * const filtro = this.timezoneService.applyDateFilters('2026-01-01', '2026-01-31');
 * const entidades = await this.prisma.dEntidade.findMany({
 *   where: { chcriacao: filtro }
 * });
 * ```
 */
@Injectable()
export class TimezoneService {
  /**
   * Converte uma data UTC para o timezone de Brasília.
   *
   * @param date - Data em UTC
   * @returns Data representada no timezone America/Sao_Paulo
   *
   * @example
   * ```typescript
   * const zonadBrasil = timezoneService.toBrazilTime(new Date('2026-01-15T12:00:00Z'));
   * // 2026-01-15T09:00:00 (UTC-3)
   * ```
   */
  toBrazilTime(date: Date): Date {
    return toZonedTime(date, BRAZIL_TIMEZONE);
  }

  /**
   * Converte uma data no timezone de Brasília para UTC.
   *
   * @param date - Data no timezone America/Sao_Paulo
   * @returns Data em UTC
   *
   * @example
   * ```typescript
   * const utc = timezoneService.fromBrazilTime(new Date('2026-01-15T09:00:00'));
   * // 2026-01-15T12:00:00Z (UTC)
   * ```
   */
  fromBrazilTime(date: Date): Date {
    return fromZonedTime(date, BRAZIL_TIMEZONE);
  }

  /**
   * Retorna o início do dia (00:00:00.000) no timezone de Brasília em UTC.
   *
   * @param date - Data de referência (qualquer timezone)
   * @returns Date representando 00:00:00.000 em America/Sao_Paulo, em UTC
   *
   * @example
   * ```typescript
   * const inicio = timezoneService.toStartOfDayBrazil(new Date('2026-05-09T18:00:00Z'));
   * // 2026-05-09T03:00:00.000Z (= 00:00:00 Brasília)
   * ```
   */
  toStartOfDayBrazil(date: Date): Date {
    const zonedDate = toZonedTime(date, BRAZIL_TIMEZONE);
    const startZoned = startOfDay(zonedDate);
    return fromZonedTime(startZoned, BRAZIL_TIMEZONE);
  }

  /**
   * Retorna o fim do dia (23:59:59.999) no timezone de Brasília em UTC.
   *
   * @param date - Data de referência (qualquer timezone)
   * @returns Date representando 23:59:59.999 em America/Sao_Paulo, em UTC
   *
   * @example
   * ```typescript
   * const fim = timezoneService.toEndOfDayBrazil(new Date('2026-05-09T18:00:00Z'));
   * // 2026-05-10T02:59:59.999Z (= 23:59:59.999 Brasília)
   * ```
   */
  toEndOfDayBrazil(date: Date): Date {
    const zonedDate = toZonedTime(date, BRAZIL_TIMEZONE);
    const endZoned = endOfDay(zonedDate);
    return fromZonedTime(endZoned, BRAZIL_TIMEZONE);
  }

  /**
   * Aplica filtros de data em strings YYYY-MM-DD para o timezone de Brasília.
   *
   * Converte strings de data para um intervalo `{ gte, lte }` adequado
   * para uso em cláusulas `where` do Prisma. Respeita o timezone de Brasília.
   *
   * @param from - Data inicial no formato YYYY-MM-DD
   * @param to - Data final no formato YYYY-MM-DD
   * @returns Objeto `{ gte: Date, lte: Date }` para uso em query Prisma
   *
   * @example
   * ```typescript
   * const filtro = timezoneService.applyDateFilters('2026-01-01', '2026-01-31');
   * // {
   * //   gte: 2026-01-01T03:00:00.000Z (= 00:00:00 Brasília)
   * //   lte: 2026-01-31T02:59:59.999Z (= 23:59:59.999 Brasília)
   * // }
   *
   * // Uso em Prisma:
   * const entidades = await prisma.dEntidade.findMany({
   *   where: { chcriacao: filtro }
   * });
   * ```
   */
  applyDateFilters(from: string, to: string): DateRange {
    const fromDate = parseISO(from);
    const toDate = parseISO(to);
    return {
      gte: this.toStartOfDayBrazil(fromDate),
      lte: this.toEndOfDayBrazil(toDate),
    };
  }

  /**
   * Retorna o intervalo de datas para um período pré-definido no timezone de Brasília.
   *
   * @param period - Período desejado: 'today', 'week', 'month', 'lastMonth'
   * @returns Objeto `{ gte: Date, lte: Date }` para uso em query Prisma
   *
   * @example
   * ```typescript
   * // Hoje (Brasília)
   * const hoje = timezoneService.getPeriodDates('today');
   *
   * // Esta semana (segunda a domingo, Brasília)
   * const semana = timezoneService.getPeriodDates('week');
   *
   * // Este mês (1º ao último dia, Brasília)
   * const mes = timezoneService.getPeriodDates('month');
   *
   * // Mês anterior (Brasília)
   * const mesPassado = timezoneService.getPeriodDates('lastMonth');
   * ```
   */
  getPeriodDates(period: 'today' | 'week' | 'month' | 'lastMonth'): DateRange {
    const now = new Date();
    const zonedNow = toZonedTime(now, BRAZIL_TIMEZONE);

    switch (period) {
      case 'today': {
        const start = startOfDay(zonedNow);
        const end = endOfDay(zonedNow);
        return {
          gte: fromZonedTime(start, BRAZIL_TIMEZONE),
          lte: fromZonedTime(end, BRAZIL_TIMEZONE),
        };
      }
      case 'week': {
        const start = startOfWeek(zonedNow, { weekStartsOn: 1 }); // segunda-feira
        const end = endOfWeek(zonedNow, { weekStartsOn: 1 }); // domingo
        return {
          gte: fromZonedTime(start, BRAZIL_TIMEZONE),
          lte: fromZonedTime(end, BRAZIL_TIMEZONE),
        };
      }
      case 'month': {
        const start = startOfMonth(zonedNow);
        const end = endOfMonth(zonedNow);
        return {
          gte: fromZonedTime(start, BRAZIL_TIMEZONE),
          lte: fromZonedTime(end, BRAZIL_TIMEZONE),
        };
      }
      case 'lastMonth': {
        const lastMonth = subMonths(zonedNow, 1);
        const start = startOfMonth(lastMonth);
        const end = endOfMonth(lastMonth);
        return {
          gte: fromZonedTime(start, BRAZIL_TIMEZONE),
          lte: fromZonedTime(end, BRAZIL_TIMEZONE),
        };
      }
    }
  }
}
