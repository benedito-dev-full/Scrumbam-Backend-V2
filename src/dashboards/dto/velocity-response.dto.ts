import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DashboardCacheMetaDto, DashboardPeriodDto } from './common-dashboard-response.dto';

/** Ponto da serie de velocity (throughput por periodo). */
export class VelocitySeriesItemDto {
  @ApiProperty({ example: '2026-05-01' })
  label!: string;

  @ApiProperty({ example: 12 })
  completed!: number;

  @ApiPropertyOptional({ example: 15 })
  planned?: number;
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
