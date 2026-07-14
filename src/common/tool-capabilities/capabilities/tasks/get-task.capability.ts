import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../../../projects/projects.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/**
 * `GetTaskCapability` — capability neutra `get_task` (Onda 3, reads so-MCP).
 *
 * Casca fina READ-ONLY sobre `TasksService.findOne` — a MESMA chamada que o
 * wrapper legado MCP (`src/mcp/tools/get-task.tool.ts`) ja faz. `inputSchema`
 * espelha 1:1 o schema legado (`taskId` obrigatorio).
 *
 * Tenant isolation (ADR-V2-042): resolve `accessibleProjectIds` via
 * `ProjectsService.findAccessibleProjectIds(principal.actorEntidadeId)` e
 * repassa como 2o argumento a `TasksService.findOne` — defesa em profundidade
 * identica a tool legada.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 3 (tasks-read)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class GetTaskCapability implements Capability {
  readonly name = 'get_task';
  readonly description = 'Busca uma task por ID, escopada aos projetos acessiveis ao usuario.';
  readonly inputSchema = {
    type: 'object',
    required: ['taskId'],
    properties: {
      taskId: { type: 'string' },
    },
  };
  readonly requiredScopes = ['tasks:read'] as const;

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Busca a task por ID, escopada aos projetos acessiveis ao ator.
   *
   * @param input - `{ taskId: string }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com a task (`TaskResponseDto`).
   * @throws {CapabilityError} `INVALID_INPUT` quando `taskId` ausente/invalido.
   * @throws {import('@nestjs/common').NotFoundException} Task fora do scope ou inexistente.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const taskId = this.requiredString(input, 'taskId');
    this.assertBigIntParseable(taskId, 'taskId');

    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      principal.actorEntidadeId,
    );

    const result = await this.tasksService.findOne(taskId, accessibleProjectIds);

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
