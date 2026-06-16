import { ConflictException, Injectable } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { MCP_ERROR_CODES, MCP_SCOPES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolError, McpToolResult } from './tool.interface';
import {
  assertRecord,
  parseBigIntParam,
  requireScope,
  requiredString,
  textResult,
} from './tool-params';

/**
 * Ações de timer aceitas por esta tool.
 * `stop` (encerrar trabalho) é semanticamente idêntico a `pause` na
 * persistência (grava endedAt + durationMs server-side); mantido como alias
 * explícito para clareza de UI.
 */
const VALID_TIMER_ACTIONS = ['start', 'pause', 'resume', 'stop'] as const;
type TimerAction = (typeof VALID_TIMER_ACTIONS)[number];

/**
 * Tool MCP `update_timer` — wrapper fino sobre `TasksService.timer`,
 * que por sua vez delega a `TaskTimerService` (ADR-V2-057).
 *
 * Permite que clientes MCP controlem o timer manual de tempo de uma task
 * sem passar pelo HTTP REST (POST /tasks/:id/timer/start|pause|resume|stop).
 *
 * **Escopo necessário (ADR-V2-067, ADR-V2-068):** `tasks:write` — mesma
 * permissão exigida por `create_task` e `update_task`. Uma API key com apenas
 * `tasks:read` NÃO pode acionar o timer.
 *
 * **Tenant isolation (ADR-V2-042):** O `TaskTimerService.start/close` recebe
 * `accessibleProjectIds = undefined` neste wrapper. Isso é intencional e
 * seguro: o service aplica o gate via `loadTask`, que aceita `undefined` como
 * "sem restrição de scope". O contexto MCP já foi autenticado pelo
 * `McpKeyGuard` (DTabela -472); a DEntidade do caller (`ctx.dEntidadeId`)
 * é passada como `actorId` — o mesmo que o controller HTTP faz com
 * `BigInt(req.user.entidadeId)`. Contexto MCP não tem `resolveScopedProjectIds`
 * (helper do controller HTTP que expande DVincula -170..-173 por usuário),
 * portanto o gate de tenant é "autenticado = pode ver tudo" — equivalente ao
 * comportamento de service accounts.
 *
 * **Anti-fraude (ADR-V2-057):** `userId`/`actorId` vem de `ctx.dEntidadeId`
 * (preenchido pelo `McpKeyGuard`), nunca de `params`. `endedAt` e `durationMs`
 * são calculados server-side no `TaskTimerService` — o cliente nunca envia
 * duração.
 *
 * **Ações suportadas:**
 * - `start` / `resume` — abre uma sessão de timer. 409 se já há sessão aberta.
 * - `pause` / `stop`  — fecha a sessão aberta do `actorId`. 409 se não há
 *   sessão aberta para este usuário.
 *
 * Mapeamento de erros:
 * - `ConflictException` (409 HTTP) → INVALID_PARAMS (-32602) com
 *   `reason: 'timer_conflict'` para que o cliente MCP não interprete como
 *   bug do servidor.
 * - `NotFoundException` (404) → propagado (task inexistente ou fora de scope).
 *
 * @example
 * ```jsonrpc
 * // Request — iniciar timer em task 402
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "method": "tools/call",
 *   "params": {
 *     "name": "update_timer",
 *     "arguments": { "taskId": "402", "action": "start" }
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
 *     "text": "{\"taskId\":\"402\",\"action\":\"start\",\"timer\":{\"running\":true,\"runningUserId\":\"7\",\"runningStartedAt\":\"2026-06-15T14:30:00.000Z\",\"totalsByUser\":[]}}"
 *   }]
 * }
 * ```
 *
 * @example
 * ```jsonrpc
 * // Erro 409 mapeado para INVALID_PARAMS
 * {
 *   "jsonrpc": "2.0",
 *   "id": 2,
 *   "error": {
 *     "code": -32602,
 *     "message": "Timer conflict",
 *     "data": { "reason": "timer_conflict", "detail": "Já existe um timer em andamento nesta task" }
 *   }
 * }
 * ```
 *
 * @see ADR-V2-057 (timer manual — start/pause/resume/stop + anti-fraude)
 * @see ADR-V2-067 (scope MCP `tasks:write`)
 * @see ADR-V2-068 (scope catalog completo)
 * @see ADR-V2-042 (tenant isolation MCP)
 */
