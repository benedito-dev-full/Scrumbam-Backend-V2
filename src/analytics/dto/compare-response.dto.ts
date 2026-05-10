import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CycleTimeResponseDto } from '../../flow-metrics/dto/cycle-time-response.dto';
import { LeadTimeResponseDto } from '../../flow-metrics/dto/lead-time-response.dto';
import { ThroughputResponseDto } from '../../flow-metrics/dto/throughput-response.dto';
import { WipAgeResponseDto } from '../../flow-metrics/dto/wip-age-response.dto';

export class AnalyticsPeriodDto {
  @ApiProperty({ example: '2026-04-01T03:00:00.000Z' })
  from!: string;

  @ApiProperty({ example: '2026-05-01T02:59:59.999Z' })
  to!: string;
}

export class CompareMetricsPairDto<T> {
  @ApiProperty({ description: 'Metricas do periodo A' })
  periodA!: T;

  @ApiProperty({ description: 'Metricas do periodo B' })
  periodB!: T;
}

export class CompareMetricsDto {
  @ApiProperty({ type: CompareMetricsPairDto })
  cycleTime!: CompareMetricsPairDto<CycleTimeResponseDto>;

  @ApiProperty({ type: CompareMetricsPairDto })
  leadTime!: CompareMetricsPairDto<LeadTimeResponseDto>;

  @ApiProperty({ type: CompareMetricsPairDto })
  throughput!: CompareMetricsPairDto<ThroughputResponseDto>;

  @ApiPropertyOptional({ type: WipAgeResponseDto })
  wipAge?: WipAgeResponseDto;
}

export class CompareDeltaDto {
  @ApiPropertyOptional({ example: -12.5, nullable: true })
  cycleTimeAvgPct!: number | null;

  @ApiPropertyOptional({ example: -8.1, nullable: true })
  leadTimeAvgPct!: number | null;

  @ApiPropertyOptional({ example: 25, nullable: true })
  throughputPct!: number | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  wipCountPct!: number | null;
}

/**
 * Response DTO do endpoint GET /analytics/projects/:projectId/compare.
 */
export class CompareResponseDto {
  @ApiProperty({ example: '123' })
  projectId!: string;

  @ApiProperty({ type: AnalyticsPeriodDto })
  periodA!: AnalyticsPeriodDto;

  @ApiProperty({ type: AnalyticsPeriodDto })
  periodB!: AnalyticsPeriodDto;

  @ApiProperty({ type: CompareMetricsDto })
  metrics!: CompareMetricsDto;

  @ApiProperty({ type: CompareDeltaDto })
  delta!: CompareDeltaDto;

  @ApiProperty({ type: [String] })
  summary!: string[];

  @ApiProperty({ example: '2026-05-10T12:00:00.000Z' })
  generatedAt!: string;
}
