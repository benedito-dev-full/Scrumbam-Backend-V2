import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgTenantGuard } from '../auth/guards/org-tenant.guard';
import { TenantConfig } from '../auth/decorators/tenant-config.decorator';
import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma.service';
import { CycleTimeService } from './services/cycle-time.service';
import { LeadTimeService } from './services/lead-time.service';
import { ThroughputService } from './services/throughput.service';
import { WipAgeService } from './services/wip-age.service';
import { CfdService } from './services/cfd.service';
import { DashboardService } from './services/dashboard.service';
import { ByPhaseResolverService } from './services/by-phase-resolver.service';
import { PeriodQueryDto } from './dto/period-query.dto';
import { GranularityQueryDto } from './dto/granularity-query.dto';
import { CycleTimeResponseDto } from './dto/cycle-time-response.dto';
import { LeadTimeResponseDto } from './dto/lead-time-response.dto';
import { ThroughputResponseDto } from './dto/throughput-response.dto';
import { WipAgeResponseDto } from './dto/wip-age-response.dto';
import { CfdResponseDto } from './dto/cfd-response.dto';
import { DashboardResponseDto } from './dto/dashboard-response.dto';

/**
 * Controller de Flow Metrics do Scrumban-Backend-V2.
 *
 * Expõe 6 endpoints GET read-only para análise de fluxo de trabalho de projetos.
 * Protegido por JWT + OrgTenantGuard (estratégia PROJECT_ESTAB — valida que o
 * projeto pertence à organização do usuário autenticado).
 *
 * F8 é read-only puro — ZERO Engine/Operacao, ZERO INSERT/UPDATE/DELETE.
 *
 * Tenant isolation: todos os endpoints chamam `assertProjectInOrg` antes de
 * qualquer cálculo, garantindo 403 quando o projeto não pertence ao org do JWT.
 *
 * @see CycleTimeService — p50/p75/p90/avg de cycle time
 * @see LeadTimeService — p50/p75/p90/avg de lead time
 * @see ThroughputService — série temporal de tasks concluídas
 * @see WipAgeService — age de tasks não-DONE por status
 * @see CfdService — CFD via replay de eventos DEvento -498
 * @see DashboardService — agregação de todos os 5 indicadores
 */
@ApiTags('flow-metrics')
@Controller('flow-metrics')
@UseGuards(JwtAuthGuard, OrgTenantGuard)
@TenantConfig('PROJECT_ESTAB')
export class FlowMetricsController {
  private readonly logger = new Logger(FlowMetricsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cycleTimeService: CycleTimeService,
    private readonly leadTimeService: LeadTimeService,
    private readonly throughputService: ThroughputService,
    private readonly wipAgeService: WipAgeService,
    private readonly cfdService: CfdService,
    private readonly dashboardService: DashboardService,
    private readonly byPhaseResolver: ByPhaseResolverService,
  ) {}

  // ─── F9b (ADR-V2-047) — Flow Metrics by Phase ─────────────────────────────
  // 6 rotas espelho de `/flow-metrics/:projectId/*` restringindo às tasks-folha
  // descendentes da fase (`DTask idClasse=-200`). Tenant scope resolvido pelo
  // `ByPhaseResolverService` (NotFound anti-enumeration). Sem `@TenantConfig`
  // explícito por rota porque o decorator de classe (`PROJECT_ESTAB`) faz
  // pass-through quando não há `:projectId`/`:id` no path (org-tenant.guard:134).

