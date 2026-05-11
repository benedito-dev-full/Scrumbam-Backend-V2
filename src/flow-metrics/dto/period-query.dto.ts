import { IsOptional, IsString, IsIn, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para filtros de período em queries de flow metrics.
 *
 * Suporta dois modos mutuamente exclusivos:
 * - Período pré-definido via `period`
 * - Período customizado via `periodFrom` + `periodTo`
 *
 * Se nenhum for informado, o serviço usa os últimos 30 dias como fallback.
 *
 * @example
 * ```typescript
 * // Período pré-definido
 * const dto: PeriodQueryDto = { period: 'week' };
 *
 * // Período customizado
 * const dto: PeriodQueryDto = { periodFrom: '2026-01-01', periodTo: '2026-01-31' };
 *
 * // Sem filtro (últimos 30 dias)
 * const dto: PeriodQueryDto = {};
 * ```
 */
export class PeriodQueryDto {
  /**
   * Período pré-definido.
   *
   * Valores aceitos:
   * - `'today'` — dia atual (Brasília)
   * - `'week'` — semana atual (segunda a domingo, Brasília)
   * - `'month'` — mês atual (1º ao último dia, Brasília)
   *
   * Mutuamente exclusivo com `periodFrom`/`periodTo`.
   */
  @ApiPropertyOptional({
    description: 'Período pré-definido (mutualmente exclusivo com periodFrom/periodTo)',
    enum: ['today', 'week', 'month'],
    example: 'week',
  })
  @IsOptional()
  @IsIn(['today', 'week', 'month'])
  period?: 'today' | 'week' | 'month';

  /**
   * Data inicial do período no formato YYYY-MM-DD (timezone Brasília).
   *
   * Mutuamente exclusivo com `period`.
   */
  @ApiPropertyOptional({
    description: 'Data inicial do período (formato YYYY-MM-DD, timezone Brasília)',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'periodFrom deve estar no formato YYYY-MM-DD' })
  periodFrom?: string;

  /**
   * Data final do período no formato YYYY-MM-DD (timezone Brasília).
   *
   * Mutuamente exclusivo com `period`.
   */
  @ApiPropertyOptional({
    description: 'Data final do período (formato YYYY-MM-DD, timezone Brasília)',
    example: '2026-01-31',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'periodTo deve estar no formato YYYY-MM-DD' })
  periodTo?: string;

  /**
   * Declaracao shadow (GranularityQueryDto) — necessaria porque o controller
   * de throughput usa @Query() pra ambos DTOs no mesmo handler e o
   * ValidationPipe com forbidNonWhitelisted rejeita campos extras.
   */
  @IsOptional()
  @IsIn(['day', 'week'])
  granularity?: 'day' | 'week';
}