@Injectable()
export class UpdateTimerTool implements McpTool {
  readonly name = 'update_timer';
  readonly description =
    'Controla o timer manual de tempo de uma task (start/pause/resume/stop). ' +
    'actorId = caller MCP (anti-fraude — nunca do body). ' +
    '409 mapeado para INVALID_PARAMS reason=timer_conflict: start/resume → 409 se já há timer aberto; ' +
    'pause/stop → 409 se não há sessão aberta do caller. ' +
    'Requer scope MCP "tasks:write".';
  readonly inputSchema = {
    type: 'object',
    required: ['taskId', 'action'],
    properties: {
      taskId: {
        type: 'string',
        description: 'ID da DTask a controlar (chave BigInt-parseável)',
      },
      action: {
        type: 'string',
        enum: ['start', 'pause', 'resume', 'stop'],
        description:
          'start/resume: abre sessão de timer. pause/stop: fecha sessão aberta do caller.',
      },
    },
    additionalProperties: false,
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Handler do `tools/call` para `update_timer`. Wrapper fino sobre
   * `TasksService.timer` — ZERO Prisma direto, ZERO lógica de negócio de timer.
   *
   * Fluxo:
   * 1. `requireScope(ctx, MCP_SCOPES.TASKS_WRITE)` — sem o scope → FORBIDDEN
   *    (-32002). Escopo harmonizado com o catalog global (ADR-V2-068).
   * 2. Extrai e valida `taskId` (string BigInt-parseável) e `action` (enum).
   * 3. Delega a `tasksService.timer(id, action, actorId, undefined)`:
   *    - `actorId = ctx.dEntidadeId` (bigint — mesma origem do JWT no controller HTTP).
   *    - `accessibleProjectIds = undefined` — comportamento de service account
   *      (autenticado via MCP key = acesso total ao scope da key).
   * 4. Retorna envelope `textResult` com `{ taskId, action, timer }`.
   *    O bloco `timer` é `TaskTimerStateDto | null` — exposto enxuto.
   *
   * @param params - Argumentos da chamada (ver `inputSchema`)
   * @param ctx - Contexto MCP autenticado (dEntidadeId + scopes)
   * @returns Envelope MCP `textResult` com `{ taskId, action, timer }`
   *
   * @throws {McpToolError} FORBIDDEN (-32002) quando scope `tasks:write` ausente
   * @throws {McpToolError} INVALID_PARAMS (-32602) quando `taskId` não é BigInt
   *   ou `action` não é um dos quatro valores válidos
   * @throws {McpToolError} INVALID_PARAMS com `reason='timer_conflict'` quando
   *   `TaskTimerService` lança `ConflictException` (409)
   * @throws {NotFoundException} Propagado quando task inexistente
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = assertRecord(params);

    // 1. Gate de autorização (ADR-V2-067, ADR-V2-068). Antes de qualquer query.
    requireScope(ctx, MCP_SCOPES.TASKS_WRITE);

    // 2. Validação de input.
    const taskIdStr = requiredString(input, 'taskId');
    parseBigIntParam(taskIdStr, 'taskId'); // valida parseabilidade; descarta valor (service usa string)

    const actionRaw = requiredString(input, 'action');
    if (!VALID_TIMER_ACTIONS.includes(actionRaw as TimerAction)) {
      throw new McpToolError(MCP_ERROR_CODES.INVALID_PARAMS, 'Invalid params', {
        field: 'action',
        issue: `must be one of: ${VALID_TIMER_ACTIONS.join(', ')}`,
      });
    }
    const action = actionRaw as TimerAction;

    // 3. Tenant isolation + membership (paridade com execute_task / ADR-V2-042).
    // tasksService.findOne valida tenant + existência da task. Em seguida,
    // projectsService.findOne(projectId, dEntidadeId) valida acesso ao projeto:
    // já trata workspace público (ADR-V2-051 §8 — `hasPublicSpaceAccess`),
    // workspace privado (DVincula -170..-173), e ORG_ADMIN → MANAGER herdado.
    const task = await this.tasksService.findOne(taskIdStr);
    await this.projectsService.findOne(task.projectId, ctx.dEntidadeId);

    // 4. Delega ao service. actorId = ctx.dEntidadeId (bigint, preenchido pelo
    // McpKeyGuard via DTabela -472). accessibleProjectIds = undefined → o gate
    // por projeto já foi feito acima via projectsService.findOne.
    try {
      const updated = await this.tasksService.timer(
        taskIdStr,
        action,
        ctx.dEntidadeId,
        undefined, // gate por projeto já validado acima via projectsService.findOne
      );

      return textResult({
        taskId: taskIdStr,
        action,
        timer: updated.timer,
      });
    } catch (err) {
      // ConflictException (409): regra "1 timer por task" (start/resume) ou
      // "sessão não encontrada" (pause/stop). Mapeado para INVALID_PARAMS com
      // reason discriminante para que o cliente não interprete como bug.
      if (err instanceof ConflictException) {
        const detail = typeof err.message === 'string' ? err.message : 'Timer conflict';
        throw new McpToolError(MCP_ERROR_CODES.INVALID_PARAMS, 'Timer conflict', {
          reason: 'timer_conflict',
          detail,
        });
      }
      throw err;
    }
  }
}
