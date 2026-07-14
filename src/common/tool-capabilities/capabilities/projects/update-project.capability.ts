import { Injectable } from '@nestjs/common';

import { UpdateProjectDto } from '../../../../projects/dto/update-project.dto';
import { ProjectsService } from '../../../../projects/projects.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/**
 * `UpdateProjectCapability` — capability neutra `update_project` (Onda 4).
 *
 * Casca FINA sobre `ProjectsService.update` — atualiza propriedades de um
 * projeto existente. MESMA delegacao do wrapper legado
 * (`src/mcp/tools/update-project.tool.ts`).
 *
 * Requer role MANAGER no projeto (verificado internamente pelo service via
 * `requireManagerRole`). ForbiddenException/NotFoundException propagam UNCHANGED
 * (o adapter as repassa tal como as tools legadas fazem).
 *
 * Tenant isolation: NAO passa `organizationId` para `update` (IA e cross-org
 * por design — o scope de projetos acessiveis e resolvido por `actorEntidadeId`
 * globalmente). O MANAGER check no service garante que o caller nao atualiza
 * projetos onde nao tem role.
 *
 * Pelo menos UM campo alem de `projectId` deve estar presente; caso contrario,
 * `CapabilityError('INVALID_INPUT')` e lancado antes de tocar o service.
 *
 * NAO usa Engine: update em DProject e cadastro estrutural (Prisma direto via
 * ProjectsService). Pilar 1 (Engine) aplica apenas em DPedido idClasse=-300.
 *
 * `requiredScopes: ['projects:write']` — espelha `requireScope(ctx,
 * MCP_SCOPES.PROJECTS_WRITE)`. No Nexus, `principal.can('projects:write')`.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 4 (projects-write)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 */
@Injectable()
export class UpdateProjectCapability implements Capability {
  readonly name = 'update_project';
  readonly description =
    'Atualiza propriedades de um projeto. Requer role MANAGER no projeto. Use get_project para consultar antes de editar.';
  readonly inputSchema = {
    type: 'object',
    required: ['projectId'],
    properties: {
      projectId: { type: 'string' },
      nome: { type: 'string', maxLength: 200 },
      description: { type: 'string', maxLength: 2000 },
      prefix: { type: 'string' },
      automationEnabled: { type: 'boolean' },
      repoUrl: { type: ['string', 'null'] },
      teamId: { type: ['string', 'null'] },
    },
  };
  readonly requiredScopes = ['projects:write'] as const;

  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * Executa a atualizacao parcial. Valida `projectId` (BigInt), exige >=1 campo
   * de update, constroi o DTO com APENAS os campos presentes (omite `undefined`)
   * e delega SEM `organizationId` (IA e cross-org).
   *
   * @param input - Argumentos no formato neutro (ver `inputSchema`).
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com o projeto atualizado (`ProjectResponseDto`).
   * @throws {CapabilityError} `INVALID_INPUT` quando projectId ausente/invalido
   *   ou nenhum campo fornecido.
   * @throws {import('@nestjs/common').ForbiddenException} Caller nao e MANAGER.
   * @throws {import('@nestjs/common').NotFoundException} Projeto nao encontrado.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const projectId = this.requiredString(input, 'projectId');
    this.assertBigIntParseable(projectId, 'projectId');

    const nome = this.optionalString(input, 'nome');
    const description = this.optionalString(input, 'description');
    const prefix = this.optionalString(input, 'prefix');

    // repoUrl: string | null | undefined (null = limpar repoUrl).
    const repoUrl = this.optionalStringOrNull(input, 'repoUrl');
    // automationEnabled: boolean opcional.
    const automationEnabled = this.optionalBoolean(input, 'automationEnabled');
    // teamId: string | null | undefined (null = desvincular time).
    const teamId = this.optionalStringOrNull(input, 'teamId');

    const hasUpdate =
      nome !== undefined ||
      description !== undefined ||
      prefix !== undefined ||
      repoUrl !== undefined ||
      automationEnabled !== undefined ||
      teamId !== undefined;

    if (!hasUpdate) {
      throw new CapabilityError(
        'INVALID_INPUT',
        'at least one field to update must be provided (nome, description, prefix, automationEnabled, repoUrl, teamId)',
        { field: 'body' },
      );
    }

    // Construir DTO com apenas os campos presentes — nao incluir undefined para
    // que o service diferencie "omitido" de "null explicito".
    const dto: UpdateProjectDto = {};
    if (nome !== undefined) {
      dto.nome = nome;
    }
    if (description !== undefined) {
      dto.description = description;
    }
    if (prefix !== undefined) {
      dto.prefix = prefix;
    }
    if (repoUrl !== undefined) {
      dto.repoUrl = repoUrl;
    }
    if (automationEnabled !== undefined) {
      dto.automationEnabled = automationEnabled;
    }
    if (teamId !== undefined) {
      dto.teamId = teamId;
    }

    // NAO passa organizationId — IA e cross-org (ver JSDoc da classe).
    const result = await this.projectsService.update(projectId, dto, principal.actorEntidadeId);

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

  private optionalBoolean(input: Record<string, unknown>, field: string): boolean | undefined {
    const value = input[field];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'boolean') {
      throw new CapabilityError('INVALID_INPUT', `${field}: boolean expected`, { field });
    }
    return value;
  }

  /**
   * Extrai um campo com semantica ternaria (ausente=nao toca, null=remove,
   * string nao vazia=define).
   */
  private optionalStringOrNull(
    input: Record<string, unknown>,
    field: string,
  ): string | null | undefined {
    if (!(field in input)) {
      return undefined;
    }
    const value = input[field];
    if (value === null) {
      return null;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', `${field}: string or null expected`, { field });
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
