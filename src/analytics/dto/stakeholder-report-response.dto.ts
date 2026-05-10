import { ApiProperty } from '@nestjs/swagger';
import { AnalyticsPeriodDto } from './compare-response.dto';

export class StakeholderMetricsSnapshotDto {
  @ApiProperty({ example: 18 })
  throughputTotal!: number;

  @ApiProperty({ example: 12.5, nullable: true })
  cycleTimeAvgHours!: number | null;

  @ApiProperty({ example: 30.2, nullable: true })
  leadTimeAvgHours!: number | null;

  @ApiProperty({ example: 7 })
  wipTotal!: number;
}

/**
 * Response DTO do endpoint GET /analytics/projects/:projectId/stakeholder-report.
 */
export class StakeholderReportResponseDto {
  @ApiProperty({ example: '123' })
  projectId!: string;

  @ApiProperty({ type: AnalyticsPeriodDto })
  period!: AnalyticsPeriodDto;

  @ApiProperty({ example: 'O projeto concluiu 18 tasks no periodo...' })
  executiveSummary!: string;

  @ApiProperty({ type: [String] })
  highlights!: string[];

  @ApiProperty({ type: [String] })
  risks!: string[];

  @ApiProperty({ type: [String] })
  nextActions!: string[];

  @ApiProperty({ type: StakeholderMetricsSnapshotDto })
  metricsSnapshot!: StakeholderMetricsSnapshotDto;

  @ApiProperty({ example: '2026-05-10T12:00:00.000Z' })
  generatedAt!: string;
}
