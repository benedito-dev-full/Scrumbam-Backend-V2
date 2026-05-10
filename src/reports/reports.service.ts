import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TtlCacheService } from '../common/cache/ttl-cache.service';
import { DashboardsService } from '../dashboards/dashboards.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ForecastService } from '../forecast/forecast.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { ReportQueryDto } from './dto/report-query.dto';
import { ProjectReportDataDto } from './dto/project-report-data.dto';

/** TTL de 5 minutos para o cache de payload de relatório. */
const REPORT_CACHE_TTL_MS = 5 * 60 * 1000;

/** Limite máximo de tasks na seção de tasks individuais. */
const MAX_TASKS_IN_REPORT = 200;

/**
 * Service de geração de relatórios PDF F9.
 *
 * Agrega dados de DashboardsService, AnalyticsService e ForecastService
 * via Promise.all, aplica cache TTL de 5 minutos por (org, project, query)
 * e delega a renderização para PdfGeneratorService.
 *
 * Pilar 1: ZERO Engine/Operacao — apenas SELECT via Prisma.
 * Pilar 2: Reutiliza serviços existentes dos Blocos V/W/F8.
 * Pilar 3: Não cria DClasse, seed, migration ou tabela nova.
 *
 * @see DashboardsService — métricas, velocity, burndown, tasksByUser
 * @see AnalyticsService — stakeholder report
 * @see ForecastService — Monte Carlo p50/p75/p85/p95
 * @see PdfGeneratorService — renderização do PDF
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TtlCacheService,
    private readonly dashboardsService: DashboardsService,
    private readonly analyticsService: AnalyticsService,
    private readonly forecastService: ForecastService,
    private readonly pdfGenerator: PdfGeneratorService,
  ) {}

  /**
   * Gera relatório PDF do projeto com cache TTL de 5 minutos.
   *
   * Resolve o tenant (403 se projeto pertence a outra org), agrega
   * dados via Promise.all com tratamento gracioso de erros não críticos
   * (forecast sem histórico → warning), e retorna Buffer PDF.
   *
   * @param projectId - ID do projeto (string convertida para BigInt)
   * @param orgId - Organizacao do usuario autenticado
   * @param query - Parâmetros de configuração do relatório
   * @returns Buffer PDF com Content-Type application/pdf
   *
   * @throws {NotFoundException} Se projeto não encontrado
   * @throws {ForbiddenException} Se projeto pertence a outra organização
   */
  async generateProjectPdf(
    projectId: string,
    orgId: string,
    query: ReportQueryDto,
  ): Promise<Buffer> {
    if (!orgId) {
      throw new ForbiddenException('Acesso negado: organização ausente no token');
    }

    const pid = await this.resolveProjectId(projectId, orgId);
    const cacheKey = this.buildCacheKey(orgId, projectId, query);

    const reportData = await this.cache.getOrSet<ProjectReportDataDto>(
      cacheKey,
      REPORT_CACHE_TTL_MS,
      () => this.assembleReportData(pid, orgId, query),
    );

    return this.pdfGenerator.generate(reportData);
  }

  /**
   * Monta o payload completo do relatório via Promise.all.
   *
   * Erros não críticos (forecast sem histórico, analytics falha) são
   * capturados e registrados como warnings — o relatório é gerado com
   * dados parciais em vez de falhar completamente.
   *
   * @param pid - Chave BigInt do projeto
   * @param orgId - ID da organização
   * @param query - Parâmetros de configuração
   * @returns Payload completo do relatório
   */
  async assembleReportData(
    pid: bigint,
    orgId: string,
    query: ReportQueryDto,
  ): Promise<ProjectReportDataDto> {
    const warnings: string[] = [];
    const periodDays = query.periodDays ?? 30;
    const dashQuery = this.buildDashboardQuery(query);
    const stakeholderQuery = this.buildStakeholderQuery(query);

    // Buscar metadados do projeto
    const project = await this.prisma.dProject.findFirst({
      where: { chave: pid, excluido: false },
      select: { chave: true, nome: true, idEstab: true },
    });

    if (!project) {
      throw new NotFoundException(`Projeto ${pid} não encontrado`);
    }

    // Calcular período real com base na query
    const { from: periodFrom, to: periodTo } = this.resolvePeriodBounds(query);

    // Agregar todos os dados em paralelo
    const [metrics, velocity, burndown, tasksByUser, forecastResult, stakeholderResult, tasksResult] =
      await Promise.allSettled([
        this.dashboardsService.getMetrics(orgId, pid, dashQuery),
        this.dashboardsService.getVelocity(orgId, pid, dashQuery),
        this.dashboardsService.getBurndown(orgId, pid, dashQuery),
        this.dashboardsService.getTasksByUser(orgId, pid, dashQuery),
        this.forecastService.forecast(pid, { historicalSprints: Math.min(8, Math.ceil(periodDays / 14)) }),
        query.includeStakeholderSummary !== false
          ? this.analyticsService.stakeholderReport(orgId, pid, stakeholderQuery)
          : Promise.resolve(null),
        query.includeTasks === true
          ? this.fetchTasks(pid)
          : Promise.resolve(null),
      ]);

    // Processar resultados com tratamento gracioso
    const metricsData = this.unwrapSettled(metrics, 'métricas', warnings);
    const velocityData = this.unwrapSettled(velocity, 'velocity', warnings);
    const burndownData = this.unwrapSettled(burndown, 'burndown', warnings);
    const tasksByUserData = this.unwrapSettled(tasksByUser, 'tasks por usuário', warnings);
    const forecastData = this.unwrapSettled(forecastResult, 'forecast', warnings, true);
    const stakeholderData = this.unwrapSettled(stakeholderResult, 'resumo executivo', warnings);
    const tasksData = this.unwrapSettled(tasksResult, 'tasks individuais', warnings);

    return {
      project: {
        projectId: pid.toString(),
        projectName: project.nome ?? `Projeto ${pid}`,
        orgId,
      },
      period: {
        from: periodFrom,
        to: periodTo,
        days: periodDays,
      },
      generatedAt: new Date().toISOString(),
      metrics: metricsData as Record<string, unknown> | null,
      velocity: velocityData as Record<string, unknown> | null,
      burndown: burndownData as Record<string, unknown> | null,
      tasksByUser: tasksByUserData as Record<string, unknown> | null,
      forecast: forecastData as Record<string, unknown> | null,
      stakeholderSummary: stakeholderData as Record<string, unknown> | null,
      tasks: tasksData as Record<string, unknown>[] | null,
      warnings,
    };
  }

  /**
   * Resolve e valida o tenant do projeto.
   *
   * @param projectId - ID string do projeto
   * @param orgId - Organização do usuário
   * @returns Chave BigInt do projeto
   */
  async resolveProjectId(projectId: string, orgId: string): Promise<bigint> {
    let pid: bigint;
    try {
      pid = BigInt(projectId);
    } catch {
      throw new NotFoundException(`Projeto ${projectId} não encontrado`);
    }

    const project = await this.prisma.dProject.findFirst({
      where: { chave: pid, excluido: false },
      select: { chave: true, idEstab: true },
    });

    if (!project) {
      throw new NotFoundException(`Projeto ${projectId} não encontrado`);
    }

    if (project.idEstab?.toString() !== orgId) {
      throw new ForbiddenException('Acesso negado: projeto pertence a outra organização');
    }

    return pid;
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

  /**
   * Busca lista resumida de tasks do projeto (máx 200).
   *
   * SELECT enxuto para minimizar payload e evitar N+1.
   */
  private async fetchTasks(pid: bigint): Promise<Record<string, unknown>[]> {
    const tasks = await this.prisma.dTask.findMany({
      where: { idProject: pid, excluido: false },
      select: {
        chave: true,
        idStatus: true,
        idAssignee: true,
        criadoEm: true,
        atualizadoEm: true,
        dados: true,
      },
      take: MAX_TASKS_IN_REPORT,
      orderBy: { criadoEm: 'desc' },
    });

    return tasks.map((task) => ({
      taskId: task.chave.toString(),
      idStatus: task.idStatus?.toString() ?? null,
      idAssignee: task.idAssignee?.toString() ?? null,
      criadoEm: task.criadoEm?.toISOString() ?? null,
      atualizadoEm: task.atualizadoEm?.toISOString() ?? null,
      identifier: this.extractIdentifier(task.dados),
    }));
  }

  private extractIdentifier(dados: unknown): string | null {
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return null;
    const record = dados as Record<string, unknown>;
    const id = record.identifier;
    return typeof id === 'string' ? id : null;
  }

  /**
   * Extrai valor de um PromiseSettledResult, registrando warning em falha.
   *
   * @param result - Resultado do Promise.allSettled
   * @param label - Nome do dado para mensagem de warning
   * @param warnings - Array mutável de avisos
   * @param isSoft - Se true, falha BadRequestException não gera warning de erro
   * @returns Valor resolvido ou null em caso de falha
   */
  private unwrapSettled<T>(
    result: PromiseSettledResult<T>,
    label: string,
    warnings: string[],
    isSoft = false,
  ): T | null {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    const err = result.reason as Error;
    if (isSoft && err?.name === 'BadRequestException') {
      warnings.push(`${label}: histórico insuficiente para cálculo.`);
    } else if (err) {
      warnings.push(`${label}: não disponível (${err.message ?? 'erro desconhecido'}).`);
      this.logger.warn(`Erro ao buscar ${label}: ${err.message}`);
    }

    return null;
  }

  private buildDashboardQuery(query: ReportQueryDto) {
    return {
      periodFrom: query.periodFrom,
      periodTo: query.periodTo,
    };
  }

  private buildStakeholderQuery(query: ReportQueryDto) {
    return {
      periodFrom: query.periodFrom,
      periodTo: query.periodTo,
    };
  }

  private resolvePeriodBounds(query: ReportQueryDto): { from: string; to: string } {
    if (query.periodFrom && query.periodTo) {
      return {
        from: new Date(query.periodFrom).toISOString(),
        to: new Date(query.periodTo).toISOString(),
      };
    }

    const days = query.periodDays ?? 30;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  private buildCacheKey(orgId: string, projectId: string, query: ReportQueryDto): string {
    const normalized = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('&');

    return `reports:pdf:org:${orgId}:project:${projectId}:${normalized}`;
  }
}
