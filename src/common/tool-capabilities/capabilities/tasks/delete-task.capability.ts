import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../../../projects/projects.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/**
 * `DeleteTaskCapability` — capability neutra `delete_task` (Onda 4).
 *
 * Casca FINA sobre `TasksService.delete` — soft-delete de uma task. MESMA
 * sequencia do wrapper legado (`src/mcp/tools/delete-task.tool.ts`):
 *  1. `TasksService.findOne(taskId)` — existencia + tenant da task.
 *  2. `ProjectsService.findOne(task.projectId, actorEntidadeId)` — membership
 *     (trata workspace publico ADR-V2-051 §8, privado via DVincula -170..-173,
 *     ORG_ADMIN -> MANAGER herdado).
 *  3. `TasksService.delete(taskId, [task.projectId], { cascade }, actorId)` —
 *     `accessibleProjectIds = [task.projectId]` (gate ja validado no passo 2;
 *     nao alargar para "qualquer projeto"). `actorId = principal.actorEntidadeId`
 *     — origem do audit `task.deleted`/`phase.deleted` (DEvento -498).
 *
 * O delete e SOFT (marca `excluido=true`), cascateando por padrao para todas
 * as subtarefas (filhas, netos, ...) — fechando o bug de "orfas vivas"
 * (ADR-V2-047 Q6 / CEO 2026-05-30). `cascade=false` apenas desvincula.
 *
 * `requiredScopes: ['tasks:write']` — espelha `requireScope(ctx,
 * MCP_SCOPES.TASKS_WRITE)` da tool legada. No Nexus, `principal.can('tasks:write')`
 * (RBAC: MEMBER/MANAGER/ADMIN).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 4 (tasks-write)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-047 (Q6 — cascade default no delete de tasks/fases)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class DeleteTaskCapability implements Capability {
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
  readonly requiredScopes = ['tasks:write'] as const;

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Executa o soft-delete. Valida `taskId` (BigInt) e `cascade` (boolean
   * opcional; ausente → default do service), confirma tenant + membership e
   * delega.
   *
   * @param input - `{ taskId: string, cascade?: boolean }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com `{ deleted, taskId, cascade, affected }`.
   * @throws {CapabilityError} `INVALID_INPUT` quando `taskId` nao e BigInt ou
   *   `cascade` esta presente e nao e boolean.
   * @throws {import('@nestjs/common').NotFoundException} Task fora do scope.
   * @throws {import('@nestjs/common').ForbiddenException} Sem membership no projeto.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const taskId = this.requiredString(input, 'taskId');
    this.assertBigIntParseable(taskId, 'taskId');

    // cascade: boolean opcional. Ausente → undefined (mantem default do service).
    const cascadeRaw = input.cascade;
    let cascade: boolean | undefined;
    if (cascadeRaw === undefined || cascadeRaw === null) {
      cascade = undefined;
    } else if (typeof cascadeRaw !== 'boolean') {
      throw new CapabilityError('INVALID_INPUT', 'cascade: boolean expected', { field: 'cascade' });
    } else {
      cascade = cascadeRaw;
    }

    // Tenant isolation + membership (paridade com update_status / update_timer).
    const task = await this.tasksService.findOne(taskId);
    await this.projectsService.findOne(task.projectId, principal.actorEntidadeId);

    const result = await this.tasksService.delete(
      taskId,
      [task.projectId],
      { cascade },
      principal.actorEntidadeId,
    );

    // cascade efetivo: undefined no input → default do service (true).
    const effectiveCascade = cascade ?? true;

    return {
      data: {
        deleted: true,
        taskId,
        cascade: effectiveCascade,
        affected: result.affected,
      },
    };
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
