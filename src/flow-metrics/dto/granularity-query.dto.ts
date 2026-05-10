import { IsOptional, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para granularidade temporal em queries de throughput.
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
}
