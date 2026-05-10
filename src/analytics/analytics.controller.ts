import {
  BadRequestException,
  Controller,
  ForbiddenException,
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
import { DashboardsService } from '../dashboards/dashboards.service';
import { AnalyticsService } from './analytics.service';
import { CompareQueryDto } from './dto/compare-query.dto';
import { CompareResponseDto } from './dto/compare-response.dto';
import { CapacityForecastQueryDto } from './dto/capacity-forecast-query.dto';
import { CapacityForecastResponseDto } from './dto/capacity-forecast-response.dto';
import { StakeholderReportQueryDto } from './dto/stakeholder-report-query.dto';
import { StakeholderReportResponseDto } from './dto/stakeholder-report-response.dto';

/**
 * Controller read-only de analytics F9 Bloco W.
 *
 * Endpoints expostos sao agregacoes analiticas e nao duplicam CRUD de
 * Project/Task/Sprint/Status/User/Org.
 */
@ApiTags('analytics')
@Controller('analytics')
@UseGuards(JwtAuthGuard, OrgTenantGuard)
@TenantConfig('PROJECT_ESTAB')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly dashboardsService: DashboardsService,
  ) {}

  /**
   * Compara metricas de fluxo de um projeto entre dois periodos.
   *
   * @param projectId - ID do projeto
   * @param query - Periodos A/B
   * @param user - Usuario autenticado
   * @returns Comparativo com deltas percentuais seguros
   */
  @Get('projects/:projectId/compare')
  @ApiOperation({ summary: 'Compara metricas de fluxo entre dois periodos' })
  @ApiParam({ name: 'projectId', example: '123' })
  @ApiQuery({ name: 'periodAFrom', example: '2026-04-01' })
  @ApiQuery({ name: 'periodATo', example: '2026-04-30' })
  @ApiQuery({ name: 'periodBFrom', example: '2026-05-01' })
  @ApiQuery({ name: 'periodBTo', example: '2026-05-10' })
  @ApiResponse({ status: 200, type: CompareResponseDto })
  @ApiResponse({ status: 403, description: 'Projeto pertence a outra organizacao' })
  @ApiResponse({ status: 404, description: 'Projeto nao encontrado' })
  async compare(
    @Param('projectId') projectId: string,
    @Query() query: CompareQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<CompareResponseDto> {
    this.logger.log(`Analytics compare project=${projectId} user=${user.sub}`);
    const orgId = this.requireOrgId(user);
    const pid = await this.dashboardsService.resolveProjectId(projectId, orgId);
    return this.analyticsService.compareProject(orgId, pid, query);
  }

  /**
   * Calcula forecast de capacidade agregado por organizacao.
   *
   * @param orgId - ID da organizacao no path
   * @param query - Parametros de forecast
   * @param user - Usuario autenticado
   * @returns Forecast por projeto com totais aproximados
   */
  @Get('orgs/:orgId/capacity-forecast')
  @TenantConfig('PATH_PARAM')
  @ApiOperation({ summary: 'Forecast de capacidade por organizacao' })
  @ApiParam({ name: 'orgId', example: '10' })
  @ApiResponse({ status: 200, type: CapacityForecastResponseDto })
  @ApiResponse({ status: 403, description: 'Organizacao do path diverge do token' })
  async capacityForecast(
    @Param('orgId') orgId: string,
    @Query() query: CapacityForecastQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<CapacityForecastResponseDto> {
    this.logger.log(`Analytics capacity-forecast org=${orgId} user=${user.sub}`);
    this.assertSameOrg(orgId, user);
    return this.analyticsService.capacityForecast(this.parseBigInt(orgId, 'orgId'), query);
  }

  /**
   * Gera relatorio deterministico para stakeholders.
   *
   * @param projectId - ID do projeto
   * @param query - Periodo do relatorio
   * @param user - Usuario autenticado
   * @returns Relatorio narrativo sem LLM e sem persistencia
   */
  @Get('projects/:projectId/stakeholder-report')
  @ApiOperation({ summary: 'Relatorio deterministico para stakeholders' })
  @ApiParam({ name: 'projectId', example: '123' })
  @ApiResponse({ status: 200, type: StakeholderReportResponseDto })
  @ApiResponse({ status: 403, description: 'Projeto pertence a outra organizacao' })
  @ApiResponse({ status: 404, description: 'Projeto nao encontrado' })
  async stakeholderReport(
    @Param('projectId') projectId: string,
    @Query() query: StakeholderReportQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<StakeholderReportResponseDto> {
    this.logger.log(`Analytics stakeholder-report project=${projectId} user=${user.sub}`);
    const orgId = this.requireOrgId(user);
    const pid = await this.dashboardsService.resolveProjectId(projectId, orgId);
    return this.analyticsService.stakeholderReport(orgId, pid, query);
  }

  private requireOrgId(user: JwtPayload): string {
    if (!user.organizationId) {
      throw new ForbiddenException('Acesso negado: organizacao ausente no token');
    }
    return user.organizationId;
  }

  private assertSameOrg(orgId: string, user: JwtPayload): void {
    const tokenOrgId = this.requireOrgId(user);
    if (orgId !== tokenOrgId) {
      throw new ForbiddenException('Acesso negado: organizacao do path diverge do token');
    }
  }

  private parseBigInt(value: string, fieldName: string): bigint {
    try {
      return BigInt(value);
    } catch {
      throw new BadRequestException(`${fieldName} deve ser um BigInt valido`);
    }
  }
}
