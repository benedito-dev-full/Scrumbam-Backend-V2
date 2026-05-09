import { Controller, Logger, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WorkflowStatusesService } from './workflow-statuses.service';
import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';

/**
 * Controller de Workflow Statuses (wrapper thin — Pilar 2, ADR-V2-009).
 *
 * Expõe APENAS o endpoint de inicialização de statuses padrão.
 * GET/PATCH/DELETE → usar /tabelas?idClasse=-440&dEntidadeId={projectId}
 *
 * @see WorkflowStatusesService — lógica de seedDefaults
 * @see README.md — documentação completa dos endpoints
 */
@ApiTags('workflow-statuses')
@Controller('workflow-statuses')
@UseGuards(AuthCompositeGuard)
export class WorkflowStatusesController {
  private readonly logger = new Logger(WorkflowStatusesController.name);

  constructor(private readonly workflowStatusesService: WorkflowStatusesService) {}

  /**
   * Cria os 9 statuses V3 padrão para o projeto se ainda não existirem.
   *
   * Operação idempotente — se os statuses já existem, retorna contagem 0.
   * Usado internamente pelo ProjectsService ao criar um novo projeto.
   *
   * @param projectId - ID do projeto (DEntidade chave como string)
   * @returns Contagem de statuses criados (0 se idempotente)
   *
   * @throws {UnauthorizedException} Se não autenticado
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/api/v1/workflow-statuses/seed-defaults/100 \
   *   -H "Authorization: Bearer {token}"
   * ```
   *
   * @example
   * ```json
   * // Response esperado
   * { "created": 9, "projectId": "100" }
   * ```
   */
  @Post('seed-defaults/:projectId')
  @ApiOperation({
    summary: 'Inicializar statuses V3 padrão para um projeto',
    description: 'Cria 9 DTabela idClasse=-441..-449 vinculadas ao projeto. Idempotente.',
  })
  @ApiParam({ name: 'projectId', description: 'ID do projeto (chave DEntidade)' })
  @ApiResponse({ status: 201, description: 'Statuses criados ou já existentes' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  async seedDefaults(
    @Param('projectId') projectId: string,
  ): Promise<{ created: number; projectId: string }> {
    this.logger.log(`POST /workflow-statuses/seed-defaults/${projectId}`);
    const created = await this.workflowStatusesService.seedDefaults(BigInt(projectId));
    return { created, projectId };
  }
}
