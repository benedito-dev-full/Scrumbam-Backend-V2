import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TtlCacheService } from '../common/cache/ttl-cache.service';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { FlowMetricsModule } from '../flow-metrics/flow-metrics.module';
import { PeriodResolver } from '../flow-metrics/helpers/period-resolver';
import { ForecastModule } from '../forecast/forecast.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * Modulo F9 Bloco W de analytics read-only.
 *
 * Reusa FlowMetricsModule, ForecastModule e DashboardsModule para tenant
 * resolver sem criar CRUD ou persistir resultados analiticos.
 */
@Module({
  imports: [AuthModule, DashboardsModule, FlowMetricsModule, ForecastModule],
  controllers: [AnalyticsController],
  providers: [TtlCacheService, PeriodResolver, AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
