import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../../../projects/projects.service';
import { SearchService } from '../../../../search/search.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/**
 * `SearchTasksCapability` — capability neutra `search_tasks` (Onda 3, reads so-MCP).
 *
 * Casca fina READ-ONLY sobre `SearchService.searchForMcp` — a MESMA chamada
 * que o wrapper legado MCP (`src/mcp/tools/search-tasks.tool.ts`) ja faz
 * (Pilar 2). `inputSchema` espelha 1:1 o schema legado (`q` obrigatorio,
 * `projectId`/`limit` opcionais).
 *
 * Tenant isolation (ADR-V2-042): resolve `accessibleProjectIds` via
 * `ProjectsService.findAccessibleProjectIds`; `projectId` explicito fora do
 * escopo lanca `INVALID_INPUT` (anti-enumeration, mesma semantica da tool
 * legada). `SearchService.searchForMcp` filtra `IN (accessibleProjectIds)`.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 3 (tasks-read)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class SearchTasksCapability implements Capability {
  readonly name = 'search_tasks';
  readonly description =
    'Busca tasks por texto livre em projetos acessiveis ao usuario. Escopo automatico por tenant — retorna apenas tasks de projetos dos quais o usuario e membro.';
  readonly inputSchema = {
    type: 'object',
    required: ['q'],
    properties: {
      q: { type: 'string', minLength: 2, maxLength: 200 },
      projectId: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    },
  };
  readonly requiredScopes = ['tasks:read'] as const;

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly searchService: SearchService,
  ) {}

  /**
   * Busca tasks por texto livre, escopada aos projetos acessiveis ao ator.
   *
   * @param input - `{ q: string, projectId?: string, limit?: number }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com `{ tasks, total, q }`.
   * @throws {CapabilityError} `INVALID_INPUT` quando `q` invalido/curto ou
   *   `projectId` nao acessivel.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const q = this.parseQ(input);
    const projectId = this.optionalString(input, 'projectId');
    const limit = this.parseLimit(input);

    const accessibleIds = await this.projectsService.findAccessibleProjectIds(
      principal.actorEntidadeId,
    );

    if (accessibleIds.length === 0) {
      return { data: { tasks: [], total: 0, q } };
    }

    if (projectId !== undefined && !accessibleIds.includes(projectId)) {
      throw new CapabilityError('INVALID_INPUT', 'projectId: projeto não acessível', {
        field: 'projectId',
      });
    }

    const result = await this.searchService.searchForMcp(
      q,
      principal.actorEntidadeId,
      accessibleIds,
      { projectId, limit },
    );

    return { data: result };
  }

  private parseQ(input: Record<string, unknown>): string {
    const value = input.q;
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', 'q: required string', { field: 'q' });
    }
    if (value.length < 2) {
      throw new CapabilityError('INVALID_INPUT', 'q deve ter no mínimo 2 caracteres', {
        field: 'q',
      });
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

  private parseLimit(input: Record<string, unknown>): number {
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
}
