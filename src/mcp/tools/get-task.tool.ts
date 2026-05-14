import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import { assertRecord, parseBigIntParam, requiredString, textResult } from './tool-params';

/**
 * Tool MCP `get_task` — busca uma task por ID, escopada aos projetos
 * acessiveis ao usuario autenticado via MCP key.
 *
 * Tenant isolation (ADR-V2-042):
 * 1. Resolve `accessibleProjectIds` via `ProjectsService.findAccessibleProjectIds`.
 * 2. Delega para `TasksService.findOne(taskId, accessibleProjectIds)`, que
 *    valida que `DTask.idProject` esta no scope autorizado. Caso contrario,
 *    retorna `NotFoundException` com mesma mensagem de "task nao encontrada"
 *    (anti enumeration attack).
 *
 * NAO usa Engine: leitura simples em tabela estrutural (DTask). Pilar 1
 * (Engine) so aplica em DPedido idClasse=-300 (transacional).
 *
 * @example
 * ```json
 * // Request JSON-RPC
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "method": "tools/call",
 *   "params": {
 *     "name": "get_task",
 *     "arguments": { "taskId": "123" }
 *   }
 * }
 * ```
 */
@Injectable()
export class GetTaskTool implements McpTool {
  readonly name = 'get_task';
  readonly description = 'Busca uma task por ID, escopada aos projetos acessiveis ao usuario MCP.';
  readonly inputSchema = {
    type: 'object',
    required: ['taskId'],
    properties: {
      taskId: { type: 'string' },
    },
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Handler do tools/call para `get_task`.
   *
   * Fluxo:
   * 1. Valida params (object + `taskId` string nao vazia + BigInt parseable).
   * 2. Resolve projetos acessiveis ao caller (ADR-V2-042 — defense in depth).
   * 3. Invoca `TasksService.findOne(taskId, accessibleProjectIds)`. Service
   *    lanca `NotFoundException` se task nao existir OU estiver fora do scope.
   * 4. Embrulha resposta em `textResult` (envelope MCP padrao).
   *
   * Excecoes nao tratadas (`NotFoundException`, etc.) propagam para o
   * `McpRouterService.dispatchTool`, que traduz para JSON-RPC error quando
   * apropriado.
   *
   * @param params - Argumentos da chamada (`{ taskId: string }`)
   * @param ctx - Contexto MCP autenticado (contem `dEntidadeId`)
   * @returns Envelope MCP com JSON serializado da task
   * @throws {McpToolError} INVALID_PARAMS quando taskId ausente/invalid
   * @throws {NotFoundException} Quando task fora do scope ou inexistente
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = assertRecord(params);
    const taskId = requiredString(input, 'taskId');
    parseBigIntParam(taskId, 'taskId');

    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      ctx.dEntidadeId,
    );

    const result = await this.tasksService.findOne(taskId, accessibleProjectIds);

    return textResult(result);
  }
}
