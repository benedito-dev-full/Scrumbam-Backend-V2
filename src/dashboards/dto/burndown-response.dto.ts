import { ApiProperty } from '@nestjs/swagger';
import { DashboardCacheMetaDto, DashboardPeriodDto } from './common-dashboard-response.dto';

/** Ponto da serie de burndown. */
export class BurndownSeriesItemDto {
  @ApiProperty({ example: '2026-05-10' })
  date!: string;

  @ApiProperty({ example: 20 })
  plannedRemaining!: number;

  @ApiProperty({ example: 17 })
  actualRemaining!: number;
}

/** Response DTO para burndown do projeto. */
export class BurndownResponseDto {
  @ApiProperty({ example: '123' })
  projectId!: string;

  @ApiProperty({ type: [BurndownSeriesItemDto] })
  series!: BurndownSeriesItemDto[];

  @ApiProperty({ example: 25 })
  scopeTotal!: number;

  @ApiProperty({ example: 8 })
  completedTotal!: number;

  @ApiProperty({ type: DashboardPeriodDto })
  period!: DashboardPeriodDto;

  @ApiProperty({ type: DashboardCacheMetaDto })
  cache!: DashboardCacheMetaDto;
}
