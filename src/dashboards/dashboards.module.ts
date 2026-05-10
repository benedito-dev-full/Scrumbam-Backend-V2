import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlowMetricsModule } from '../flow-metrics/flow-metrics.module';
import { PeriodResolver } from '../flow-metrics/helpers/period-resolver';
import { TtlCacheService } from '../common/cache/ttl-cache.service';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

/**
 * Modulo F9 Bloco V de dashboards read-only.
 *
 * Registra endpoints de agregacao sobre projetos com cache TTL in-memory.
 */
@Module({
  imports: [AuthModule, FlowMetricsModule],
  controllers: [DashboardsController],
  providers: [TtlCacheService, PeriodResolver, DashboardsService],
  exports: [DashboardsService],
})
export class DashboardsModule {}
