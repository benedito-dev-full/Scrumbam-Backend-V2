import { ApiProperty } from '@nestjs/swagger';
import { DashboardCacheMetaDto } from './common-dashboard-response.dto';

/** Response DTO para snapshot diario do projeto. */
export class DailySummaryResponseDto {
  @ApiProperty({ example: '123' })
  projectId!: string;

  @ApiProperty({ example: '2026-05-10' })
  date!: string;

  @ApiProperty({ example: 3 })
  completedToday!: number;

  @ApiProperty({ example: 2 })
  createdToday!: number;

  @ApiProperty({ example: 7 })
  inProgress!: number;

  @ApiProperty({ example: 1 })
  blockedOrFailed!: number;

  @ApiProperty({ type: [String], example: ['3 tasks concluidas hoje'] })
  highlights!: string[];

  @ApiProperty({ type: DashboardCacheMetaDto })
  cache!: DashboardCacheMetaDto;
}