  /**
   * Cycle time restrito às tasks-folha descendentes de uma fase.
   *
   * @param phaseId - Chave BigInt da fase (`DTask idClasse=-200`) em string.
   * @param query - Filtros de período.
   * @param user - Usuário autenticado (extraído do JWT).
   * @returns CycleTimeResponseDto restrito ao escopo da fase.
   *
   * @throws {NotFoundException} Se fase inexistente, soft-deleted, idClasse != -200
   *                             ou pertencer a outra organização (anti-enumeration).
   *
   * @example
   * ```bash
   * curl -X GET "http://localhost:3000/flow-metrics/by-phase/7/cycle-time?period=month" \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get('by-phase/:phaseId/cycle-time')
  @ApiOperation({
    summary: 'Cycle time da fase',
    description: 'Cycle time de tasks-folha descendentes (recursivo via CTE) — ADR-V2-047 F9b.',
  })
  @ApiParam({ name: 'phaseId', description: 'ID da fase (DTask idClasse=-200)', example: '7' })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month'] })
  @ApiQuery({ name: 'periodFrom', required: false, description: 'Data inicial YYYY-MM-DD' })
  @ApiQuery({ name: 'periodTo', required: false, description: 'Data final YYYY-MM-DD' })
  @ApiResponse({ status: 200, type: CycleTimeResponseDto, description: 'Cycle time da fase' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Fase pertence a outra organização' })
  @ApiResponse({ status: 404, description: 'Fase não encontrada ou não é PHASE' })
  async getByPhaseCycleTime(
    @Param('phaseId') phaseId: string,
    @Query() query: PeriodQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<CycleTimeResponseDto> {
    this.logger.log(`Cycle time by-phase phase=${phaseId} user=${user.sub}`);
    const { projectId, taskIds } = await this.byPhaseResolver.resolve(phaseId, user);
    return this.cycleTimeService.calculate(projectId, query, taskIds);
  }

  /**
   * Lead time restrito às tasks-folha descendentes de uma fase.
   */
  @Get('by-phase/:phaseId/lead-time')
  @ApiOperation({
    summary: 'Lead time da fase',
    description: 'Lead time de tasks-folha descendentes (recursivo via CTE) — ADR-V2-047 F9b.',
  })
  @ApiParam({ name: 'phaseId', description: 'ID da fase (DTask idClasse=-200)', example: '7' })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month'] })
  @ApiQuery({ name: 'periodFrom', required: false, description: 'Data inicial YYYY-MM-DD' })
  @ApiQuery({ name: 'periodTo', required: false, description: 'Data final YYYY-MM-DD' })
  @ApiResponse({ status: 200, type: LeadTimeResponseDto, description: 'Lead time da fase' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Fase pertence a outra organização' })
  @ApiResponse({ status: 404, description: 'Fase não encontrada ou não é PHASE' })
  async getByPhaseLeadTime(
    @Param('phaseId') phaseId: string,
    @Query() query: PeriodQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<LeadTimeResponseDto> {
    this.logger.log(`Lead time by-phase phase=${phaseId} user=${user.sub}`);
    const { projectId, taskIds } = await this.byPhaseResolver.resolve(phaseId, user);
    return this.leadTimeService.calculate(projectId, query, taskIds);
  }

  /**
   * Throughput restrito às tasks-folha descendentes de uma fase.
   */
  @Get('by-phase/:phaseId/throughput')
  @ApiOperation({
    summary: 'Throughput da fase',
    description: 'Throughput de tasks-folha descendentes (recursivo via CTE) — ADR-V2-047 F9b.',
  })
  @ApiParam({ name: 'phaseId', description: 'ID da fase (DTask idClasse=-200)', example: '7' })
  @ApiQuery({ name: 'granularity', required: false, enum: ['day', 'week'] })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month'] })
  @ApiQuery({ name: 'periodFrom', required: false, description: 'Data inicial YYYY-MM-DD' })
  @ApiQuery({ name: 'periodTo', required: false, description: 'Data final YYYY-MM-DD' })
  @ApiResponse({ status: 200, type: ThroughputResponseDto, description: 'Throughput da fase' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Fase pertence a outra organização' })
  @ApiResponse({ status: 404, description: 'Fase não encontrada ou não é PHASE' })
  async getByPhaseThroughput(
    @Param('phaseId') phaseId: string,
    @Query() query: PeriodQueryDto,
    @Query() granularityQuery: GranularityQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ThroughputResponseDto> {
    this.logger.log(`Throughput by-phase phase=${phaseId} user=${user.sub}`);
    const { projectId, taskIds } = await this.byPhaseResolver.resolve(phaseId, user);
    return this.throughputService.calculate(
      projectId,
      granularityQuery.granularity ?? 'day',
      query,
      taskIds,
    );
  }

  /**
   * WIP age restrito às tasks-folha descendentes de uma fase.
   */
  @Get('by-phase/:phaseId/wip-age')
  @ApiOperation({
    summary: 'WIP age da fase',
    description: 'WIP age de tasks-folha descendentes (recursivo via CTE) — ADR-V2-047 F9b.',
  })
  @ApiParam({ name: 'phaseId', description: 'ID da fase (DTask idClasse=-200)', example: '7' })
  @ApiResponse({ status: 200, type: WipAgeResponseDto, description: 'WIP age da fase' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Fase pertence a outra organização' })
  @ApiResponse({ status: 404, description: 'Fase não encontrada ou não é PHASE' })
  async getByPhaseWipAge(
    @Param('phaseId') phaseId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<WipAgeResponseDto> {
    this.logger.log(`WIP age by-phase phase=${phaseId} user=${user.sub}`);
    const { projectId, taskIds } = await this.byPhaseResolver.resolve(phaseId, user);
    return this.wipAgeService.calculate(projectId, taskIds);
  }

  /**
   * CFD restrito às tasks-folha descendentes de uma fase.
   */
  @Get('by-phase/:phaseId/cfd')
  @ApiOperation({
    summary: 'CFD da fase',
    description: 'CFD de tasks-folha descendentes (recursivo via CTE) — ADR-V2-047 F9b.',
  })
  @ApiParam({ name: 'phaseId', description: 'ID da fase (DTask idClasse=-200)', example: '7' })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month'] })
  @ApiQuery({ name: 'periodFrom', required: false, description: 'Data inicial YYYY-MM-DD' })
  @ApiQuery({ name: 'periodTo', required: false, description: 'Data final YYYY-MM-DD' })
  @ApiResponse({ status: 200, type: CfdResponseDto, description: 'CFD da fase' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Fase pertence a outra organização' })
  @ApiResponse({ status: 404, description: 'Fase não encontrada ou não é PHASE' })
  async getByPhaseCfd(
    @Param('phaseId') phaseId: string,
    @Query() query: PeriodQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<CfdResponseDto> {
    this.logger.log(`CFD by-phase phase=${phaseId} user=${user.sub}`);
    const { projectId, taskIds } = await this.byPhaseResolver.resolve(phaseId, user);
    return this.cfdService.calculate(projectId, query, taskIds);
  }

  /**
   * Dashboard restrito às tasks-folha descendentes de uma fase.
   *
   * Promise.all interno paraleliza os 5 services. N+1 budget: 2 (CTE+resolver)
   * + ~5 (queries internas dos services) = ~7 queries no total.
   */
  @Get('by-phase/:phaseId/dashboard')
  @ApiOperation({
    summary: 'Dashboard consolidado da fase',
    description: 'Dashboard de tasks-folha descendentes (recursivo via CTE) — ADR-V2-047 F9b.',
  })
  @ApiParam({ name: 'phaseId', description: 'ID da fase (DTask idClasse=-200)', example: '7' })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month'] })
  @ApiQuery({ name: 'periodFrom', required: false, description: 'Data inicial YYYY-MM-DD' })
  @ApiQuery({ name: 'periodTo', required: false, description: 'Data final YYYY-MM-DD' })
  @ApiResponse({ status: 200, type: DashboardResponseDto, description: 'Dashboard da fase' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Fase pertence a outra organização' })
  @ApiResponse({ status: 404, description: 'Fase não encontrada ou não é PHASE' })
  async getByPhaseDashboard(
    @Param('phaseId') phaseId: string,
    @Query() query: PeriodQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<DashboardResponseDto> {
    this.logger.log(`Dashboard by-phase phase=${phaseId} user=${user.sub}`);
    const { projectId, taskIds } = await this.byPhaseResolver.resolve(phaseId, user);
    return this.dashboardService.getDashboard(projectId, query, taskIds);
  }

  /**
   * Retorna as métricas de cycle time de um projeto.
   *
   * Cycle time = tempo entre EXECUTING e DONE (em horas).
   * Calculado sobre tasks com `dados.telemetry.cycleTime` preenchido.
   * Requer autenticação JWT; projeto deve pertencer à organização do usuário.
   *
   * @param projectId - ID do projeto (chave do DProject)
   * @param query - Filtros de período
   * @param user - Usuário autenticado (extraído do JWT)
   * @returns CycleTimeResponseDto com p50/p75/p90/avg/samples
   *
   * @throws {UnauthorizedException} Se token JWT inválido ou ausente
   * @throws {ForbiddenException} Se projeto pertence a outra organização
   * @throws {NotFoundException} Se projeto não encontrado
   * @throws {BadRequestException} Se período inválido
   *
   * @example
   * ```bash
   * curl -X GET "http://localhost:3000/flow-metrics/123/cycle-time?period=month" \
   *   -H "Authorization: Bearer {token}"
   * ```
   *
   * @example
   * ```json
   * { "p50": 4.5, "p75": 8.0, "p90": 16.2, "avg": 6.1, "samples": 42, "unit": "hours" }
   * ```
   */
  @Get(':projectId/cycle-time')
  @ApiOperation({
    summary: 'Cycle time do projeto',
    description:
      'Retorna p50/p75/p90/avg de cycle time (horas) baseado em dados de telemetria das tasks concluídas',
  })
  @ApiParam({ name: 'projectId', description: 'ID do projeto', example: '123' })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['today', 'week', 'month'],
    description: 'Período pré-definido',
  })
  @ApiQuery({ name: 'periodFrom', required: false, description: 'Data inicial YYYY-MM-DD' })
  @ApiQuery({ name: 'periodTo', required: false, description: 'Data final YYYY-MM-DD' })
  @ApiResponse({ status: 200, type: CycleTimeResponseDto, description: 'Cycle time calculado' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Projeto pertence a outra organização' })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  async getCycleTime(
    @Param('projectId') projectId: string,
    @Query() query: PeriodQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<CycleTimeResponseDto> {
    this.logger.log(`Cycle time project=${projectId} user=${user.sub}`);
    const pid = await this.resolveProjectId(projectId, user);
    return this.cycleTimeService.calculate(pid, query);
  }

  /**
   * Retorna as métricas de lead time de um projeto.
   *
   * Lead time = tempo entre criação (INBOX) e DONE (em horas).
   * Calculado sobre tasks com `dados.telemetry.leadTime` preenchido.
   *
   * @param projectId - ID do projeto
   * @param query - Filtros de período
   * @param user - Usuário autenticado
   * @returns LeadTimeResponseDto com p50/p75/p90/avg/samples
   *
   * @throws {UnauthorizedException} Se token JWT inválido ou ausente
   * @throws {ForbiddenException} Se projeto pertence a outra organização
   * @throws {NotFoundException} Se projeto não encontrado
   *
   * @example
   * ```bash
   * curl -X GET "http://localhost:3000/flow-metrics/123/lead-time?period=week" \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get(':projectId/lead-time')
  @ApiOperation({
    summary: 'Lead time do projeto',
    description: 'Retorna p50/p75/p90/avg de lead time (horas) desde criação até conclusão da task',
  })
  @ApiParam({ name: 'projectId', description: 'ID do projeto', example: '123' })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month'] })
  @ApiQuery({ name: 'periodFrom', required: false, description: 'Data inicial YYYY-MM-DD' })
  @ApiQuery({ name: 'periodTo', required: false, description: 'Data final YYYY-MM-DD' })
  @ApiResponse({ status: 200, type: LeadTimeResponseDto, description: 'Lead time calculado' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Projeto pertence a outra organização' })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  async getLeadTime(
    @Param('projectId') projectId: string,
    @Query() query: PeriodQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<LeadTimeResponseDto> {
    this.logger.log(`Lead time project=${projectId} user=${user.sub}`);
    const pid = await this.resolveProjectId(projectId, user);
    return this.leadTimeService.calculate(pid, query);
  }

  /**
   * Retorna a série temporal de throughput de um projeto.
   *
   * Throughput = quantidade de tasks concluídas por dia ou semana.
   * Baseado em `dados.telemetry.doneAt` das tasks com status DONE.
   *
   * @param projectId - ID do projeto
   * @param query - Filtros de período
   * @param granularityQuery - Granularidade temporal ('day' ou 'week')
   * @param user - Usuário autenticado
   * @returns ThroughputResponseDto com série temporal e total
   *
   * @throws {UnauthorizedException} Se token JWT inválido ou ausente
   * @throws {ForbiddenException} Se projeto pertence a outra organização
   * @throws {NotFoundException} Se projeto não encontrado
   *
   * @example
   * ```bash
   * curl -X GET "http://localhost:3000/flow-metrics/123/throughput?granularity=day&period=month" \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get(':projectId/throughput')
  @ApiOperation({
    summary: 'Throughput do projeto',
    description: 'Série temporal de tasks concluídas por dia ou semana',
  })
  @ApiParam({ name: 'projectId', description: 'ID do projeto', example: '123' })
  @ApiQuery({
    name: 'granularity',
    required: false,
    enum: ['day', 'week'],
    description: 'Granularidade temporal',
  })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month'] })
  @ApiQuery({ name: 'periodFrom', required: false, description: 'Data inicial YYYY-MM-DD' })
  @ApiQuery({ name: 'periodTo', required: false, description: 'Data final YYYY-MM-DD' })
  @ApiResponse({ status: 200, type: ThroughputResponseDto, description: 'Throughput calculado' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Projeto pertence a outra organização' })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  async getThroughput(
    @Param('projectId') projectId: string,
    @Query() query: PeriodQueryDto,
    @Query() granularityQuery: GranularityQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ThroughputResponseDto> {
    this.logger.log(`Throughput project=${projectId} user=${user.sub}`);
    const pid = await this.resolveProjectId(projectId, user);
    return this.throughputService.calculate(pid, granularityQuery.granularity ?? 'day', query);
  }

  /**
   * Retorna o WIP (Work in Progress) age do projeto.
   *
   * Mostra tasks não-DONE agrupadas por status com idade média e máxima.
   * Útil para identificar gargalos e tasks bloqueadas.
   *
   * @param projectId - ID do projeto
   * @param user - Usuário autenticado
   * @returns WipAgeResponseDto com breakdown por status
   *
   * @throws {UnauthorizedException} Se token JWT inválido ou ausente
   * @throws {ForbiddenException} Se projeto pertence a outra organização
   * @throws {NotFoundException} Se projeto não encontrado
   *
   * @example
   * ```bash
   * curl -X GET "http://localhost:3000/flow-metrics/123/wip-age" \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get(':projectId/wip-age')
  @ApiOperation({
    summary: 'WIP age do projeto',
    description: 'Idade das tasks em andamento (não concluídas) agrupadas por status',
  })
  @ApiParam({ name: 'projectId', description: 'ID do projeto', example: '123' })
  @ApiResponse({ status: 200, type: WipAgeResponseDto, description: 'WIP age calculado' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Projeto pertence a outra organização' })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  async getWipAge(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<WipAgeResponseDto> {
    this.logger.log(`WIP age project=${projectId} user=${user.sub}`);
    const pid = await this.resolveProjectId(projectId, user);
    return this.wipAgeService.calculate(pid);
  }

  /**
   * Retorna o CFD (Cumulative Flow Diagram) do projeto.
   *
   * Reconstrói o CFD por replay de eventos DEvento -498 (TASK_STATUS_CHANGED).
   * Mostra a evolução de tasks por status ao longo do tempo.
   *
   * @param projectId - ID do projeto
   * @param query - Filtros de período
   * @param user - Usuário autenticado
   * @returns CfdResponseDto com série temporal de counts por status
   *
   * @throws {UnauthorizedException} Se token JWT inválido ou ausente
   * @throws {ForbiddenException} Se projeto pertence a outra organização
   * @throws {NotFoundException} Se projeto não encontrado
   *
   * @example
   * ```bash
   * curl -X GET "http://localhost:3000/flow-metrics/123/cfd?period=month" \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get(':projectId/cfd')
  @ApiOperation({
    summary: 'CFD do projeto',
    description: 'Cumulative Flow Diagram via replay de eventos de transição de status',
  })
  @ApiParam({ name: 'projectId', description: 'ID do projeto', example: '123' })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month'] })
  @ApiQuery({ name: 'periodFrom', required: false, description: 'Data inicial YYYY-MM-DD' })
  @ApiQuery({ name: 'periodTo', required: false, description: 'Data final YYYY-MM-DD' })
  @ApiResponse({ status: 200, type: CfdResponseDto, description: 'CFD calculado' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Projeto pertence a outra organização' })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  async getCfd(
    @Param('projectId') projectId: string,
    @Query() query: PeriodQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<CfdResponseDto> {
    this.logger.log(`CFD project=${projectId} user=${user.sub}`);
    const pid = await this.resolveProjectId(projectId, user);
    return this.cfdService.calculate(pid, query);
  }

  /**
   * Retorna o dashboard consolidado de flow metrics do projeto.
   *
   * Agrega cycle time, lead time, throughput, WIP age e CFD em uma única
   * chamada paralela (Promise.all). Carrega o dashboard completo com 1 request.
   *
   * @param projectId - ID do projeto
   * @param query - Filtros de período (aplicados em todos os indicadores, exceto WIP age)
   * @param user - Usuário autenticado
   * @returns DashboardResponseDto com todos os 5 indicadores
   *
   * @throws {UnauthorizedException} Se token JWT inválido ou ausente
   * @throws {ForbiddenException} Se projeto pertence a outra organização
   * @throws {NotFoundException} Se projeto não encontrado
   *
   * @example
   * ```bash
   * curl -X GET "http://localhost:3000/flow-metrics/123/dashboard?period=month" \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get(':projectId/dashboard')
  @ApiOperation({
    summary: 'Dashboard consolidado de flow metrics',
    description: 'Agrega cycle time, lead time, throughput, WIP age e CFD em uma única request',
  })
  @ApiParam({ name: 'projectId', description: 'ID do projeto', example: '123' })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month'] })
  @ApiQuery({ name: 'periodFrom', required: false, description: 'Data inicial YYYY-MM-DD' })
  @ApiQuery({ name: 'periodTo', required: false, description: 'Data final YYYY-MM-DD' })
  @ApiResponse({ status: 200, type: DashboardResponseDto, description: 'Dashboard calculado' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Projeto pertence a outra organização' })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  async getDashboard(
    @Param('projectId') projectId: string,
    @Query() query: PeriodQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<DashboardResponseDto> {
    this.logger.log(`Dashboard project=${projectId} user=${user.sub}`);
    const pid = await this.resolveProjectId(projectId, user);
    return this.dashboardService.getDashboard(pid, query);
  }

  /**
   * Valida existência e tenant do projeto, retornando o BigInt.
   *
   * Centraliza a lógica de tenant isolation para todos os endpoints.
   * Tenant isolation primário é feito pelo OrgTenantGuard (PROJECT_ESTAB).
   * Esta validação adicional garante 404 explícito quando o projeto não existe.
   *
   * @param projectId - ID do projeto como string
   * @param user - Payload JWT do usuário autenticado
   * @returns BigInt do projectId
   * @throws {NotFoundException} Se projeto não encontrado
   * @throws {ForbiddenException} Se org do projeto != org do JWT
   */
  private async resolveProjectId(projectId: string, user: JwtPayload): Promise<bigint> {
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

    // Validação explícita de tenant (dupla segurança além do OrgTenantGuard)
    if (user.organizationId && project.idEstab) {
      if (project.idEstab.toString() !== user.organizationId) {
        throw new ForbiddenException('Acesso negado: projeto pertence a outra organização');
      }
    }

    return pid;
  }
}
