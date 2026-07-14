import { Injectable, NotFoundException } from '@nestjs/common';

import { ProjectMembersService } from '../../../../projects/project-members.service';
import { ProjectsService } from '../../../../projects/projects.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/**
 * `ListMembersCapability` — capability neutra `list_members` (Onda 3, reads so-MCP).
 *
 * Casca fina READ-ONLY sobre `ProjectMembersService.getMembers` — a MESMA
 * chamada que o wrapper legado MCP (`src/mcp/tools/list-members.tool.ts`) ja
 * faz (Pilar 2 — query unica com `include`, ZERO N+1).
 *
 * Tenant isolation (ADR-V2-042 — defense in depth): `projectId` fora do
 * escopo do ator lanca `NotFoundException` identica a "projeto nao
 * encontrado" (anti enumeration), ANTES de consultar os membros.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 3 (misc-read)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class ListMembersCapability implements Capability {
  readonly name = 'list_members';
  readonly description =
    'Lista os membros de um projeto (com seus roles), escopada aos projetos acessiveis ao usuario.';
  readonly inputSchema = {
    type: 'object',
    required: ['projectId'],
    properties: {
      projectId: { type: 'string' },
    },
  };
  readonly requiredScopes = ['tasks:read'] as const;

  constructor(
    private readonly projectMembersService: ProjectMembersService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Lista os membros de um projeto acessivel ao ator.
   *
   * @param input - `{ projectId: string }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com a lista de membros.
   * @throws {CapabilityError} `INVALID_INPUT` quando `projectId` ausente/invalido.
   * @throws {import('@nestjs/common').NotFoundException} Projeto fora do scope do ator.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const projectId = this.requiredString(input, 'projectId');
    this.assertBigIntParseable(projectId, 'projectId');

    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      principal.actorEntidadeId,
    );

    if (!accessibleProjectIds.includes(projectId)) {
      throw new NotFoundException(`Projeto ${projectId} não encontrado`);
    }

    const result = await this.projectMembersService.getMembers(projectId);

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
