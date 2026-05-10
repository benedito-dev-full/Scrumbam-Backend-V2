import {
  Controller,
  Get,
  Logger,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgTenantGuard } from '../auth/guards/org-tenant.guard';
import { TenantConfig } from '../auth/decorators/tenant-config.decorator';
import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import { ReportQueryDto } from './dto/report-query.dto';

/**
 * Controller de relatórios PDF F9 — read-only.
 *
 * Todos os endpoints são protegidos por JwtAuthGuard + OrgTenantGuard.
 * Retorna PDF binário com headers Content-Type e Content-Disposition.
 *
 * Pilar 1: ZERO Engine/Operacao.
 * Pilar 2: Não duplica CRUD de Project/Task/Sprint/Status/User/Org.
 */
@ApiTags('reports')
@Controller('reports')
@UseGuards(JwtAuthGuard, OrgTenantGuard)
@TenantConfig('PROJECT_ESTAB')
export class ReportsController {
  private readonly logger = new Logger(ReportsController.name);

  constructor(private readonly reportsService: ReportsService) {}

  /**
   * Gera e baixa relatório PDF completo do projeto.
   *
   * Agrega métricas F8, velocity, burndown, tasks por usuário, forecast Monte Carlo
   * e resumo executivo em um único PDF. Usa cache de 5 minutos por (org, project, query).
   *
   * @param projectId - ID do projeto (DProject.chave como string)
   * @param query - Parâmetros de período e seções do relatório
   * @param user - Usuário autenticado via JWT
   * @param res - Response Express para streaming do PDF
   *
   * @throws {NotFoundException} Quando projeto não encontrado (404)
   * @throws {ForbiddenException} Quando projeto pertence a outra organização (403)
   * @throws {UnauthorizedException} Quando token ausente ou inválido (401)
   *
   * @example
   * ```bash
   * curl -X GET "http://localhost:3000/reports/projects/123/pdf?periodDays=30" \
   *   -H "Authorization: Bearer {token}" \
   *   --output "project-123-report.pdf"
   * ```
   */
  @Get('projects/:projectId/pdf')
  @ApiOperation({
    summary: 'Gera relatório PDF do projeto',
    description:
      'Relatório completo com métricas F8, velocity, burndown, forecast Monte Carlo e resumo executivo. ' +
      'Cache de 5 minutos por (org, project, query). Retorna PDF binário.',
  })
  @ApiParam({
    name: 'projectId',
    description: 'ID do projeto (DProject.chave)',
    example: '123',
  })
  @ApiQuery({
    name: 'periodDays',
    required: false,
    description: 'Número de dias retroativos (1–180, default 30)',
    example: 30,
  })
  @ApiQuery({
    name: 'periodFrom',
    required: false,
    description: 'Data inicial do período (YYYY-MM-DD)',
    example: '2026-04-01',
  })
  @ApiQuery({
    name: 'periodTo',
    required: false,
    description: 'Data final do período (YYYY-MM-DD)',
    example: '2026-04-30',
  })
  @ApiQuery({
    name: 'includeTasks',
    required: false,
    description: 'Inclui seção de tasks individuais (default false)',
    example: false,
  })
  @ApiQuery({
    name: 'includeStakeholderSummary',
    required: false,
    description: 'Inclui resumo executivo stakeholder (default true)',
    example: true,
  })
  @ApiResponse({
    status: 200,
    description: 'PDF gerado com sucesso',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Projeto pertence a outra organização' })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  async getProjectPdf(
    @Param('projectId') projectId: string,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(
      `Gerando PDF projeto=${projectId} user=${user.sub} periodDays=${query.periodDays ?? 30}`,
    );

    const orgId = user.organizationId ?? '';
    const buffer = await this.reportsService.generateProjectPdf(projectId, orgId, query);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="project-${projectId}-report.pdf"`,
    );
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(buffer);
  }
}
