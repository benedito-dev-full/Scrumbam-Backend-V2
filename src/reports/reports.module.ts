import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ForecastModule } from '../forecast/forecast.module';
import { TtlCacheService } from '../common/cache/ttl-cache.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PdfGeneratorService } from './pdf-generator.service';

/**
 * Modulo F9 Bloco X — Reports PDF read-only.
 *
 * Agrega dados de DashboardsModule (Bloco V), AnalyticsModule (Bloco W) e
 * ForecastModule (F8) para geração de relatórios PDF via PDFKit.
 *
 * Pilar 1: ZERO Engine/Operacao — apenas SELECT via Prisma.
 * Pilar 2: Não cria controllers duplicados para CRUD.
 * Pilar 3: Não cria DClasse, seed, migration ou tabela nova.
 *
 * Cache TTL de 5 minutos por (org, project, query) em memória process-local.
 */
@Module({
  imports: [AuthModule, DashboardsModule, AnalyticsModule, ForecastModule],
  controllers: [ReportsController],
  providers: [TtlCacheService, ReportsService, PdfGeneratorService],
  exports: [ReportsService],
})
export class ReportsModule {}
