import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlowMetricsController } from './flow-metrics.controller';
import { CycleTimeService } from './services/cycle-time.service';
import { LeadTimeService } from './services/lead-time.service';
import { ThroughputService } from './services/throughput.service';
import { WipAgeService } from './services/wip-age.service';
import { CfdService } from './services/cfd.service';
import { DashboardService } from './services/dashboard.service';
import { PeriodResolver } from './helpers/period-resolver';

/**
 * FlowMetricsModule — capacidades analíticas read-only de F8.
 *
 * Registra todos os 6 services de flow metrics + controller + helpers.
 * Importa AuthModule para acesso aos guards (JwtAuthGuard, OrgTenantGuard).
 *
 * F8 é read-only puro:
 * - ZERO Engine/Operacao
 * - ZERO INSERT/UPDATE/DELETE
 * - ZERO migration, ZERO seed, ZERO DClasse nova
 *
 * Serviços disponíveis:
 * - CycleTimeService — p50/p75/p90/avg de cycle time
 * - LeadTimeService — p50/p75/p90/avg de lead time
 * - ThroughputService — série temporal de tasks concluídas
 * - WipAgeService — age de tasks não-DONE por status
 * - CfdService — CFD via replay de eventos DEvento -498
 * - DashboardService — agregação de todos os 5 indicadores
 */
@Module({
  imports: [AuthModule],
  controllers: [FlowMetricsController],
  providers: [
    PeriodResolver,
    CycleTimeService,
    LeadTimeService,
    ThroughputService,
    WipAgeService,
    CfdService,
    DashboardService,
  ],
  exports: [
    CycleTimeService,
    LeadTimeService,
    ThroughputService,
    WipAgeService,
    CfdService,
    DashboardService,
  ],
})
export class FlowMetricsModule {}
