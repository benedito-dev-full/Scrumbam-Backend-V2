import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../../../projects/projects.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/**
 * `ListProjectsCapability` — capability neutra `list_projects` (Onda 3, reads so-MCP).
 *
 * Casca fina READ-ONLY sobre `ProjectsService.findMany` — a MESMA chamada que
 * o wrapper legado MCP (`src/mcp/tools/list-projects.tool.ts`) ja faz
 * (Pilar 2). `inputSchema` espelha 1:1 o schema legado (`limit`/`cursor`).
 *
 * Tenant isolation: `ProjectsService.findMany` ja escopa por
 * `userEntidadeId` (via `principal.actorEntidadeId`) — sem gate adicional
 * necessario nesta capability.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 3 (projects-read)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 */
@Injectable()
export class ListProjectsCapability implements Capability {
  readonly name = 'list_projects';
  readonly description = 'Lista projetos acessiveis ao usuario.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      cursor: { type: 'string' },
    },
  };
  readonly requiredScopes = ['tasks:read'] as const;

  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * Lista projetos acessiveis ao ator, com paginacao por cursor.
   *
   * @param input - `{ limit?: number, cursor?: string }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com `{ items, pagination }`.
   * @throws {CapabilityError} `INVALID_INPUT` quando `cursor`/`limit` invalidos.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const cursor = this.optionalString(input, 'cursor');
    if (cursor) {
      this.assertBigIntParseable(cursor, 'cursor');
    }

    const result = await this.projectsService.findMany(principal.actorEntidadeId, {
      ...(cursor ? { cursor } : {}),
      limit: this.optionalLimit(input),
    });

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
