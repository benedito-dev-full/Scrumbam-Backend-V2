import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { TtlCacheService } from '../common/cache/ttl-cache.service';
import { TimezoneService } from '../common/services/timezone.service';
import { DashboardService as FlowMetricsDashboardService } from '../flow-metrics/services/dashboard.service';
import { ThroughputService } from '../flow-metrics/services/throughput.service';
import { PeriodResolver } from '../flow-metrics/helpers/period-resolver';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { MetricsDashboardResponseDto } from './dto/metrics-dashboard-response.dto';
import { VelocityResponseDto, VelocitySeriesItemDto } from './dto/velocity-response.dto';
import { BurndownResponseDto, BurndownSeriesItemDto } from './dto/burndown-response.dto';
import { TasksByUserItemDto, TasksByUserResponseDto } from './dto/tasks-by-user-response.dto';
import { DailySummaryResponseDto } from './dto/daily-summary-response.dto';

const CACHE_TTL_SECONDS = 60;
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;
const SPRINT_CLASSE_MIN = BigInt(-419);
const SPRINT_CLASSE_MAX = BigInt(-400);
const DONE_STATUS_CLASS_IDS = [BigInt(-444), BigInt(-449)];
const ACTIVE_STATUS_CODES = new Set(['EXECUTING', 'VALIDATING']);
const BLOCKED_OR_FAILED_STATUS_CODES = new Set(['FAILED']);
const UNASSIGNED = 'Unassigned';

interface CachedEnvelope<T> {
  value: T;
  hit: boolean;
}

interface TaskDashboardRow {
  chave: bigint;
  idStatus: bigint | null;
  idSprint: bigint | null;
  idAssignee: bigint | null;
  criadoEm: Date;
  dados: Prisma.JsonValue | null;
  assignee?: { chave: bigint; nome: string | null; email: string | null } | null;
}

