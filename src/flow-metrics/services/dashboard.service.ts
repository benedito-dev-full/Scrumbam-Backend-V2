import { Injectable, Logger } from '@nestjs/common';
import { CycleTimeService } from './cycle-time.service';
import { LeadTimeService } from './lead-time.service';
import { ThroughputService } from './throughput.service';
import { WipAgeService } from './wip-age.service';
import { CfdService } from './cfd.service';
import { PeriodInput } from '../helpers/period-resolver';
import { DashboardResponseDto } from '../dto/dashboard-response.dto';
import { AutomationMetricsService } from '../../automation/metrics/automation-metrics.service';

/**
 * Serviço de dashboard consolidado de flow metrics.
 *
 * Agrega todos os 5 indicadores de flow metrics em uma única chamada via
 * `Promise.all`. Pensado para o carregamento do dashboard completo em uma
 * única request HTTP, reduzindo round-trips.
 *
 * Performance target (plano DoD): <500ms para projeto com 1000 tasks.
 * O `Promise.all` executa as 5 queries em paralelo, sem bloqueio serial.
 *
 * F8 é read-only puro — NÃO persiste nada, NÃO emite eventos.
 *
 * @see CycleTimeService — p50/p75/p90/avg de cycle time
 * @see LeadTimeService — p50/p75/p90/avg de lead time
 * @see ThroughputService — série temporal de tasks concluídas
 * @see WipAgeService — age de tasks não-DONE por status
 * @see CfdService — Cumulative Flow Diagram via replay de eventos
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly cycleTimeService: CycleTimeService,
    private readonly leadTimeService: LeadTimeService,
    private readonly throughputService: ThroughputService,
    private readonly wipAgeService: WipAgeService,
    private readonly cfdService: CfdService,
    private readonly automationMetricsService: AutomationMetricsService,
  ) {}

  /**
   * Retorna o dashboard completo de flow metrics para um projeto.
   *
   * Executa S.1-S.5 em paralelo via Promise.all. Se algum serviço falhar
   * internamente, o erro propaga (não silenciado — retornar dados parciais
   * pode ser mais confuso que um erro explícito).
   *
   * @param projectId - Chave BigInt do DProject
   * @param period - Filtros de período (aplicados em cycleTime, leadTime, throughput, cfd)
   * @returns DashboardResponseDto com todos os 5 indicadores
   *
   * @throws {BadRequestException} Se periodFrom > periodTo
   *
   * @example
   * ```typescript
   * const dashboard = await service.getDashboard(BigInt(123), { period: 'month' });
   * // {
   * //   projectId: '123',
   * //   cycleTime: { p50: 4.5, ... },
   * //   leadTime: { p50: 24.0, ... },
   * //   throughput: { series: [...], total: 42, granularity: 'day' },
   * //   wipAge: { byStatus: [...], total: 7, ... },
   * //   cfd: { series: [...] },
   * //   calculatedAt: '2026-05-10T14:00:00.000Z'
   * // }
   * ```
   *
   * @see DashboardResponseDto — estrutura de retorno
   */
  async getDashboard(projectId: bigint, period: PeriodInput): Promise<DashboardResponseDto> {
    this.logger.log(`Dashboard projeto=${projectId}`);

    const start = Date.now();

    const [cycleTime, leadTime, throughput, wipAge, cfd, automation] = await Promise.all([
      this.cycleTimeService.calculate(projectId, period),
      this.leadTimeService.calculate(projectId, period),
      this.throughputService.calculate(projectId, 'day', period),
      this.wipAgeService.calculate(projectId),
      this.cfdService.calculate(projectId, period),
      this.automationMetricsService.getOverview(),
    ]);

    const elapsed = Date.now() - start;
    this.logger.log(`Dashboard calculado em ${elapsed}ms para projeto=${projectId}`);

    if (elapsed > 500) {
      this.logger.warn(
        `Dashboard acima de 500ms (${elapsed}ms) para projeto=${projectId}. Registrar issue F9.`,
      );
    }

    return {
      projectId: projectId.toString(),
      cycleTime,
      leadTime,
      throughput,
      wipAge,
      cfd,
      automation,
      calculatedAt: new Date().toISOString(),
    };
  }
}
