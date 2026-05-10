import { BadRequestException, Injectable } from '@nestjs/common';
import { TimezoneService, DateRange } from '../../common/services/timezone.service';

/**
 * DTO de período para queries de flow metrics.
 */
export interface PeriodInput {
  /** Data inicial no formato YYYY-MM-DD (mutualmente exclusivo com `period`) */
  periodFrom?: string;
  /** Data final no formato YYYY-MM-DD (mutualmente exclusivo com `period`) */
  periodTo?: string;
  /** Período pré-definido: 'today', 'week', 'month' (mutualmente exclusivo com periodFrom/periodTo) */
  period?: 'today' | 'week' | 'month';
}

/**
 * Converte PeriodInput em DateRange usando TimezoneService.
 *
 * Centraliza toda lógica de resolução de período para os serviços de
 * flow metrics, garantindo uso consistente de TimezoneService em 100%
 * dos filtros de data (ADR-V2-004 / devari-backend-patterns.md §4).
 *
 * Prioridade de resolução:
 * 1. Se `period` preenchido → usa `getPeriodDates` do TimezoneService
 * 2. Se `periodFrom`/`periodTo` preenchidos → usa `applyDateFilters`
 * 3. Se nada → retorna últimos 30 dias (fallback seguro)
 *
 * NUNCA usar `new Date()` direto para filtros de data — SEMPRE passa por
 * este helper para garantir timezone America/Sao_Paulo.
 *
 * @see TimezoneService — implementação de conversão de datas
 */
@Injectable()
export class PeriodResolver {
  constructor(private readonly timezoneService: TimezoneService) {}

  /**
   * Resolve um PeriodInput em DateRange para uso em queries Prisma.
   *
   * @param input - Parâmetros de período (period OU periodFrom/periodTo)
   * @returns DateRange `{gte, lte}` no timezone America/Sao_Paulo
   *
   * @throws {BadRequestException} Se periodFrom > periodTo
   * @throws {BadRequestException} Se formato de data inválido (não YYYY-MM-DD)
   *
   * @example
   * ```typescript
   * // Período pré-definido
   * const range = resolver.resolve({ period: 'week' });
   * // { gte: segunda-feira 00:00:00 Brasília, lte: domingo 23:59:59 Brasília }
   *
   * // Período customizado
   * const range = resolver.resolve({ periodFrom: '2026-01-01', periodTo: '2026-01-31' });
   * // { gte: 2026-01-01 00:00:00 Brasília, lte: 2026-01-31 23:59:59 Brasília }
   *
   * // Fallback: últimos 30 dias
   * const range = resolver.resolve({});
   * ```
   */
  resolve(input: PeriodInput): DateRange {
    if (input.period) {
      switch (input.period) {
        case 'today':
          return this.timezoneService.getPeriodDates('today');
        case 'week':
          return this.timezoneService.getPeriodDates('week');
        case 'month':
          return this.timezoneService.getPeriodDates('month');
      }
    }

    if (input.periodFrom && input.periodTo) {
      this.validateDateFormat(input.periodFrom, 'periodFrom');
      this.validateDateFormat(input.periodTo, 'periodTo');

      const range = this.timezoneService.applyDateFilters(input.periodFrom, input.periodTo);

      if (range.gte > range.lte) {
        throw new BadRequestException('periodFrom não pode ser posterior a periodTo');
      }

      return range;
    }

    if (input.periodFrom && !input.periodTo) {
      this.validateDateFormat(input.periodFrom, 'periodFrom');
      const range = this.timezoneService.applyDateFilters(
        input.periodFrom,
        input.periodFrom,
      );
      return {
        gte: range.gte,
        lte: this.timezoneService.toEndOfDayBrazil(new Date()),
      };
    }

    // Fallback: últimos 30 dias
    return this.getLast30Days();
  }

  /**
   * Retorna intervalo dos últimos 30 dias no timezone de Brasília.
   *
   * @returns DateRange dos últimos 30 dias
   */
  getLast30Days(): DateRange {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return {
      gte: this.timezoneService.toStartOfDayBrazil(thirtyDaysAgo),
      lte: this.timezoneService.toEndOfDayBrazil(now),
    };
  }

  /**
   * Valida que uma string está no formato YYYY-MM-DD.
   *
   * @param value - String a validar
   * @param fieldName - Nome do campo (para mensagem de erro)
   * @throws {BadRequestException} Se formato inválido
   */
  private validateDateFormat(value: string, fieldName: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(
        `${fieldName} deve estar no formato YYYY-MM-DD`,
      );
    }
  }
}