/**
 * Service read-only dos dashboards F9.
 *
 * Agrega dados de F8 e consultas Prisma SELECT sobre DTask/DTabela.
 * Nao usa Engine/Operacao e nao executa writes.
 */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TtlCacheService,
    private readonly flowMetricsDashboardService: FlowMetricsDashboardService,
    private readonly throughputService: ThroughputService,
    private readonly periodResolver: PeriodResolver,
    private readonly timezoneService: TimezoneService,
  ) {}

  /**
   * Resolve e valida acesso tenant ao projeto solicitado.
   *
   * @param projectId - ID recebido por parametro de rota
   * @param orgId - Organizacao do usuario autenticado
   * @returns Chave BigInt do projeto
   * @throws NotFoundException quando o ID e invalido ou o projeto nao existe
   * @throws ForbiddenException quando o projeto pertence a outra organizacao
   */
  async resolveProjectId(projectId: string, orgId: string): Promise<bigint> {
    if (!orgId) {
      throw new ForbiddenException('Acesso negado: organizacao ausente no token');
    }

    let pid: bigint;
    try {
      pid = BigInt(projectId);
    } catch {
      throw new NotFoundException(`Projeto ${projectId} nao encontrado`);
    }

    const project = await this.prisma.dProject.findFirst({
      where: { chave: pid, excluido: false },
      select: { chave: true, idEstab: true },
    });

    if (!project) {
      throw new NotFoundException(`Projeto ${projectId} nao encontrado`);
    }

    if (project.idEstab?.toString() !== orgId) {
      throw new ForbiddenException('Acesso negado: projeto pertence a outra organizacao');
    }

    return pid;
  }

  /**
   * Retorna dashboard consolidado de flow metrics com cache TTL de 60s.
   *
   * @param orgId - Organizacao do usuario autenticado
   * @param projectId - Chave BigInt do projeto
   * @param query - Filtros de periodo
   * @returns Metricas F8 agregadas com metadados de cache
   */
  async getMetrics(
    orgId: string,
    projectId: bigint,
    query: DashboardQueryDto,
  ): Promise<MetricsDashboardResponseDto> {
    const { value, hit } = await this.getCached(
      this.buildCacheKey('metrics', orgId, projectId, query),
      () => this.flowMetricsDashboardService.getDashboard(projectId, query),
    );

    return {
      ...value,
      cache: { hit, ttlSeconds: CACHE_TTL_SECONDS },
    };
  }

  /**
   * Retorna velocity por sprint quando houver sprints, com fallback para throughput.
   *
   * @param orgId - Organizacao do usuario autenticado
   * @param projectId - Chave BigInt do projeto
   * @param query - Filtros de periodo, granularidade e sprint opcional
   * @returns Serie de velocity e media do periodo
   */
  async getVelocity(
    orgId: string,
    projectId: bigint,
    query: DashboardQueryDto,
  ): Promise<VelocityResponseDto> {
    const { value, hit } = await this.getCached(
      this.buildCacheKey('velocity', orgId, projectId, query),
      async () => this.calculateVelocity(projectId, query),
    );

    return { ...value, cache: { hit, ttlSeconds: CACHE_TTL_SECONDS } };
  }

  /**
   * Retorna burndown planned vs actual com cache TTL de 60s.
   *
   * @param orgId - Organizacao do usuario autenticado
   * @param projectId - Chave BigInt do projeto
   * @param query - Filtros de periodo e sprint opcional
   * @returns Serie diaria de burndown
   */
  async getBurndown(
    orgId: string,
    projectId: bigint,
    query: DashboardQueryDto,
  ): Promise<BurndownResponseDto> {
    const { value, hit } = await this.getCached(
      this.buildCacheKey('burndown', orgId, projectId, query),
      async () => this.calculateBurndown(projectId, query),
    );

    return { ...value, cache: { hit, ttlSeconds: CACHE_TTL_SECONDS } };
  }

  /**
   * Agrupa tasks por usuario/responsavel e status, sem N+1.
   *
   * @param orgId - Organizacao do usuario autenticado
   * @param projectId - Chave BigInt do projeto
   * @param query - Filtros de periodo e sprint opcional
   * @returns Lista de usuarios com contagem por status
   */
  async getTasksByUser(
    orgId: string,
    projectId: bigint,
    query: DashboardQueryDto,
  ): Promise<TasksByUserResponseDto> {
    const { value, hit } = await this.getCached(
      this.buildCacheKey('tasks-by-user', orgId, projectId, query),
      async () => this.calculateTasksByUser(projectId, query),
    );

    return { ...value, cache: { hit, ttlSeconds: CACHE_TTL_SECONDS } };
  }

  /**
   * Retorna snapshot diario do projeto com cache TTL de 60s.
   *
   * O Bloco V usa TTL consistente de 60s para todos os endpoints.
   *
   * @param orgId - Organizacao do usuario autenticado
   * @param projectId - Chave BigInt do projeto
   * @returns Resumo do dia no timezone America/Sao_Paulo
   */
  async getDailySummary(orgId: string, projectId: bigint): Promise<DailySummaryResponseDto> {
    const { value, hit } = await this.getCached(
      this.buildCacheKey('daily-summary', orgId, projectId, { period: 'today' }),
      async () => this.calculateDailySummary(projectId),
    );

    return { ...value, cache: { hit, ttlSeconds: CACHE_TTL_SECONDS } };
  }

  private async getCached<T>(key: string, factory: () => Promise<T>): Promise<CachedEnvelope<T>> {
    const cached = this.cache.get<T>(key);
    if (cached !== undefined) {
      return { value: cached, hit: true };
    }

    const value = await factory();
    this.cache.set(key, value, CACHE_TTL_MS);
    return { value, hit: false };
  }

  private async calculateVelocity(
    projectId: bigint,
    query: DashboardQueryDto,
  ): Promise<Omit<VelocityResponseDto, 'cache'>> {
    const range = this.periodResolver.resolve(query);
    const sprintId = query.sprintId ? BigInt(query.sprintId) : undefined;

    if (sprintId) {
      const sprint = await this.prisma.dTabela.findFirst({
        where: {
          chave: sprintId,
          idClasse: { gte: SPRINT_CLASSE_MIN, lte: SPRINT_CLASSE_MAX },
          dEntidadeId: projectId,
          excluido: false,
        },
        select: { chave: true, nome: true, dados: true, metaDados: true },
      });

      const tasks = await this.findTasks(projectId, query);
      const completed = this.countCompleted(tasks);
      const planned = tasks.length;

      const series = [{
        label: sprint?.nome ?? `Sprint ${sprintId.toString()}`,
        sprintId: sprintId.toString(),
        completed,
        planned,
        ...this.extractSprintDates(sprint?.dados, sprint?.metaDados),
      }];

      return {
        projectId: projectId.toString(),
        series,
        avgVelocity: completed,
        period: this.toPeriodDto(range),
      };
    }

    const sprints = await this.prisma.dTabela.findMany({
      where: {
        idClasse: { gte: SPRINT_CLASSE_MIN, lte: SPRINT_CLASSE_MAX },
        dEntidadeId: projectId,
        excluido: false,
      },
      select: { chave: true, nome: true, dados: true, metaDados: true },
      orderBy: { chave: 'asc' },
    });

    if (sprints.length === 0) {
      const throughput = await this.throughputService.calculate(
        projectId,
        query.granularity ?? 'week',
        query,
      );
      const series = throughput.series.map((item) => ({
        label: item.date,
        completed: item.count,
      }));

      return {
        projectId: projectId.toString(),
        series,
        avgVelocity: this.average(series.map((item) => item.completed)),
        period: this.toPeriodDto(range),
      };
    }

    const tasks = await this.findTasks(projectId, query);
    const doneStatusIds = await this.getDoneStatusIds(projectId);
    const bySprint = new Map<string, { planned: number; completed: number }>();

    for (const task of tasks) {
      const key = task.idSprint?.toString() ?? 'backlog';
      const current = bySprint.get(key) ?? { planned: 0, completed: 0 };
      current.planned += 1;
      if (task.idStatus && doneStatusIds.has(task.idStatus.toString())) {
        current.completed += 1;
      }
      bySprint.set(key, current);
    }

    const series: VelocitySeriesItemDto[] = sprints.map((sprint) => {
      const values = bySprint.get(sprint.chave.toString()) ?? { planned: 0, completed: 0 };
      return {
        label: sprint.nome,
        sprintId: sprint.chave.toString(),
        completed: values.completed,
        planned: values.planned,
        ...this.extractSprintDates(sprint.dados, sprint.metaDados),
      };
    });

    return {
      projectId: projectId.toString(),
      series,
      avgVelocity: this.average(series.map((item) => item.completed)),
      period: this.toPeriodDto(range),
    };
  }

  private async calculateBurndown(
    projectId: bigint,
    query: DashboardQueryDto,
  ): Promise<Omit<BurndownResponseDto, 'cache'>> {
    const range = this.periodResolver.resolve(query);
    const tasks = await this.findTasks(projectId, query);
    const dates = this.enumerateDays(range.gte, range.lte);
    const scopeTotal = tasks.length;
    const doneAtDates = tasks
      .map((task) => this.getDoneAt(task.dados))
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => a.getTime() - b.getTime());

    const series: BurndownSeriesItemDto[] = dates.map((date, index) => {
      const completedUntilDay = doneAtDates.filter(
        (doneAt) => doneAt.getTime() <= this.endOfUtcDay(date).getTime(),
      ).length;
      const plannedRemaining = Math.max(0, scopeTotal - Math.floor((scopeTotal * (index + 1)) / dates.length));
      return {
        date: date.toISOString().slice(0, 10),
        plannedRemaining,
        actualRemaining: Math.max(0, scopeTotal - completedUntilDay),
      };
    });

    return {
      projectId: projectId.toString(),
      series,
      scopeTotal,
      completedTotal: doneAtDates.length,
      period: this.toPeriodDto(range),
    };
  }

  private async calculateTasksByUser(
    projectId: bigint,
    query: DashboardQueryDto,
  ): Promise<Omit<TasksByUserResponseDto, 'cache'>> {
    const tasks = await this.findTasks(projectId, query, { applyActivityPeriod: true });
    const statusMap = await this.getStatusMap(tasks);
    const grouped = new Map<string, TasksByUserItemDto>();

    for (const task of tasks) {
      const userId = task.idAssignee?.toString() ?? null;
      const key = userId ?? 'unassigned';
      const userName = task.assignee?.nome ?? task.assignee?.email ?? UNASSIGNED;
      const statusCode = task.idStatus ? statusMap.get(task.idStatus.toString()) ?? 'UNKNOWN' : 'UNKNOWN';
      const current = grouped.get(key) ?? {
        userId,
        userName,
        total: 0,
        byStatus: {},
      };

      current.total += 1;
      current.byStatus[statusCode] = (current.byStatus[statusCode] ?? 0) + 1;
      grouped.set(key, current);
    }

    const users = Array.from(grouped.values()).sort((a, b) => b.total - a.total);

    return {
      projectId: projectId.toString(),
      users,
    };
  }

  private async calculateDailySummary(
    projectId: bigint,
  ): Promise<Omit<DailySummaryResponseDto, 'cache'>> {
    const range = this.timezoneService.getPeriodDates('today');
    const tasks = await this.findTasks(projectId, { period: 'today' });
    const statusMap = await this.getStatusMap(tasks);
    const doneStatusIds = await this.getDoneStatusIds(projectId);

    let completedToday = 0;
    let createdToday = 0;
    let inProgress = 0;
    let blockedOrFailed = 0;

    for (const task of tasks) {
      if (task.criadoEm >= range.gte && task.criadoEm <= range.lte) {
        createdToday += 1;
      }

      const doneAt = this.getDoneAt(task.dados);
      if (doneAt && doneAt >= range.gte && doneAt <= range.lte) {
        completedToday += 1;
      }

      const statusCode = task.idStatus ? statusMap.get(task.idStatus.toString()) : undefined;
      if (statusCode && ACTIVE_STATUS_CODES.has(statusCode)) {
        inProgress += 1;
      }
      if (
        (statusCode && BLOCKED_OR_FAILED_STATUS_CODES.has(statusCode)) ||
        (task.idStatus && !doneStatusIds.has(task.idStatus.toString()) && this.isBlocked(task.dados))
      ) {
        blockedOrFailed += 1;
      }
    }

    const highlights = [
      `${completedToday} tasks concluidas hoje`,
      `${createdToday} tasks criadas hoje`,
      `${inProgress} tasks em progresso`,
    ];
    if (blockedOrFailed > 0) {
      highlights.push(`${blockedOrFailed} tasks bloqueadas ou com falha`);
    }

    return {
      projectId: projectId.toString(),
      date: this.timezoneService.toBrazilTime(new Date()).toISOString().slice(0, 10),
      completedToday,
      createdToday,
      inProgress,
      blockedOrFailed,
      highlights,
    };
  }

  private async findTasks(
    projectId: bigint,
    query: DashboardQueryDto,
    options: { applyActivityPeriod?: boolean } = {},
  ): Promise<TaskDashboardRow[]> {
    const range = this.periodResolver.resolve(query);
    return this.prisma.dTask.findMany({
      where: {
        idProject: projectId,
        excluido: false,
        ...(query.sprintId ? { idSprint: BigInt(query.sprintId) } : {}),
        ...(options.applyActivityPeriod
          ? {
              OR: [
                { criadoEm: { gte: range.gte, lte: range.lte } },
                { atualizadoEm: { gte: range.gte, lte: range.lte } },
              ],
            }
          : {}),
      },
      select: {
        chave: true,
        idStatus: true,
        idSprint: true,
        idAssignee: true,
        criadoEm: true,
        dados: true,
        assignee: {
          select: {
            chave: true,
            nome: true,
            email: true,
          },
        },
      },
    });
  }

  private countCompleted(tasks: TaskDashboardRow[]): number {
    return tasks.filter((task) => Boolean(this.getDoneAt(task.dados))).length;
  }

  private async getDoneStatusIds(projectId: bigint): Promise<Set<string>> {
    const statuses = await this.prisma.dTabela.findMany({
      where: {
        dEntidadeId: projectId,
        idClasse: { in: DONE_STATUS_CLASS_IDS },
        excluido: false,
      },
      select: { chave: true },
    });

    const ids = new Set(statuses.map((status) => status.chave.toString()));
    for (const fallback of DONE_STATUS_CLASS_IDS) {
      ids.add(fallback.toString());
    }
    return ids;
  }

  private async getStatusMap(tasks: TaskDashboardRow[]): Promise<Map<string, string>> {
    const statusIds = Array.from(
      new Set(tasks.map((task) => task.idStatus?.toString()).filter((id): id is string => Boolean(id))),
    ).map((id) => BigInt(id));

    if (statusIds.length === 0) {
      return new Map();
    }

    const statuses = await this.prisma.dTabela.findMany({
      where: { chave: { in: statusIds }, excluido: false },
      select: { chave: true, idClasse: true, codigo: true, nome: true },
    });

    const map = new Map<string, string>();
    for (const status of statuses) {
      map.set(status.chave.toString(), status.codigo ?? status.nome);
    }

    for (const task of tasks) {
      if (task.idStatus && !map.has(task.idStatus.toString())) {
        map.set(task.idStatus.toString(), this.statusCodeFallback(task.idStatus.toString()));
      }
    }

    return map;
  }

  private statusCodeFallback(id: string): string {
    const fallback: Record<string, string> = {
      '-441': 'INBOX',
      '-442': 'READY',
      '-443': 'EXECUTING',
      '-444': 'DONE',
      '-445': 'FAILED',
      '-446': 'CANCELLED',
      '-447': 'DISCARDED',
      '-448': 'VALIDATING',
      '-449': 'VALIDATED',
    };
    return fallback[id] ?? id;
  }

  private getDoneAt(dados: Prisma.JsonValue | null): Date | null {
    const telemetry = this.getNestedRecord(dados, 'telemetry');
    const rawDoneAt = telemetry?.doneAt;
    if (typeof rawDoneAt !== 'string') {
      return null;
    }
    const doneAt = new Date(rawDoneAt);
    return Number.isNaN(doneAt.getTime()) ? null : doneAt;
  }

  private isBlocked(dados: Prisma.JsonValue | null): boolean {
    const record = this.asRecord(dados);
    const v3 = this.asRecord(record?.v3);
    const blocked = record?.blocked ?? v3?.blocked;
    return blocked === true;
  }

  private getNestedRecord(value: Prisma.JsonValue | null, key: string): Record<string, unknown> | null {
    const record = this.asRecord(value);
    return this.asRecord(record?.[key]);
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private buildCacheKey(
    endpoint: string,
    orgId: string,
    projectId: bigint,
    query: Partial<DashboardQueryDto>,
  ): string {
    const normalized = Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('&');

    return `dashboards:${endpoint}:org:${orgId}:project:${projectId.toString()}:${normalized}`;
  }

  private toPeriodDto(range: { gte: Date; lte: Date }): { from: string; to: string } {
    return {
      from: range.gte.toISOString(),
      to: range.lte.toISOString(),
    };
  }

  private enumerateDays(from: Date, to: Date): Date[] {
    const days: Date[] = [];
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

    while (cursor <= end) {
      days.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return days.length > 0 ? days : [new Date(from)];
  }

  private endOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    const avg = values.reduce((acc, value) => acc + value, 0) / values.length;
    return Math.round(avg * 100) / 100;
  }

  private extractSprintDates(
    dados: Prisma.JsonValue | null | undefined,
    metaDados: Prisma.JsonValue | null | undefined,
  ): { startDate?: string; endDate?: string } {
    const source = this.asRecord(dados) ?? this.asRecord(metaDados);
    const startDate = this.firstString(source, ['startDate', 'startedAt', 'inicio']);
    const endDate = this.firstString(source, ['endDate', 'endedAt', 'fim']);
    return {
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    };
  }

  private firstString(source: Record<string, unknown> | null, keys: string[]): string | undefined {
    if (!source) {
      return undefined;
    }

    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string') {
        return value;
      }
    }

    return undefined;
  }
}
