import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TtlCacheService } from '../common/cache/ttl-cache.service';
import { CycleTimeService } from '../flow-metrics/services/cycle-time.service';
import { LeadTimeService } from '../flow-metrics/services/lead-time.service';
import { ThroughputService } from '../flow-metrics/services/throughput.service';
import { WipAgeService } from '../flow-metrics/services/wip-age.service';
import { PeriodInput, PeriodResolver } from '../flow-metrics/helpers/period-resolver';
import { ForecastService } from '../forecast/forecast.service';
import { CompareQueryDto } from './dto/compare-query.dto';
import { CompareResponseDto } from './dto/compare-response.dto';
import { CapacityForecastQueryDto } from './dto/capacity-forecast-query.dto';
import {
  CapacityForecastProjectDto,
  CapacityForecastResponseDto,
} from './dto/capacity-forecast-response.dto';
import { StakeholderReportQueryDto } from './dto/stakeholder-report-query.dto';
import { StakeholderReportResponseDto } from './dto/stakeholder-report-response.dto';

const CACHE_TTL_MS = 60_000;
const CAPACITY_CACHE_TTL_MS = 300_000;
const DEFAULT_PROJECT_LIMIT = 25;
const MAX_PROJECT_LIMIT = 100;

/**
 * Service read-only de analytics F9 Bloco W.
 *
 * Reusa services F8 para metricas e forecast. Acesso Prisma direto fica restrito
 * a SELECTs/agregacoes sem persistencia.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TtlCacheService,
    private readonly cycleTimeService: CycleTimeService,
    private readonly leadTimeService: LeadTimeService,
    private readonly throughputService: ThroughputService,
    private readonly wipAgeService: WipAgeService,
    private readonly forecastService: ForecastService,
    private readonly periodResolver: PeriodResolver,
  ) {}

  /**
   * Compara dois periodos de flow metrics de um projeto.
   *
   * WIP age e atual por natureza no F8; ele e retornado como snapshot atual e
   * nao participa de delta historico para evitar fingir WIP retroativo.
   *
   * @param orgId - Organizacao do usuario autenticado
   * @param projectId - Chave BigInt do projeto
   * @param query - Periodos A/B e granularidade
   * @returns Comparativo com deltas percentuais seguros
   */
  async compareProject(
    orgId: string,
    projectId: bigint,
    query: CompareQueryDto,
  ): Promise<CompareResponseDto> {
    const key = this.buildCacheKey('compare', orgId, projectId, query);
    return this.cache.getOrSet(key, CACHE_TTL_MS, async () => {
      const periodA: PeriodInput = { periodFrom: query.periodAFrom, periodTo: query.periodATo };
      const periodB: PeriodInput = { periodFrom: query.periodBFrom, periodTo: query.periodBTo };
      const granularity = query.granularity ?? 'week';

      const [rangeA, rangeB] = [
        this.periodResolver.resolve(periodA),
        this.periodResolver.resolve(periodB),
      ];

      const [
        cycleTimeA,
        cycleTimeB,
        leadTimeA,
        leadTimeB,
        throughputA,
        throughputB,
        wipAge,
      ] = await Promise.all([
        this.cycleTimeService.calculate(projectId, periodA),
        this.cycleTimeService.calculate(projectId, periodB),
        this.leadTimeService.calculate(projectId, periodA),
        this.leadTimeService.calculate(projectId, periodB),
        this.throughputService.calculate(projectId, granularity, periodA),
        this.throughputService.calculate(projectId, granularity, periodB),
        this.wipAgeService.calculate(projectId),
      ]);

      const delta = {
        cycleTimeAvgPct: this.safeDeltaPct(cycleTimeA.avg, cycleTimeB.avg),
        leadTimeAvgPct: this.safeDeltaPct(leadTimeA.avg, leadTimeB.avg),
        throughputPct: this.safeDeltaPct(throughputA.total, throughputB.total),
        wipCountPct: null,
      };

      return {
        projectId: projectId.toString(),
        periodA: this.toPeriodDto(rangeA),
        periodB: this.toPeriodDto(rangeB),
        metrics: {
          cycleTime: { periodA: cycleTimeA, periodB: cycleTimeB },
          leadTime: { periodA: leadTimeA, periodB: leadTimeB },
          throughput: { periodA: throughputA, periodB: throughputB },
          wipAge,
        },
        delta,
        summary: this.buildCompareSummary(delta, throughputA.total, throughputB.total),
        generatedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Calcula forecast agregado por organizacao em lote.
   *
   * Projetos com historico insuficiente entram no payload com status proprio,
   * sem derrubar a resposta da organizacao inteira.
   *
   * @param orgId - Chave BigInt da organizacao
   * @param query - Parametros de forecast e limite de projetos
   * @returns Forecast por projeto e totais aproximados
   */
  async capacityForecast(
    orgId: bigint,
    query: CapacityForecastQueryDto,
  ): Promise<CapacityForecastResponseDto> {
    const limitProjects = Math.max(
      1,
      Math.min(query.limitProjects ?? DEFAULT_PROJECT_LIMIT, MAX_PROJECT_LIMIT),
    );
    const normalizedQuery = {
      historicalSprints: query.historicalSprints ?? 4,
      iterations: query.iterations ?? 10000,
      limitProjects,
    };
    const key = this.buildOrgCacheKey('capacity-forecast', orgId, normalizedQuery);

    return this.cache.getOrSet(key, CAPACITY_CACHE_TTL_MS, async () => {
      const projects = await this.prisma.dProject.findMany({
        where: { idEstab: orgId, excluido: false },
        select: { chave: true, nome: true },
        orderBy: { chave: 'asc' },
        take: limitProjects,
      });

      const items = await Promise.all(
        projects.map((project) => this.forecastProject(project, normalizedQuery)),
      );

      const ready = items.filter((item) => item.status === 'ready');
      const warnings = items
        .filter((item) => item.status !== 'ready')
        .map((item) => `Projeto ${item.projectId}: ${item.errorCode ?? 'FORECAST_UNAVAILABLE'}`);

      return {
        orgId: orgId.toString(),
        projects: items,
        totals: {
          tasksRemaining: items.reduce((acc, item) => acc + item.tasksRemaining, 0),
          p50Approx: ready.reduce((acc, item) => acc + (item.p50 ?? 0), 0),
          p75Approx: ready.reduce((acc, item) => acc + (item.p75 ?? 0), 0),
          p95Approx: ready.reduce((acc, item) => acc + (item.p95 ?? 0), 0),
        },
        warnings,
        generatedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Gera relatorio deterministico para stakeholders.
   *
   * O texto e montado por templates fixos a partir das metricas F8, sem LLM,
   * sem eventos e sem persistencia.
   *
   * @param orgId - Organizacao do usuario autenticado
   * @param projectId - Chave BigInt do projeto
   * @param query - Periodo do relatorio
   * @returns Relatorio narrativo deterministicamente gerado
   */
  async stakeholderReport(
    orgId: string,
    projectId: bigint,
    query: StakeholderReportQueryDto,
  ): Promise<StakeholderReportResponseDto> {
    const key = this.buildCacheKey('stakeholder-report', orgId, projectId, query);
    return this.cache.getOrSet(key, CACHE_TTL_MS, async () => {
      const period: PeriodInput = this.toStakeholderPeriod(query);
      const range = this.periodResolver.resolve(period);

      const [cycleTime, leadTime, throughput, wipAge] = await Promise.all([
        this.cycleTimeService.calculate(projectId, period),
        this.leadTimeService.calculate(projectId, period),
        this.throughputService.calculate(projectId, 'week', period),
        this.wipAgeService.calculate(projectId),
      ]);

      const snapshot = {
        throughputTotal: throughput.total,
        cycleTimeAvgHours: cycleTime.avg,
        leadTimeAvgHours: leadTime.avg,
        wipTotal: wipAge.total,
      };

      return {
        projectId: projectId.toString(),
        period: this.toPeriodDto(range),
        executiveSummary: this.buildExecutiveSummary(snapshot),
        highlights: this.buildHighlights(snapshot),
        risks: this.buildRisks(snapshot),
        nextActions: this.buildNextActions(snapshot),
        metricsSnapshot: snapshot,
        generatedAt: new Date().toISOString(),
      };
    });
  }

  private async forecastProject(
    project: { chave: bigint; nome: string },
    query: { historicalSprints: number; iterations: number },
  ): Promise<CapacityForecastProjectDto> {
    try {
      const result = await this.forecastService.forecast(project.chave, query);
      return {
        projectId: project.chave.toString(),
        projectName: project.nome,
        status: 'ready',
        tasksRemaining: result.tasksRemaining,
        p50: result.p50,
        p75: result.p75,
        p85: result.p85,
        p95: result.p95,
        source: result.source,
        errorCode: null,
      };
    } catch (error) {
      const errorCode = this.isInsufficientHistory(error)
        ? 'INSUFFICIENT_HISTORY'
        : 'FORECAST_UNAVAILABLE';
      this.logger.warn(`Forecast indisponivel project=${project.chave} code=${errorCode}`);
      return {
        projectId: project.chave.toString(),
        projectName: project.nome,
        status: errorCode === 'INSUFFICIENT_HISTORY' ? 'insufficient-history' : 'error',
        tasksRemaining: await this.countTasksRemaining(project.chave),
        p50: null,
        p75: null,
        p85: null,
        p95: null,
        source: null,
        errorCode,
      };
    }
  }

  private async countTasksRemaining(projectId: bigint): Promise<number> {
    return this.prisma.dTask.count({
      where: {
        idProject: projectId,
        excluido: false,
        NOT: { idStatus: { in: [BigInt(-444), BigInt(-449)] } },
      },
    });
  }

  private isInsufficientHistory(error: unknown): boolean {
    if (error instanceof BadRequestException) {
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    return message.toLowerCase().includes('hist');
  }

  private safeDeltaPct(previous: number | null | undefined, current: number | null | undefined): number | null {
    if (previous === null || previous === undefined || current === null || current === undefined) {
      return null;
    }
    if (previous === 0) {
      return current === 0 ? 0 : null;
    }
    return Math.round(((current - previous) / previous) * 10000) / 100;
  }

  private buildCompareSummary(
    delta: { cycleTimeAvgPct: number | null; leadTimeAvgPct: number | null; throughputPct: number | null },
    throughputA: number,
    throughputB: number,
  ): string[] {
    const summary = [
      `Throughput: ${throughputA} tasks no periodo A e ${throughputB} no periodo B.`,
    ];

    summary.push(this.deltaSentence('Cycle time medio', delta.cycleTimeAvgPct));
    summary.push(this.deltaSentence('Lead time medio', delta.leadTimeAvgPct));
    summary.push(this.deltaSentence('Throughput', delta.throughputPct));
    summary.push('WIP age e exibido como snapshot atual; delta historico de WIP nao e inferido.');
    return summary;
  }

  private deltaSentence(label: string, delta: number | null): string {
    if (delta === null) {
      return `${label}: delta percentual indisponivel por baseline zero ou amostra ausente.`;
    }
    if (delta === 0) {
      return `${label}: sem variacao percentual entre os periodos.`;
    }
    return `${label}: ${delta > 0 ? 'aumentou' : 'reduziu'} ${Math.abs(delta)}%.`;
  }

  private toStakeholderPeriod(query: StakeholderReportQueryDto): PeriodInput {
    if (query.periodFrom && query.periodTo) {
      return { periodFrom: query.periodFrom, periodTo: query.periodTo };
    }
    return { period: query.period ?? 'week' };
  }

  private buildExecutiveSummary(snapshot: {
    throughputTotal: number;
    cycleTimeAvgHours: number | null;
    leadTimeAvgHours: number | null;
    wipTotal: number;
  }): string {
    const cycle = snapshot.cycleTimeAvgHours === null
      ? 'sem amostra suficiente de cycle time'
      : `cycle time medio de ${snapshot.cycleTimeAvgHours}h`;
    return `O projeto concluiu ${snapshot.throughputTotal} tasks no periodo, com ${snapshot.wipTotal} tasks em WIP atual e ${cycle}.`;
  }

  private buildHighlights(snapshot: { throughputTotal: number; cycleTimeAvgHours: number | null }): string[] {
    const highlights = [`${snapshot.throughputTotal} tasks concluidas no periodo.`];
    if (snapshot.cycleTimeAvgHours !== null) {
      highlights.push(`Cycle time medio observado: ${snapshot.cycleTimeAvgHours}h.`);
    }
    return highlights;
  }

  private buildRisks(snapshot: { throughputTotal: number; leadTimeAvgHours: number | null; wipTotal: number }): string[] {
    const risks: string[] = [];
    if (snapshot.throughputTotal === 0) {
      risks.push('Sem conclusoes no periodo; validar bloqueios e priorizacao.');
    }
    if (snapshot.wipTotal > 20) {
      risks.push('WIP atual elevado; pode haver dispersao de foco ou filas acumuladas.');
    }
    if (snapshot.leadTimeAvgHours !== null && snapshot.leadTimeAvgHours > 168) {
      risks.push('Lead time medio acima de 7 dias; revisar fluxo de espera.');
    }
    return risks.length > 0 ? risks : ['Nenhum risco quantitativo relevante nas metricas disponiveis.'];
  }

  private buildNextActions(snapshot: { throughputTotal: number; wipTotal: number }): string[] {
    const actions = ['Revisar prioridades do proximo ciclo com base nas tasks em WIP.'];
    if (snapshot.throughputTotal === 0) {
      actions.push('Fazer triagem de impedimentos antes de abrir novo trabalho.');
    }
    if (snapshot.wipTotal > 20) {
      actions.push('Limitar novo WIP ate reduzir a fila atual.');
    }
    return actions;
  }

  private toPeriodDto(range: { gte: Date; lte: Date }): { from: string; to: string } {
    return { from: range.gte.toISOString(), to: range.lte.toISOString() };
  }

  private buildCacheKey(endpoint: string, orgId: string, projectId: bigint, query: object): string {
    return `analytics:${endpoint}:org:${orgId}:project:${projectId.toString()}:${this.normalizeQuery(query)}`;
  }

  private buildOrgCacheKey(endpoint: string, orgId: bigint, query: object): string {
    return `analytics:${endpoint}:org:${orgId.toString()}:${this.normalizeQuery(query)}`;
  }

  private normalizeQuery(query: object): string {
    return Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('&');
  }
}
