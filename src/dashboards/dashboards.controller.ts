import {
  Controller,
  Get,
  Logger,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgTenantGuard } from '../auth/guards/org-tenant.guard';
import { TenantConfig } from '../auth/decorators/tenant-config.decorator';
import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';
import { DashboardsService } from './dashboards.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { MetricsDashboardResponseDto } from './dto/metrics-dashboard-response.dto';
import { VelocityResponseDto } from './dto/velocity-response.dto';
import { BurndownResponseDto } from './dto/burndown-response.dto';
import { TasksByUserResponseDto } from './dto/tasks-by-user-response.dto';
import { DailySummaryResponseDto } from './dto/daily-summary-response.dto';

/**
 * Controller read-only de dashboards F9.
 *
 * Endpoints proprios existem apenas para agregacoes/dashboard e nao duplicam
 * CRUD de Project/Task/Sprint/Status/User/Org.
 */
@ApiTags('dashboards')
@Controller('dashboards')
@UseGuards(JwtAuthGuard, OrgTenantGuard)
@TenantConfig('PROJECT_ESTAB')
export class DashboardsController {
  private readonly logger = new Logger(DashboardsController.name);

  constructor(private readonly dashboardsService: DashboardsService) {}

  /**
   * Retorna flow metrics agregadas do projeto.
   *
   * @param projectId - ID do projeto
   * @param query - Filtros do dashboard
   * @param user - Usuario autenticado
   * @returns Dashboard de metricas F8 com cache TTL
   */
  @Get('projects/:projectId/metrics')
  @ApiOperation({ summary: 'Metricas consolidadas do dashboard do projeto' })
  @ApiParam({ name: 'projectId', example: '123' })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month'] })
  @ApiQuery({ name: 'periodFrom', required: false, example: '2026-05-01' })
  @ApiQuery({ name: 'periodTo', required: false, example: '2026-05-31' })
  @ApiResponse({ status: 200, type: MetricsDashboardResponseDto })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  @ApiResponse({ status: 403, description: 'Projeto pertence a outra organizacao' })
  @ApiResponse({ status: 404, description: 'Projeto nao encontrado' })
  async getMetrics(
    @Param('projectId') projectId: string,
    @Query() query: DashboardQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<MetricsDashboardResponseDto> {
    this.logger.log(`Dashboard metrics project=${projectId} user=${user.sub}`);
    const orgId = this.orgCacheKey(user);
    const pid = await this.dashboardsService.resolveProjectId(projectId, orgId);
    return this.dashboardsService.getMetrics(orgId, pid, query);
  }

  /**
   * Retorna velocity do projeto por sprint ou periodo.
   *
   * @param projectId - ID do projeto
   * @param query - Filtros do dashboard
   * @param user - Usuario autenticado
   * @returns Serie de velocity
   */
  @Get('projects/:projectId/velocity')
  @ApiOperation({ summary: 'Velocity do projeto por sprint ou periodo' })
  @ApiParam({ name: 'projectId', example: '123' })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month'] })
  @ApiQuery({ name: 'granularity', required: false, enum: ['day', 'week'] })
  @ApiQuery({ name: 'sprintId', required: false, example: '456' })
  @ApiResponse({ status: 200, type: VelocityResponseDto })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  @ApiResponse({ status: 403, description: 'Projeto pertence a outra organizacao' })
  @ApiResponse({ status: 404, description: 'Projeto nao encontrado' })
  async getVelocity(
    @Param('projectId') projectId: string,
    @Query() query: DashboardQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<VelocityResponseDto> {
    this.logger.log(`Dashboard velocity project=${projectId} user=${user.sub}`);
    const orgId = this.orgCacheKey(user);
    const pid = await this.dashboardsService.resolveProjectId(projectId, orgId);
    return this.dashboardsService.getVelocity(orgId, pid, query);
  }

  /**
   * Retorna burndown do projeto.
   *
   * @param projectId - ID do projeto
   * @param query - Filtros do dashboard
   * @param user - Usuario autenticado
   * @returns Serie planned vs actual remaining
   */
  @Get('projects/:projectId/burndown')
  @ApiOperation({ summary: 'Burndown do projeto' })
  @ApiParam({ name: 'projectId', example: '123' })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month'] })
  @ApiQuery({ name: 'sprintId', required: false, example: '456' })
  @ApiResponse({ status: 200, type: BurndownResponseDto })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  @ApiResponse({ status: 403, description: 'Projeto pertence a outra organizacao' })
  @ApiResponse({ status: 404, description: 'Projeto nao encontrado' })
  async getBurndown(
    @Param('projectId') projectId: string,
    @Query() query: DashboardQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<BurndownResponseDto> {
    this.logger.log(`Dashboard burndown project=${projectId} user=${user.sub}`);
    const orgId = this.orgCacheKey(user);
    const pid = await this.dashboardsService.resolveProjectId(projectId, orgId);
    return this.dashboardsService.getBurndown(orgId, pid, query);
  }

  /**
   * Retorna tasks agrupadas por responsavel e status.
   *
   * @param projectId - ID do projeto
   * @param query - Filtros do dashboard
   * @param user - Usuario autenticado
   * @returns Agrupamento por usuario
   */
  @Get('projects/:projectId/tasks-by-user')
  @ApiOperation({ summary: 'Tasks do projeto agrupadas por usuario' })
  @ApiParam({ name: 'projectId', example: '123' })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month'] })
  @ApiQuery({ name: 'sprintId', required: false, example: '456' })
  @ApiResponse({ status: 200, type: TasksByUserResponseDto })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  @ApiResponse({ status: 403, description: 'Projeto pertence a outra organizacao' })
  @ApiResponse({ status: 404, description: 'Projeto nao encontrado' })
  async getTasksByUser(
    @Param('projectId') projectId: string,
    @Query() query: DashboardQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<TasksByUserResponseDto> {
    this.logger.log(`Dashboard tasks-by-user project=${projectId} user=${user.sub}`);
    const orgId = this.orgCacheKey(user);
    const pid = await this.dashboardsService.resolveProjectId(projectId, orgId);
    return this.dashboardsService.getTasksByUser(orgId, pid, query);
  }

  /**
   * Retorna snapshot diario do projeto.
   *
   * @param projectId - ID do projeto
   * @param user - Usuario autenticado
   * @returns Resumo do dia com TTL de 60s
   */
  @Get('projects/:projectId/daily-summary')
  @ApiOperation({ summary: 'Resumo diario do projeto' })
  @ApiParam({ name: 'projectId', example: '123' })
  @ApiResponse({ status: 200, type: DailySummaryResponseDto })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  @ApiResponse({ status: 403, description: 'Projeto pertence a outra organizacao' })
  @ApiResponse({ status: 404, description: 'Projeto nao encontrado' })
  async getDailySummary(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<DailySummaryResponseDto> {
    this.logger.log(`Dashboard daily-summary project=${projectId} user=${user.sub}`);
    const orgId = this.orgCacheKey(user);
    const pid = await this.dashboardsService.resolveProjectId(projectId, orgId);
    return this.dashboardsService.getDailySummary(orgId, pid);
  }

  private orgCacheKey(user: JwtPayload): string {
    return user.organizationId ?? '';
  }
}
