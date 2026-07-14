import { ConflictException, Injectable } from '@nestjs/common';

import { ProjectsService } from '../../../../projects/projects.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/**
 * Acoes de timer aceitas. `stop` e semanticamente identico a `pause` na
 * persistencia (grava endedAt + durationMs server-side); alias explicito.
 */
const VALID_TIMER_ACTIONS = ['start', 'pause', 'resume', 'stop'] as const;
type TimerAction = (typeof VALID_TIMER_ACTIONS)[number];

/**
 * `UpdateTimerCapability` — capability neutra `update_timer` (Onda 4).
 *
 * Casca FINA sobre `TasksService.timer` (que delega a `TaskTimerService`,
 * ADR-V2-057). Controla o timer manual de tempo de uma task
 * (start/pause/resume/stop). MESMA sequencia do wrapper legado
 * (`src/mcp/tools/update-timer.tool.ts`):
 *  1. `TasksService.findOne(taskId)` — existencia + tenant.
 *  2. `ProjectsService.findOne(task.projectId, actorEntidadeId)` — membership.
 *  3. `TasksService.timer(taskId, action, actorId, undefined)` — gate por
 *     projeto ja validado no passo 2 (paridade byte a byte).
 *
 * **Anti-fraude (ADR-V2-057):** `actorId = principal.actorEntidadeId` (SEMPRE
 * do auth, nunca de input); `endedAt`/`durationMs` sao server-side.
 *
 * **Mapeamento de erro:** `ConflictException` (409 — "1 timer por task" ou
 * "sessao nao encontrada") vira `CapabilityError('INVALID_INPUT', 'Timer
 * conflict', { reason: 'timer_conflict', detail })`. O `McpCapabilityAdapter`
 * traduz INVALID_INPUT -> INVALID_PARAMS (-32602), preservando o wire da tool
 * legada (`reason: 'timer_conflict'`). No Nexus vira `Error` humanizado.
 *
 * `requiredScopes: ['tasks:write']` — espelha `requireScope(ctx,
 * MCP_SCOPES.TASKS_WRITE)`. No Nexus, `principal.can('tasks:write')` (RBAC:
 * MEMBER/MANAGER/ADMIN).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 4 (tasks-write)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-057 (timer manual + anti-fraude)
 */
@Injectable()
export class UpdateTimerCapability implements Capability {
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
  readonly requiredScopes = ['tasks:write'] as const;

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Aciona a acao de timer. Valida `taskId` (BigInt) e `action` (enum),
   * confirma tenant + membership e delega ao service.
   *
   * @param input - `{ taskId: string, action: 'start'|'pause'|'resume'|'stop' }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com `{ taskId, action, timer }`.
   * @throws {CapabilityError} `INVALID_INPUT` quando taskId/action invalidos ou
   *   `reason: 'timer_conflict'` quando o service lanca `ConflictException`.
   * @throws {import('@nestjs/common').NotFoundException} Task/projeto fora do scope.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const taskId = this.requiredString(input, 'taskId');
    this.assertBigIntParseable(taskId, 'taskId');

    const actionRaw = this.requiredString(input, 'action');
    if (!VALID_TIMER_ACTIONS.includes(actionRaw as TimerAction)) {
      throw new CapabilityError(
        'INVALID_INPUT',
        `action: must be one of: ${VALID_TIMER_ACTIONS.join(', ')}`,
        { field: 'action' },
      );
    }
    const action = actionRaw as TimerAction;

    const task = await this.tasksService.findOne(taskId);
    await this.projectsService.findOne(task.projectId, principal.actorEntidadeId);

    try {
      const updated = await this.tasksService.timer(
        taskId,
        action,
        principal.actorEntidadeId,
        undefined, // gate por projeto ja validado acima via projectsService.findOne
      );

      return { data: { taskId, action, timer: updated.timer } };
    } catch (err) {
      if (err instanceof ConflictException) {
        const detail = typeof err.message === 'string' ? err.message : 'Timer conflict';
        throw new CapabilityError('INVALID_INPUT', 'Timer conflict', {
          reason: 'timer_conflict',
          detail,
        });
      }
      throw err;
    }
  }

  private requiredString(input: Record<string, unknown>, field: string): string {
    const value = input[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', `${field}: required string`, { field });
    }
    return value;
  }

  private assertBigIntParseable(value: string, field: string): void {
    try {
      BigInt(value);
    } catch {
      throw new CapabilityError('INVALID_INPUT', `${field}: valid bigint string expected`, {
        field,
      });
    }
  }
}
