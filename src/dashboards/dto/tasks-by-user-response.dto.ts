import { ApiProperty } from '@nestjs/swagger';
import { DashboardCacheMetaDto } from './common-dashboard-response.dto';

/** Agrupamento de tasks por usuario/responsavel. */
export class TasksByUserItemDto {
  @ApiProperty({ example: '789', nullable: true })
  userId!: string | null;

  @ApiProperty({ example: 'Maria Silva' })
  userName!: string;

  @ApiProperty({ example: 9 })
  total!: number;

  @ApiProperty({ example: { EXECUTING: 4, DONE: 5 } })
  byStatus!: Record<string, number>;
}

/** Response DTO para tasks agrupadas por usuario. */
export class TasksByUserResponseDto {
  @ApiProperty({ example: '123' })
  projectId!: string;

  @ApiProperty({ type: [TasksByUserItemDto] })
  users!: TasksByUserItemDto[];

  @ApiProperty({ type: DashboardCacheMetaDto })
  cache!: DashboardCacheMetaDto;
}
