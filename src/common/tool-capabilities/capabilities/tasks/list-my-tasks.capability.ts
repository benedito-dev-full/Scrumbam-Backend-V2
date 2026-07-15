import { Injectable } from '@nestjs/common';

import { ListTasksQueryDto } from '../../../../tasks/dto/list-tasks-query.dto';
import { ProjectsService } from '../../../../projects/projects.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';
import { V3_STATUS_CODES } from '../../../../tasks/constants/task-status.const';


/**
 * `ListMyTasksCapability` — capability neutra `list_my_tasks` (Onda 3, reads so-MCP).
 *
 * Casca fina READ-ONLY sobre `TasksService.findMany` — a MESMA chamada que o
 * wrapper legado MCP (`src/mcp/tools/list-my-tasks.tool.ts`) ja faz (Pilar 2).
 * `inputSchema` espelha 1:1 o schema legado.
 *
 * **Anti-fraude (decisao de design, preservada da tool legada):** o
 * `assigneeId` e SEMPRE derivado de `principal.actorEntidadeId` — NUNCA
 * aceito do input. O schema nao expoe `assigneeId` e o handler ignora
 * qualquer valor que venha em `args`.
 *
 * Tenant isolation (ADR-V2-042 — defense-in-depth): resolve o scope de
 * projetos do ator e repassa `scopedProjectIds` ao `findMany`.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 3 (tasks-read)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class ListMyTasksCapability implements Capability {
  readonly name = 'list_my_tasks';
  readonly description =
    'Lista as tasks atribuidas ao usuario caller (visao "meu trabalho"), em todos os projetos acessiveis, com filtros opcionais de status/projeto. Retorna { items, pagination }. O assignee e SEMPRE o caller.';
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
  readonly requiredScopes = ['tasks:read'] as const;

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Lista as tasks atribuidas ao ator, com filtros opcionais e paginacao.
   *
   * @param input - `{ status?, projectId?, limit?, cursor? }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com `{ items, pagination }`.
   * @throws {CapabilityError} `INVALID_INPUT` quando um campo viola o schema.
   * @throws {import('@nestjs/common').NotFoundException} `projectId` informado nao acessivel.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const status = this.optionalString(input, 'status');
    if (status !== undefined && !(V3_STATUS_CODES as readonly string[]).includes(status)) {
      throw new CapabilityError('INVALID_INPUT', 'status: invalid V3 status code', {
        field: 'status',
      });
    }

    const projectId = this.optionalString(input, 'projectId');
    if (projectId) {
      this.assertBigIntParseable(projectId, 'projectId');
    }

    const cursor = this.optionalString(input, 'cursor');
    if (cursor) {
      this.assertBigIntParseable(cursor, 'cursor');
    }

    const limit = this.optionalLimit(input);

    let scopedProjectIds: string[];
    if (projectId) {
      await this.projectsService.findOne(projectId, principal.actorEntidadeId);
      scopedProjectIds = [projectId];
    } else {
      scopedProjectIds = await this.projectsService.findAccessibleProjectIds(
        principal.actorEntidadeId,
      );
    }

    if (scopedProjectIds.length === 0) {
      return { data: { items: [], pagination: { hasMore: false, nextCursor: null } } };
    }

    const assigneeId = principal.actorEntidadeId.toString();

    const query: ListTasksQueryDto = {
      assigneeId, // SEMPRE do principal, nunca do input (anti-fraude)
      ...(projectId ? { projectId } : { projectIds: scopedProjectIds }),
      ...(status ? { status } : {}),
      ...(cursor ? { cursor } : {}),
      limit,
    };

    const result = await this.tasksService.findMany(query, scopedProjectIds);

    return { data: result };
  }

  private optionalString(input: Record<string, unknown>, field: string): string | undefined {
    const value = input[field];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', `${field}: string expected`, { field });
    }
    return value;
  }

  private optionalLimit(input: Record<string, unknown>): number {
    const value = input.limit;
    if (value === undefined || value === null) {
      return 20;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 50) {
      throw new CapabilityError('INVALID_INPUT', 'limit: integer between 1 and 50 expected', {
        field: 'limit',
      });
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
