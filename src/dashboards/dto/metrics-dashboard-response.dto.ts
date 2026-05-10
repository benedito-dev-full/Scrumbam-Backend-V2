import { ApiProperty } from '@nestjs/swagger';
import { DashboardResponseDto } from '../../flow-metrics/dto/dashboard-response.dto';
import { DashboardCacheMetaDto } from './common-dashboard-response.dto';

/**
 * Response DTO do endpoint GET /dashboards/projects/:projectId/metrics.
 */
export class MetricsDashboardResponseDto extends DashboardResponseDto {
  /** Metadados do cache TTL. */
  @ApiProperty({ type: DashboardCacheMetaDto })
  cache!: DashboardCacheMetaDto;
}
