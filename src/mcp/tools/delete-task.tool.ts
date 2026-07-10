import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { MCP_SCOPES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { assertTaskNotLockedByOther } from './task-concurrency.guard';
import { McpTool, McpToolResult } from './tool.interface';
import {
  assertRecord,
  invalidParams,
  parseBigIntParam,
  requireScope,
  requiredString,
  textResult,
} from './tool-params';

/**
 * Tool MCP `delete_task` — wrapper fino sobre `TasksService.delete`.
 *
 * Permite que clientes MCP removam (soft-delete) uma task sem passar pelo
 * HTTP REST (DELETE /tasks/:id). O delete e SOFT (marca `excluido=true`),
 * cascateando por padrao para todas as subtarefas (filhas, netos, ...) —
 * fechando o bug de "orfas vivas" (ADR-V2-047 Q6 / CEO 2026-05-30). Use
 * `cascade=false` para apenas desvincular (descendentes permanecem vivos).
 *
 * **Escopo necessario (ADR-V2-067, ADR-V2-068):** `tasks:write` — mesma
 * permissao exigida por `create_task`, `update_task`, `update_status` e
 * `update_timer`. Uma API key com apenas `tasks:read` NAO pode deletar.
 *
 * **Tenant isolation (ADR-V2-042):** o acesso e validado em duas etapas
 * (espelhando `update_status` / `update_timer`):
 *  1. `tasksService.findOne(taskId)` — existencia + tenant da task.
 *  2. `projectsService.findOne(task.projectId, ctx.dEntidadeId)` — membership
 *     no projeto (trata workspace publico ADR-V2-051 §8, privado via DVincula
 *     -170..-173 e ORG_ADMIN → MANAGER herdado).
 *
 * Como o acesso ao projeto ja foi validado acima, `accessibleProjectIds` e
 * passado como `[task.projectId]` — o gate redundante de `TasksService.delete`
 * recebe exatamente o projeto autorizado (nunca `undefined`, evitando alargar
 * o escopo para "qualquer projeto"). `actorId = ctx.dEntidadeId` (preenchido
 * pelo `McpKeyGuard` via DTabela -472) — origem do audit `task.deleted`/
 * `phase.deleted` (DEvento -498, emitido pelo service APOS persistir).
 *
 * @example
 * ```jsonrpc
 * // Request — deletar task 402 cascateando (default)
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "method": "tools/call",
 *   "params": {
 *     "name": "delete_task",
 *     "arguments": { "taskId": "402" }
 *   }
 * }
 * ```
 *
 * @example
 * ```jsonrpc
 * // Response (envelope textResult — payload JSON-stringified)
 * {
 *   "content": [{
 *     "type": "text",
 *     "text": "{\"deleted\":true,\"taskId\":\"402\",\"cascade\":true,\"affected\":3}"
 *   }]
 * }
 * ```
 *
 * @see ADR-V2-047 (Q6 — cascade default no delete de tasks/fases)
 * @see ADR-V2-067 (scope MCP `tasks:write`)
 * @see ADR-V2-068 (scope catalog completo)
 * @see ADR-V2-042 (tenant isolation MCP)
 */
@Injectable()
export class DeleteTaskTool implements McpTool {
  readonly name = 'delete_task';
  readonly description = 'Deleta (soft-delete) uma task; cascateia para subtarefas por padrao.';
  readonly inputSchema = {
    type: 'object',
    required: ['taskId'],
    properties: {
      taskId: { type: 'string' },
      cascade: {
        type: 'boolean',
        description:
          'Cascateia soft-delete para subtarefas (default true). false = desvincular filhas.',
      },
    },
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Handler do `tools/call` para `delete_task`. Wrapper fino sobre
   * `TasksService.delete` — ZERO Prisma direto, ZERO logica de negocio.
   *
   * Fluxo:
   * 1. `requireScope(ctx, MCP_SCOPES.TASKS_WRITE)` — sem o scope → FORBIDDEN
   *    (-32002), antes de qualquer query.
   * 2. Valida `taskId` (string BigInt-parseavel) e `cascade` (boolean opcional;
   *    ausente → undefined, deixando o default do service prevalecer).
   * 3. Valida acesso: `tasksService.findOne(taskId)` (tenant) +
   *    `projectsService.findOne(task.projectId, ctx.dEntidadeId)` (membership).
   * 4. Delega a `tasksService.delete(taskId, [task.projectId], { cascade }, actorId)`.
   * 5. Retorna envelope `textResult` com `{ deleted, taskId, cascade, affected }`.
   *
   * @param params - Argumentos da chamada (ver `inputSchema`)
   * @param ctx - Contexto MCP autenticado (dEntidadeId + scopes)
   * @returns Envelope MCP `textResult` com `{ deleted: true, taskId, cascade, affected }`
   *
   * @throws {McpToolError} FORBIDDEN (-32002) quando scope `tasks:write` ausente
   * @throws {McpToolError} INVALID_PARAMS (-32602) quando `taskId` nao e BigInt
   *   ou `cascade` esta presente e nao e boolean
   * @throws {NotFoundException} Propagado quando task inexistente ou fora do tenant
   * @throws {ForbiddenException} Propagado quando sem membership no projeto
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    // 1. Gate de autorizacao (ADR-V2-067, ADR-V2-068). Antes de qualquer query.
    requireScope(ctx, MCP_SCOPES.TASKS_WRITE);

    // 2. Validacao de input.
    const input = assertRecord(params);
    const taskId = requiredString(input, 'taskId');
    parseBigIntParam(taskId, 'taskId'); // valida parseabilidade; service usa a string

    // cascade: boolean opcional. Ausente → undefined (mantem default do service).
    const cascadeRaw = input.cascade;
    let cascade: boolean | undefined;
    if (cascadeRaw === undefined || cascadeRaw === null) {
      cascade = undefined;
    } else if (typeof cascadeRaw !== 'boolean') {
      throw invalidParams('cascade', 'boolean expected');
    } else {
      cascade = cascadeRaw;
    }

    // 3. Tenant isolation + membership (paridade com update_status / update_timer).
    const task = await this.tasksService.findOne(taskId);
    await this.projectsService.findOne(task.projectId, ctx.dEntidadeId);

    // 3.1. Trava de concorrência MCP (task #794): recusa deletar se a task está
    // EXECUTING com workSession aberta de OUTRO ator.
    assertTaskNotLockedByOther(task, ctx.dEntidadeId);

    // 4. Delega ao service. accessibleProjectIds = [task.projectId] (gate ja
    //    validado acima — nao alargar para qualquer projeto). actorId = caller.
    const result = await this.tasksService.delete(
      taskId,
      [task.projectId],
      { cascade },
      ctx.dEntidadeId,
    );

    // 5. cascade efetivo: undefined no input → default do service (true).
    const effectiveCascade = cascade ?? true;

    return textResult({
      deleted: true,
      taskId,
      cascade: effectiveCascade,
      affected: result.affected,
    });
  }
}
