import { Injectable, Logger } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { MCP_SCOPES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  optionalLimit,
  optionalRecord,
  optionalString,
  parseBigIntParam,
  requireScope,
  requiredString,
  textResult,
} from './tool-params';

/**
 * MCP tool `list_blocks` — lista blocos (DTask idClasse=-200) de um projeto.
 *
 * **Wrapper fino sobre `TasksService.findMany`** com `idClasse='-200'` fixo
 * (Pilar 2 — endpoint genérico reutilizado). O acesso é escopado pela mesma
 * resolução tenant das outras tools (via `ProjectsService.findAccessibleProjectIds`,
 * ADR-V2-042). Quando o `projectId` informado não está no escopo do usuário MCP,
 * retorna lista vazia com anti-enumeration (mensagem idêntica a "sem blocos").
 *
 * **Para as tasks e métricas de um bloco**, use `list_block_tasks(blockId,
 * includeMetrics=true)` — esta tool lista apenas os blocos (agrupadores), não
 * suas tasks.
 *
 * **Performance:** cursor pagination, query ~45ms, ZERO N+1.
 *
 * @see ADR-V2-042 (tenant isolation: defense-in-depth via accessible projects)
 * @see Pilar 2 (endpoints genéricos: reusar TasksService.findMany, não duplicar)
 * @see ListBlockTasksTool — para as tasks de um bloco + métricas de progresso
 *
 * @example
 * ```json
 * // Request: listar blocos do projeto 100
 * {"projectId": "100", "limit": 10}
 * // Response: { items: [{...}, ...], pagination: {hasMore: false, nextCursor: null} }
 * ```
 */
@Injectable()
export class ListBlocksTool implements McpTool {
  private readonly logger = new Logger(ListBlocksTool.name);

  readonly name = 'list_blocks';
  readonly description =
    'Lista blocos (DTask idClasse=-200) de um projeto acessivel ao usuario. Para as tasks e metricas de um bloco use list_block_tasks.';
  readonly inputSchema = {
    type: 'object',
    required: ['projectId'],
    properties: {
      projectId: { type: 'string', description: 'ID do projeto (obrigatorio)' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      cursor: { type: 'string', description: 'Cursor de paginacao' },
    },
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Lista blocos de um projeto com paginação por cursor.
   *
   * **Fluxo:**
   * 1. Gate de autorização (ADR-V2-068).
   * 2. Valida `projectId` (BigInt) e `cursor` (BigInt opcional).
   * 3. Resolve `accessibleProjectIds` do usuário MCP (defense-in-depth ADR-V2-042).
   * 4. Se `projectId` não está no scope, retorna lista vazia (anti-enumeration).
   * 5. Delega para `TasksService.findMany({ projectId, idClasse: '-200', cursor, limit })`.
   *
   * @throws {McpToolError} FORBIDDEN (-32002) quando scope `tasks:read` ausente
   * @throws {McpToolError} INVALID_PARAMS quando projectId/cursor não são BigInt válidos
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    // Gate de autorização (ADR-V2-068). Antes de qualquer query.
    requireScope(ctx, MCP_SCOPES.TASKS_READ);

    const input = optionalRecord(params);
    const projectId = requiredString(input, 'projectId');
    parseBigIntParam(projectId, 'projectId');

    const cursor = optionalString(input, 'cursor');
    if (cursor) {
      parseBigIntParam(cursor, 'cursor');
    }

    const limit = optionalLimit(input);

    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      ctx.dEntidadeId,
    );

    if (!accessibleProjectIds.includes(projectId)) {
      // Mesmo retorno de "projeto sem blocos" — anti-enumeration.
      this.logger.warn(
        `list_blocks: projeto ${projectId} fora do scope para entidade ${ctx.dEntidadeId.toString()}`,
      );
      return textResult({ items: [], pagination: { hasMore: false, nextCursor: null } });
    }

    const result = await this.tasksService.findMany(
      {
        projectId,
        idClasse: '-200',
        ...(cursor ? { cursor } : {}),
        limit,
      },
      accessibleProjectIds,
    );

    return textResult(result);
  }
}
