import { Injectable, Logger } from '@nestjs/common';

import { ProjectsService } from '../../../../projects/projects.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/**
 * `ListBlocksCapability` — capability neutra `list_blocks` (Onda 3, reads so-MCP).
 *
 * Casca fina READ-ONLY sobre `TasksService.findMany` com `idClasse='-200'`
 * fixo — a MESMA chamada que o wrapper legado MCP
 * (`src/mcp/tools/list-blocks.tool.ts`) ja faz (Pilar 2 — endpoint generico
 * reutilizado).
 *
 * Tenant isolation (ADR-V2-042 — defense-in-depth): `projectId` fora do
 * escopo do ator retorna lista vazia (anti-enumeration, mesma semantica da
 * tool legada).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 3 (blocks-read)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class ListBlocksCapability implements Capability {
  private readonly logger = new Logger(ListBlocksCapability.name);

  readonly name = 'list_blocks';
  readonly description =
    'Lista blocos (DTask idClasse=-200) de um projeto acessivel ao usuario. Para as tasks e metricas de um bloco use list_block_tasks.';
  readonly inputSchema = {
    type: 'object',
    required: ['projectId'],
    properties: {
      projectId: { type: 'string', description: 'ID do projeto (obrigatorio)' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      cursor: { type: 'string', description: 'Cursor de paginacao' },
    },
  };
  readonly requiredScopes = ['tasks:read'] as const;

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Lista blocos de um projeto com paginacao por cursor.
   *
   * @param input - `{ projectId: string, limit?: number, cursor?: string }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com `{ items, pagination }`.
   * @throws {CapabilityError} `INVALID_INPUT` quando projectId/cursor invalidos.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const projectId = this.requiredString(input, 'projectId');
    this.assertBigIntParseable(projectId, 'projectId');

    const cursor = this.optionalString(input, 'cursor');
    if (cursor) {
      this.assertBigIntParseable(cursor, 'cursor');
    }

    const limit = this.optionalLimit(input);

    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      principal.actorEntidadeId,
    );

    if (!accessibleProjectIds.includes(projectId)) {
      this.logger.warn(
        `list_blocks: projeto ${projectId} fora do scope para entidade ${principal.actorEntidadeId.toString()}`,
      );
      return { data: { items: [], pagination: { hasMore: false, nextCursor: null } } };
    }

    const result = await this.tasksService.findMany(
      {
        projectId,
        idClasse: '-200',
        ...(cursor ? { cursor } : {}),
        limit,
      },
      accessibleProjectIds,
    );

    return { data: result };
  }

  private requiredString(input: Record<string, unknown>, field: string): string {
    const value = input[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', `${field}: required string`, { field });
    }
    return value;
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
