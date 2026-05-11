import { IsOptional, IsIn, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para granularidade temporal em queries de throughput.
 *
 * Inclui declaracoes "shadow" de period/periodFrom/periodTo do PeriodQueryDto
 * porque o controller injeta os dois DTOs no mesmo @Query e o ValidationPipe
 * com forbidNonWhitelisted rejeita campos extras nao declarados.
 *
 * @example
 * ```typescript
 * const dto: GranularityQueryDto = { granularity: 'week' };
 * ```
 */
export class GranularityQueryDto {
  /**
   * Granularidade da série temporal.
   *
   * - `'day'` (default) — agrupamento por dia
   * - `'week'` — agrupamento por semana (início na segunda-feira)
   */
  @ApiPropertyOptional({
    description: 'Granularidade da série temporal',
    enum: ['day', 'week'],
    default: 'day',
    example: 'day',
  })
  @IsOptional()
  @IsIn(['day', 'week'])
  granularity?: 'day' | 'week' = 'day';

  /**
   * Declaracao shadow (PeriodQueryDto) — necessaria porque o controller
   * usa @Query() pra esse DTO no mesmo handler em que PeriodQueryDto e injetado.
   * Validacao real fica no PeriodQueryDto.
   */
  @IsOptional()
  @IsIn(['today', 'week', 'month'])
  period?: 'today' | 'week' | 'month';

  /** Declaracao shadow (PeriodQueryDto). */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'periodFrom deve estar no formato YYYY-MM-DD',
  })
  periodFrom?: string;

  /** Declaracao shadow (PeriodQueryDto). */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'periodTo deve estar no formato YYYY-MM-DD',
  })
  periodTo?: string;
}
