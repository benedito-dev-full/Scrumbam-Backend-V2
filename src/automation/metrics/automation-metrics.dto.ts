import { ApiProperty } from '@nestjs/swagger';

export class AutomationMetricsResponseDto {
  @ApiProperty({ example: 3 })
  agentsOnline!: number;

  @ApiProperty({ example: 1 })
  agentsOffline!: number;

  @ApiProperty({ example: '2026-05-11T10:00:00.000Z', nullable: true })
  lastHeartbeatAt!: string | null;

  @ApiProperty({ example: { queued: 2, running: 1, success: 12, failed: 1 } })
  executionsByStatus!: Record<string, number>;

  @ApiProperty({ example: 1200, nullable: true })
  queueP95Ms!: number | null;

  @ApiProperty({ example: 45000, nullable: true })
  runtimeP95Ms!: number | null;

  @ApiProperty({ example: { '1001': 2 } })
  failuresByAgent!: Record<string, number>;

  @ApiProperty({ example: '2026-05-11T10:05:00.000Z' })
  calculatedAt!: string;
}
