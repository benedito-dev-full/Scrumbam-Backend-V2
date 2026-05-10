import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DashboardCacheMetaDto, DashboardPeriodDto } from './common-dashboard-response.dto';

/** Ponto da serie de velocity. */
export class VelocitySeriesItemDto {
  @ApiProperty({ example: 'Sprint 1' })
  label!: string;

  @ApiPropertyOptional({ example: '456' })
  sprintId?: string;

  @ApiProperty({ example: 12 })
  completed!: number;

  @ApiPropertyOptional({ example: 15 })
  planned?: number;

  @ApiPropertyOptional({ example: '2026-05-01T03:00:00.000Z' })
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-05-15T02:59:59.999Z' })
  endDate?: string;
}

/** Response DTO para velocity do projeto. */
export class VelocityResponseDto {
  @ApiProperty({ example: '123' })
  projectId!: string;

  @ApiProperty({ type: [VelocitySeriesItemDto] })
  series!: VelocitySeriesItemDto[];

  @ApiProperty({ example: 8.5 })
  avgVelocity!: number;

  @ApiProperty({ type: DashboardPeriodDto })
  period!: DashboardPeriodDto;

  @ApiProperty({ type: DashboardCacheMetaDto })
  cache!: DashboardCacheMetaDto;
}
