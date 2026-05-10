import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

/**
 * DTO para filtros dos endpoints de dashboards de projeto.
 *
 * Todos os filtros de data sao resolvidos via TimezoneService/PeriodResolver.
 * `sprintId` restringe endpoints que suportam recorte por sprint.
 */
export class DashboardQueryDto {
  /** Periodo pre-definido no timezone America/Sao_Paulo. */
  @ApiPropertyOptional({ enum: ['today', 'week', 'month'], example: 'month' })
  @IsOptional()
  @IsIn(['today', 'week', 'month'])
  period?: 'today' | 'week' | 'month';

  /** Data inicial YYYY-MM-DD. */
  @ApiPropertyOptional({ example: '2026-05-01' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'periodFrom deve estar no formato YYYY-MM-DD' })
  periodFrom?: string;

  /** Data final YYYY-MM-DD. */
  @ApiPropertyOptional({ example: '2026-05-31' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'periodTo deve estar no formato YYYY-MM-DD' })
  periodTo?: string;

  /** Granularidade temporal para series. */
  @ApiPropertyOptional({ enum: ['day', 'week'], example: 'day' })
  @IsOptional()
  @IsIn(['day', 'week'])
  granularity?: 'day' | 'week';

  /** Sprint DTabela.chave para recorte opcional. */
  @ApiPropertyOptional({ example: '456' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'sprintId deve ser um BigInt positivo em string' })
  sprintId?: string;
}
