import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CapacityForecastProjectDto {
  @ApiProperty({ example: '123' })
  projectId!: string;

  @ApiProperty({ example: 'Core Backend' })
  projectName!: string;

  @ApiProperty({ example: 'ready', enum: ['ready', 'insufficient-history', 'error'] })
  status!: 'ready' | 'insufficient-history' | 'error';

  @ApiProperty({ example: 30 })
  tasksRemaining!: number;

  @ApiPropertyOptional({ example: 14, nullable: true })
  p50!: number | null;

  @ApiPropertyOptional({ example: 21, nullable: true })
  p75!: number | null;

  @ApiPropertyOptional({ example: 28, nullable: true })
  p85!: number | null;

  @ApiPropertyOptional({ example: 42, nullable: true })
  p95!: number | null;

  @ApiPropertyOptional({ example: 'sprints', nullable: true })
  source!: string | null;

  @ApiPropertyOptional({ example: 'INSUFFICIENT_HISTORY', nullable: true })
  errorCode?: string | null;
}

export class CapacityForecastTotalsDto {
  @ApiProperty({ example: 120 })
  tasksRemaining!: number;

  @ApiProperty({ example: 56 })
  p50Approx!: number;

  @ApiProperty({ example: 84 })
  p75Approx!: number;

  @ApiProperty({ example: 168 })
  p95Approx!: number;
}

/**
 * Response DTO do endpoint GET /analytics/orgs/:orgId/capacity-forecast.
 */
export class CapacityForecastResponseDto {
  @ApiProperty({ example: '10' })
  orgId!: string;

  @ApiProperty({ type: [CapacityForecastProjectDto] })
  projects!: CapacityForecastProjectDto[];

  @ApiProperty({ type: CapacityForecastTotalsDto })
  totals!: CapacityForecastTotalsDto;

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty({ example: '2026-05-10T12:00:00.000Z' })
  generatedAt!: string;
}
