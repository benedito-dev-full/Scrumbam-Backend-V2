import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../../../projects/projects.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';
import { V3_STATUS_CODES } from '../../../../tasks/constants/task-status.const';


const NUMERIC_RE = /^-?\d+$/;

/**
 * `ListTasksCapability` — capability neutra `list_tasks` (Onda 3, reads so-MCP).
 *
 * Casca fina READ-ONLY sobre `TasksService.findMany` — a MESMA chamada que o
 * wrapper legado MCP (`src/mcp/tools/list-tasks.tool.ts`) ja faz (Pilar 2).
 * `inputSchema` espelha 1:1 o schema legado (projectId/status/assigneeId/
 * idClasse/idPai/limit/cursor).
 *
 * Tenant isolation (ADR-V2-042 — defense-in-depth): resolve o scope de
 * projetos do ator (via `projectId` explicito ou `findAccessibleProjectIds`)
 * e repassa `scopedProjectIds` como 2o argumento a `TasksService.findMany`.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 3 (tasks-read)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class ListTasksCapability implements Capability {
  readonly name = 'list_tasks';
  readonly description =
    'Lista tasks do usuario com filtros opcionais de projeto, status, assignee, idClasse (ex: -200=Bloco, -154=SCRUMBAN_TASK) e idPai (subtarefas / ADR-V2-047).';
  readonly inputSchema = {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'ID do projeto (opcional)' },
      status: {
        type: 'string',
        description: 'Codigo do status V3 (ex: INBOX, EXECUTING)',
      },
      assigneeId: { type: 'string', description: 'ID do assignee (opcional)' },
      idClasse: {
        type: 'string',
        description:
          'Filtra por idClasse polimorfica da DTask (string numerica negativa). Ex: -200=Bloco, -154=SCRUMBAN_TASK.',
      },
      idPai: {
        type: 'string',
        description:
          'Lista subtarefas: chave numerica da task pai (filhas diretas). Use o literal "null" para listar tasks raiz (sem pai). Opcional.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      cursor: {
        type: 'string',
        description: 'Cursor de paginacao',
      },
    },
  };
  readonly requiredScopes = ['tasks:read'] as const;

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Lista tasks do ator com filtros opcionais e paginacao por cursor.
   *
   * @param input - `{ projectId?, status?, assigneeId?, idClasse?, idPai?, limit?, cursor? }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com `{ items, pagination }`.
   * @throws {CapabilityError} `INVALID_INPUT` quando um campo viola o schema.
   * @throws {import('@nestjs/common').NotFoundException} `projectId` fora do scope.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const projectId = this.optionalString(input, 'projectId');
    const assigneeId = this.optionalString(input, 'assigneeId');
    const cursor = this.optionalString(input, 'cursor');
    const status = this.optionalString(input, 'status');
    const idClasse = this.optionalString(input, 'idClasse');
    const idPai = this.optionalString(input, 'idPai');
    const limit = this.optionalLimit(input);

    if (projectId) this.assertBigIntParseable(projectId, 'projectId');
    if (assigneeId) this.assertBigIntParseable(assigneeId, 'assigneeId');
    if (cursor) this.assertBigIntParseable(cursor, 'cursor');
    if (status && !(V3_STATUS_CODES as readonly string[]).includes(status)) {
      throw new CapabilityError('INVALID_INPUT', 'status: invalid V3 status code', {
        field: 'status',
      });
    }
    if (idClasse !== undefined && !NUMERIC_RE.test(idClasse)) {
      throw new CapabilityError('INVALID_INPUT', 'idClasse: must match /^-?\\d+$/', {
        field: 'idClasse',
      });
    }
    if (idPai !== undefined && idPai !== 'null' && !NUMERIC_RE.test(idPai)) {
      throw new CapabilityError(
        'INVALID_INPUT',
        'idPai: must be a numeric id or the literal "null"',
        { field: 'idPai' },
      );
    }

    const scopedProjectIds = await this.resolveScopedProjectIds(projectId, principal);
    if (scopedProjectIds.length === 0) {
      return { data: { items: [], pagination: { hasMore: false, nextCursor: null } } };
    }

    const result = await this.tasksService.findMany(
      {
        ...(projectId ? { projectId } : {}),
        ...(!projectId ? { projectIds: scopedProjectIds } : {}),
        ...(status ? { status } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(idClasse ? { idClasse } : {}),
        ...(idPai !== undefined ? { idPai } : {}),
        ...(cursor ? { cursor } : {}),
        limit,
      },
      scopedProjectIds,
    );

    return { data: result };
  }

  private async resolveScopedProjectIds(
    projectId: string | undefined,
    principal: ToolPrincipal,
  ): Promise<string[]> {
    if (projectId) {
      await this.projectsService.findOne(projectId, principal.actorEntidadeId);
      return [projectId];
    }
    return this.projectsService.findAccessibleProjectIds(principal.actorEntidadeId);
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
