import { Injectable, Logger } from '@nestjs/common';

import { ListTasksQueryDto } from '../../tasks/dto/list-tasks-query.dto';
import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { MCP_SCOPES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  invalidParams,
  optionalLimit,
  optionalRecord,
  optionalString,
  parseBigIntParam,
  requireScope,
  textResult,
  V3_STATUS_CODES,
} from './tool-params';

/**
 * MCP tool `list_my_tasks` — visão "meu trabalho" do usuário MCP caller.
 *
 * Lista as tasks atribuídas ao caller (assignee) em TODOS os projetos
 * acessíveis, com filtros opcionais de status (V3) e projeto. Wrapper fino
 * sobre `TasksService.findMany` (Pilar 2 — endpoint genérico reusado).
 *
 * **Anti-fraude (decisão de design):** o `assigneeId` é SEMPRE derivado de
 * `ctx.dEntidadeId` — NUNCA aceito do input. O schema não expõe `assigneeId`
 * e o handler ignora qualquer valor que venha em `arguments`. Espelha o padrão
 * de `update_timer` (captura o userId do contexto, não do payload).
 *
 * **Fluxo (defense-in-depth — ADR-V2-042):**
 * 1. `requireScope(ctx, tasks:read)`.
 * 2. Valida params opcionais (status ∈ V3, projectId/cursor BigInt, limit 1-50).
 * 3. Resolve o scope de projetos:
 *    - `projectId` informado → `projectsService.findOne(projectId, dEntidadeId)`
 *      (404 idêntico se fora do escopo) → `scopedProjectIds = [projectId]`.
 *    - sem `projectId` → `projectsService.findAccessibleProjectIds(dEntidadeId)`.
 * 4. Scope vazio → lista vazia (listagem NÃO retorna 404 — ADR-V2-042).
 * 5. Delega a `TasksService.findMany` com `assigneeId = ctx.dEntidadeId`.
 *
 * **Performance:** 1-2 queries (findOne opcional + findMany), ZERO N+1
 * (filtro `idAssignee` combinado com AND sobre `idProject IN scope`).
 *
 * NÃO usa Engine: leitura pura em tabela estrutural (DTask). Pilar 1 (Engine)
 * só aplica em DPedido idClasse=-300 (executions transacionais).
 *
 * @see ADR-V2-042 (tenant isolation: findOne gate + anti-enumeration)
 * @see ADR-V2-068 (scope catalog — tasks:read)
 * @see Pilar 2 (reusar TasksService.findMany, não duplicar)
 */
@Injectable()
export class ListMyTasksTool implements McpTool {
  private readonly logger = new Logger(ListMyTasksTool.name);

  readonly name = 'list_my_tasks';
  readonly description =
    'Lista as tasks atribuidas ao usuario MCP caller (visao "meu trabalho"), em todos os projetos acessiveis, com filtros opcionais de status/projeto. Retorna { items, pagination }. O assignee e SEMPRE o caller.';
  readonly inputSchema = {
    type: 'object',
    required: [] as string[],
    properties: {
      status: {
        type: 'string',
        enum: [...V3_STATUS_CODES],
        description: 'Filtra por status V3 (opcional).',
      },
      projectId: {
        type: 'string',
        description: 'Restringe a um projeto acessivel (opcional).',
      },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      cursor: { type: 'string', description: 'Cursor de paginacao (chave da ultima task).' },
    },
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Lista as tasks atribuídas ao caller, com filtros opcionais e paginação.
   *
   * @param params - `{ status?: string, projectId?: string, limit?: number, cursor?: string }`
   * @param ctx - Contexto do usuário MCP (resolve assignee/tenant via `dEntidadeId`)
   * @returns `McpToolResult` com `{ items, pagination }` serializado.
   *
   * @throws {McpToolError} FORBIDDEN (-32002) quando scope `tasks:read` ausente
   * @throws {McpToolError} INVALID_PARAMS quando status/projectId/cursor/limit inválidos.
   * @throws {NotFoundException} Quando `projectId` informado não é acessível.
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    // Gate de autorização (ADR-V2-068). Antes de qualquer query.
    requireScope(ctx, MCP_SCOPES.TASKS_READ);

    const input = optionalRecord(params);

    const status = optionalString(input, 'status');
    if (status !== undefined && !V3_STATUS_CODES.includes(status as never)) {
      throw invalidParams('status', 'invalid V3 status code');
    }

    const projectId = optionalString(input, 'projectId');
    if (projectId) {
      parseBigIntParam(projectId, 'projectId');
    }

    const cursor = optionalString(input, 'cursor');
    if (cursor) {
      parseBigIntParam(cursor, 'cursor');
    }

    const limit = optionalLimit(input);

    // Resolve o escopo de projetos do caller (ADR-V2-042).
    let scopedProjectIds: string[];
    if (projectId) {
      // findOne lanca NotFoundException (mensagem anti-enumeration) se o
      // projectId estiver fora do escopo do usuario.
      await this.projectsService.findOne(projectId, ctx.dEntidadeId);
      scopedProjectIds = [projectId];
    } else {
      scopedProjectIds = await this.projectsService.findAccessibleProjectIds(ctx.dEntidadeId);
    }

    if (scopedProjectIds.length === 0) {
      // Listagem → lista vazia, NUNCA 404 (ADR-V2-042).
      return textResult({ items: [], pagination: { hasMore: false, nextCursor: null } });
    }

    const assigneeId = ctx.dEntidadeId.toString();

    this.logger.debug(
      `list_my_tasks assignee=${assigneeId} projectId=${projectId ?? 'all'} status=${status ?? 'any'} limit=${limit}`,
    );

    const query: ListTasksQueryDto = {
      assigneeId, // SEMPRE do contexto MCP, nunca do input (anti-fraude)
      ...(projectId ? { projectId } : { projectIds: scopedProjectIds }),
      ...(status ? { status } : {}),
      ...(cursor ? { cursor } : {}),
      limit,
    };

    const result = await this.tasksService.findMany(query, scopedProjectIds);

    return textResult(result);
  }
}
