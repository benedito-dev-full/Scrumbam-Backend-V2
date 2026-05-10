import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlowMetricsModule } from '../flow-metrics/flow-metrics.module';
import { ForecastController } from './forecast.controller';
import { ForecastService } from './forecast.service';
import { PeriodResolver } from '../flow-metrics/helpers/period-resolver';

/**
 * ForecastModule — Forecast Monte Carlo de F8.
 *
 * Registra ForecastController + ForecastService.
 * Importa FlowMetricsModule para acesso a ThroughputService e WipAgeService.
 * Importa AuthModule para guards JWT + OrgTenantGuard.
 *
 * F8 é read-only puro:
 * - ZERO Engine/Operacao
 * - ZERO INSERT/UPDATE/DELETE
 * - ZERO migration, ZERO seed, ZERO DClasse nova
 */
@Module({
  imports: [AuthModule, FlowMetricsModule],
  controllers: [ForecastController],
  providers: [ForecastService, PeriodResolver],
})
export class ForecastModule {}
