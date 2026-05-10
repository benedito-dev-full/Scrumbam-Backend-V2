import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

/**
 * DTO para comparar dois periodos de metricas de fluxo.
 *
 * Datas sao resolvidas via PeriodResolver/TimezoneService no service.
 */
export class CompareQueryDto {
  /** Data inicial do periodo A no formato YYYY-MM-DD. */
  @ApiProperty({ example: '2026-04-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'periodAFrom deve estar no formato YYYY-MM-DD' })
  periodAFrom!: string;

  /** Data final do periodo A no formato YYYY-MM-DD. */
  @ApiProperty({ example: '2026-04-30' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'periodATo deve estar no formato YYYY-MM-DD' })
  periodATo!: string;

  /** Data inicial do periodo B no formato YYYY-MM-DD. */
  @ApiProperty({ example: '2026-05-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'periodBFrom deve estar no formato YYYY-MM-DD' })
  periodBFrom!: string;

  /** Data final do periodo B no formato YYYY-MM-DD. */
  @ApiProperty({ example: '2026-05-10' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'periodBTo deve estar no formato YYYY-MM-DD' })
  periodBTo!: string;

  /** Granularidade usada para throughput. */
  @ApiPropertyOptional({ enum: ['day', 'week'], example: 'week' })
  @IsOptional()
  @IsIn(['day', 'week'])
  granularity?: 'day' | 'week' = 'week';
}
