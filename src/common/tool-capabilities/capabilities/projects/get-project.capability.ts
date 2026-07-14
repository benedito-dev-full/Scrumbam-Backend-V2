import { Injectable, NotFoundException } from '@nestjs/common';

import { ProjectMembersService } from '../../../../projects/project-members.service';
import { ProjectsService } from '../../../../projects/projects.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/** Valores permitidos para o parametro `include[]` — espelha a tool legada. */
const ALLOWED_INCLUDES = ['members', 'stats'] as const;
type GetProjectInclude = (typeof ALLOWED_INCLUDES)[number];

/**
 * `GetProjectCapability` — capability neutra `get_project` (Onda 3, reads so-MCP).
 *
 * Casca fina READ-ONLY que agrega `ProjectsService.findOne` (dados base,
 * incluindo `tableFields`) com `include[]` opcional (`members`, `stats`) —
 * MESMA composicao que o wrapper legado MCP
 * (`src/mcp/tools/get-project.tool.ts`) ja faz (Pilar 2).
 *
 * Tenant isolation (ADR-V2-042 — defense in depth): resolve
 * `accessibleProjectIds`; `projectId` fora do scope lanca `NotFoundException`
 * com mensagem identica a "projeto nao encontrado" (anti enumeration) —
 * cortocircuito ANTES do `Promise.all` dos includes.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 3 (projects-read)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class GetProjectCapability implements Capability {
  readonly name = 'get_project';
  readonly description =
    'Busca dados de um projeto por ID. Retorna o projeto base (incluindo tableFields — schema das colunas customizáveis da Lista, null para não-Lista). Suporta include opcional (members, stats) para reduzir round-trips do LLM.';
  readonly inputSchema = {
    type: 'object',
    required: ['projectId'],
    properties: {
      projectId: { type: 'string' },
      include: {
        type: 'array',
        items: { type: 'string', enum: [...ALLOWED_INCLUDES] },
        uniqueItems: true,
        description: 'Campos opcionais a incluir no payload de resposta. Valores: members | stats.',
      },
    },
  };
  readonly requiredScopes = ['tasks:read'] as const;

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectMembersService: ProjectMembersService,
  ) {}

  /**
   * Busca dados de um projeto, com campos opcionais via `include[]`.
   *
   * @param input - `{ projectId: string, include?: string[] }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com o projeto (+ campos do include).
   * @throws {CapabilityError} `INVALID_INPUT` quando projectId/include invalidos.
   * @throws {import('@nestjs/common').NotFoundException} Projeto fora do scope do ator.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const projectId = this.requiredString(input, 'projectId');
    this.assertBigIntParseable(projectId, 'projectId');

    const include = this.parseInclude(input.include);

    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      principal.actorEntidadeId,
    );

    if (!accessibleProjectIds.includes(projectId)) {
      throw new NotFoundException(`Projeto ${projectId} não encontrado`);
    }

    const wantsMembers = include.includes('members');
    const wantsStats = include.includes('stats');

    const [project, members, stats] = await Promise.all([
      this.projectsService.findOne(projectId, principal.actorEntidadeId),
      wantsMembers ? this.projectMembersService.getMembers(projectId) : Promise.resolve(undefined),
      wantsStats
        ? this.projectsService.getStats(projectId, principal.actorEntidadeId)
        : Promise.resolve(undefined),
    ]);

    const result: Record<string, unknown> = { ...project };
    if (wantsMembers) {
      result.members = members;
    }
    if (wantsStats) {
      result.stats = stats;
    }

    return { data: result };
  }

  private parseInclude(raw: unknown): GetProjectInclude[] {
    if (raw === undefined || raw === null) {
      return [];
    }
    if (!Array.isArray(raw)) {
      throw new CapabilityError('INVALID_INPUT', 'include: array expected', { field: 'include' });
    }
    const allowed: ReadonlySet<string> = new Set(ALLOWED_INCLUDES);
    for (const item of raw) {
      if (typeof item !== 'string' || !allowed.has(item)) {
        throw new CapabilityError(
          'INVALID_INPUT',
          'include: each item must be one of: members, stats',
          { field: 'include' },
        );
      }
    }
    return raw as GetProjectInclude[];
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
