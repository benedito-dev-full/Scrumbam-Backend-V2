import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
import { PrismaService } from '../prisma.service';
import { ForecastService } from './forecast.service';
import { ForecastQueryDto } from './dto/forecast-query.dto';
import { ForecastResponseDto } from './dto/forecast-response.dto';

/**
 * Controller de Forecast Monte Carlo do Scrumban-Backend-V2.
 *
 * Expõe 1 endpoint GET read-only para forecast probabilístico de conclusão
 * de projetos via Monte Carlo bootstrap resample (Decisão D3).
 *
 * Protegido por JWT + OrgTenantGuard (estratégia PROJECT_ESTAB).
 *
 * F8 é read-only puro — ZERO Engine/Operacao, ZERO INSERT/UPDATE/DELETE.
 *
 * @see ForecastService — orquestração de throughput histórico + Monte Carlo
 * @see simulate — implementação do Monte Carlo (monte-carlo.engine.ts)
 */
@ApiTags('forecast')
@Controller('forecast')
@UseGuards(JwtAuthGuard, OrgTenantGuard)
@TenantConfig('PROJECT_ESTAB')
export class ForecastController {
  private readonly logger = new Logger(ForecastController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly forecastService: ForecastService,
  ) {}

  /**
   * Retorna o forecast de conclusão do projeto via Monte Carlo.
   *
   * Calcula estimativa probabilística de dias até concluir todas as tasks
   * restantes (não-DONE/VALIDATED), baseada no throughput histórico.
   *
   * Histórico de throughput (Decisão D4):
   * - Fonte primária: últimos N sprints cadastrados (DTabela -400..-419)
   * - Fallback: janela móvel 30 dias agrupada por semana (se < 2 sprints)
   * - Erro: BadRequestException se nenhuma fonte tem ≥ 2 pontos
   *
   * Simulação (Decisão D3): bootstrap resample com 10k iterações.
   *
   * @param projectId - ID do projeto (chave do DProject)
   * @param query - Parâmetros de forecast
   * @param user - Usuário autenticado (extraído do JWT)
   * @returns ForecastResponseDto com p50/p75/p85/p95 em dias
   *
   * @throws {UnauthorizedException} Se token JWT inválido ou ausente
   * @throws {ForbiddenException} Se projeto pertence a outra organização
   * @throws {NotFoundException} Se projeto não encontrado
   * @throws {BadRequestException} Se histórico insuficiente para forecast
   *
   * @example
   * ```bash
   * curl -X GET "http://localhost:3000/forecast/123?historicalSprints=4&iterations=10000" \
   *   -H "Authorization: Bearer {token}"
   * ```
   *
   * @example
   * ```json
   * {
   *   "p50": 14, "p75": 21, "p85": 28, "p95": 42,
   *   "unit": "days", "tasksRemaining": 30,
   *   "iterations": 10000, "source": "sprints", "avgThroughput": 5.2
   * }
   * ```
   */
  @Get(':projectId')
  @ApiOperation({
    summary: 'Forecast Monte Carlo de conclusão do projeto',
    description:
      'Estimativa probabilística de dias até conclusão das tasks restantes via bootstrap resample. ' +
      'Requer ≥ 2 sprints completos ou ≥ 2 semanas com throughput > 0.',
  })
  @ApiParam({ name: 'projectId', description: 'ID do projeto', example: '123' })
  @ApiQuery({
    name: 'historicalSprints',
    required: false,
    description: 'Número de sprints históricos (1-12, default: 4)',
    example: 4,
  })
  @ApiQuery({
    name: 'iterations',
    required: false,
    description: 'Iterações Monte Carlo (100-50000, default: 10000)',
    example: 10000,
  })
  @ApiResponse({ status: 200, type: ForecastResponseDto, description: 'Forecast calculado' })
  @ApiResponse({ status: 400, description: 'Histórico insuficiente para forecast' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Projeto pertence a outra organização' })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  async getForecast(
    @Param('projectId') projectId: string,
    @Query() query: ForecastQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ForecastResponseDto> {
    this.logger.log(`Forecast project=${projectId} user=${user.sub}`);

    const pid = await this.resolveProjectId(projectId, user);
    return this.forecastService.forecast(pid, query);
  }

  /**
   * Valida existência e tenant do projeto.
   *
   * @param projectId - ID do projeto como string
   * @param user - Payload JWT do usuário
   * @returns BigInt do projectId
   * @throws {NotFoundException} Se projeto não encontrado
   * @throws {ForbiddenException} Se org não corresponde
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

    if (user.organizationId && project.idEstab) {
      if (project.idEstab.toString() !== user.organizationId) {
        throw new ForbiddenException('Acesso negado: projeto pertence a outra organização');
      }
    }

    return pid;
  }
}
