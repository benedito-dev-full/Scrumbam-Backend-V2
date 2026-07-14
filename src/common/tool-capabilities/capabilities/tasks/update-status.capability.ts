import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../../../projects/projects.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/** V3 status codes — espelha `V3_STATUS_CODES` de `mcp/tools/tool-params`. */
const V3_STATUS_CODES = [
  'INBOX',
  'READY',
  'EXECUTING',
  'DONE',
  'FAILED',
  'CANCELLED',
  'DISCARDED',
  'VALIDATING',
  'VALIDATED',
] as const;

/**
 * `UpdateStatusCapability` — capability neutra `update_status` (Onda 4).
 *
 * Casca FINA sobre `TasksService.updateStatus` — atualiza APENAS o status V3
 * de uma task (state machine + telemetria). MESMA sequencia do wrapper legado
 * (`src/mcp/tools/update-status.tool.ts`):
 *  1. `TasksService.findOne(taskId)` — existencia + tenant da task.
 *  2. `ProjectsService.findOne(task.projectId, actorEntidadeId)` — membership
 *     (trata workspace publico ADR-V2-051 §8, privado via DVincula -170..-173,
 *     ORG_ADMIN -> MANAGER herdado).
 *  3. `TasksService.updateStatus` (sem `accessibleProjectIds` — o gate por
 *     projeto ja foi feito no passo 2, paridade byte a byte com a tool legada).
 *
 * `requiredScopes: ['tasks:write']` — espelha `requireScope(ctx,
 * MCP_SCOPES.TASKS_WRITE)`. No Nexus, `principal.can('tasks:write')` (RBAC:
 * MEMBER/MANAGER/ADMIN). `movedBy` vem SEMPRE de `principal.actorEntidadeId`.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 4 (tasks-write)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class UpdateStatusCapability implements Capability {
  readonly name = 'update_status';
  readonly description = 'Atualiza o status V3 de uma task.';
  readonly inputSchema = {
    type: 'object',
    required: ['taskId', 'statusCode'],
    properties: {
      taskId: { type: 'string' },
      statusCode: {
        type: 'string',
        description:
          'Codigo V3: INBOX|READY|EXECUTING|DONE|FAILED|CANCELLED|DISCARDED|VALIDATING|VALIDATED',
      },
    },
  };
  readonly requiredScopes = ['tasks:write'] as const;

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Aplica a transicao de status. Valida `taskId` (BigInt) e `statusCode`
   * (enum V3), confirma tenant + membership e delega.
   *
   * @param input - `{ taskId: string, statusCode: string }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com a task atualizada (`TaskResponseDto`).
   * @throws {CapabilityError} `INVALID_INPUT` quando taskId/statusCode invalidos.
   * @throws {import('@nestjs/common').NotFoundException} Task/projeto fora do scope.
   * @throws {import('@nestjs/common').BadRequestException} Transicao invalida.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const taskId = this.requiredString(input, 'taskId');
    const statusCode = this.requiredString(input, 'statusCode');

    this.assertBigIntParseable(taskId, 'taskId');
    if (!V3_STATUS_CODES.includes(statusCode as (typeof V3_STATUS_CODES)[number])) {
      throw new CapabilityError('INVALID_INPUT', 'statusCode: invalid V3 status code', {
        field: 'statusCode',
      });
    }

    const task = await this.tasksService.findOne(taskId);
    await this.projectsService.findOne(task.projectId, principal.actorEntidadeId);

    const result = await this.tasksService.updateStatus(taskId, {
      status: statusCode,
      movedBy: principal.actorEntidadeId.toString(),
    });

    return { data: result };
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
