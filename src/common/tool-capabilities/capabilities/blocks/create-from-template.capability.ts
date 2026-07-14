import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../../../projects/projects.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/** Descricao — DEVE bater byte-a-byte com `tools.schema.json`. */
const CREATE_FROM_TEMPLATE_DESCRIPTION =
  'Materializa um template (idClasse -401 TEMPLATE_LIST / -402 TEMPLATE_SPACE) numa arvore real (List/Space com blocos e tasks molde-limpo). Para template de LISTA informe idPai (SPACE/FOLDER destino — herda a org do destino). Para template de ESPACO omita idPai (nasce como raiz — a org e resolvida automaticamente quando o usuario pertence a uma unica org; informe orgId quando pertence a varias). Templates GLOBAIS sao visiveis a todas as orgs; templates de outra org retornam nao-encontrado.';

/**
 * `CreateFromTemplateCapability` — capability neutra `create_from_template` (Onda 4).
 *
 * Casca FINA sobre `ProjectsService.createFromTemplate` para materializar um
 * template do catalogo (DClasse -401 TEMPLATE_LIST / -402 TEMPLATE_SPACE) numa
 * arvore real (List/Space com blocos e tasks molde-limpo). ADR-V2-061. MESMA
 * delegacao do wrapper legado (`src/mcp/tools/create-from-template.tool.ts`).
 *
 * Pilar 2 (reuso): NAO duplica clone/seed/remap/RBAC. Delega 100% ao service,
 * que aciona `cloneTree` com `fromTemplate=true` (remap -401→-352 LIST /
 * -402→-350 SPACE), copia blocos/tasks (molde-limpo: INBOX, sem assignee/prazo,
 * novo identifier) e carimba o `idEstab` da org de destino em todos os nos.
 *
 * **Autorizacao de ORIGEM (o template) vem de graca:** o service considera um
 * template usavel se `idEstab === org resolvida` OU `idEstab === null` (global).
 * Template de outra org → 404 leak-free.
 *
 * **O miolo desta capability e a resolucao da org de DESTINO** — a IA nao tem
 * org de token, e `createFromTemplate` LANCA `BadRequestException` se a org for
 * vazia. Sempre resolve uma org concreta antes de delegar. Ramifica pela
 * PRESENCA de `idPai`:
 * - **`idPai` presente** (LISTA sob SPACE/FOLDER): herda a org do destino via
 *   `findOne(idPai)`. `orgId` do input e ignorado.
 * - **`idPai` ausente** (ESPACO raiz): deriva/valida a org via
 *   `resolveOrgIdsForUser`. 1 org → auto; N orgs sem `orgId` → erro pedindo
 *   `orgId`; `orgId` de org alheia → FORBIDDEN; 0 orgs → erro.
 *
 * Tenant isolation (ADR-V2-042): `principal.actorEntidadeId` (SEMPRE do auth).
 *
 * `requiredScopes: ['projects:write']` — espelha `requireScope(ctx,
 * MCP_SCOPES.PROJECTS_WRITE)`. No Nexus, `principal.can('projects:write')`.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 4 (blocks-write)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-061 (Templates — DClasse -401/-402 + remap obrigatorio)
 * @see ADR-V2-069/070 (Camada A sem org de token + `projects:write`)
 */
@Injectable()
export class CreateFromTemplateCapability implements Capability {
  readonly name = 'create_from_template';
  readonly description = CREATE_FROM_TEMPLATE_DESCRIPTION;
  readonly inputSchema = {
    type: 'object',
    required: ['templateId'],
    properties: {
      templateId: {
        type: 'string',
        description: 'ID do template (-401 TEMPLATE_LIST / -402 TEMPLATE_SPACE) a materializar.',
      },
      idPai: {
        type: 'string',
        description:
          'Destino p/ template de LISTA (-401): SPACE/FOLDER onde a Lista nasce. OMITIR p/ template de ESPACO (-402), que nasce como raiz.',
      },
      orgId: {
        type: 'string',
        description:
          'Desambiguacao de org p/ template de ESPACO quando o usuario pertence a varias orgs. Ignorado quando idPai e informado (herda a org do destino).',
      },
      novoNome: {
        type: 'string',
        maxLength: 255,
        description: 'Sobrescreve o nome do no raiz materializado. Opcional.',
      },
      novoIcone: {
        type: 'string',
        maxLength: 50,
        description: 'Sobrescreve o icone (dados.icon) do no raiz. Opcional.',
      },
      includeTasks: {
        type: 'boolean',
        description:
          'Copiar as tasks do template (molde-limpo: INBOX, sem assignee/prazo). Default true.',
      },
    },
  };
  readonly requiredScopes = ['projects:write'] as const;

  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * Materializa o template. Valida params (`templateId` obrigatorio; opcionais
   * tipados; limites; BigInt-parseabilidade), resolve a org de DESTINO (SEMPRE
   * concreta) e delega.
   *
   * @param input - Argumentos no formato neutro (ver `inputSchema`).
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com o no raiz materializado (`ProjectResponseDto`).
   * @throws {CapabilityError} `FORBIDDEN` quando `orgId` aponta para org alheia;
   *   `INVALID_INPUT` quando um campo viola o schema ou a resolucao de org e
   *   ambigua/impossivel.
   * @throws {import('@nestjs/common').NotFoundException} Template/destino
   *   inexistente ou de outra org (propagado).
   * @throws {import('@nestjs/common').BadRequestException} Hierarquia invalida
   *   (propagado).
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const templateId = this.requiredString(input, 'templateId');
    const idPai = this.optionalString(input, 'idPai');
    const orgIdInput = this.optionalString(input, 'orgId');
    const novoNome = this.optionalString(input, 'novoNome');
    const novoIcone = this.optionalString(input, 'novoIcone');
    const includeTasks = this.optionalBoolean(input, 'includeTasks');

    this.assertBigIntParseable(templateId, 'templateId');
    if (idPai) {
      this.assertBigIntParseable(idPai, 'idPai');
    }
    if (orgIdInput) {
      this.assertBigIntParseable(orgIdInput, 'orgId');
    }
    if (novoNome) {
      this.maxLength(novoNome, 'novoNome', 255);
    }
    if (novoIcone) {
      this.maxLength(novoIcone, 'novoIcone', 50);
    }

    const orgId = await this.resolveDestinoOrg(idPai, orgIdInput, principal);

    const result = await this.projectsService.createFromTemplate(
      templateId,
      principal.actorEntidadeId,
      orgId,
      {
        ...(includeTasks !== undefined ? { includeTasks } : {}),
        ...(novoNome ? { novoNome } : {}),
        ...(novoIcone ? { novoIcone } : {}),
        ...(idPai ? { idPai } : {}),
      } as never,
    );

    return { data: result };
  }

  /**
   * Resolve a org de DESTINO (`idEstab`) onde o template sera materializado.
   *
   * Ramifica pela PRESENCA de `idPai`:
   * - **`idPai` presente** (LISTA sob SPACE/FOLDER): herda a org do destino via
   *   `findOne(idPai)` — que tambem autoriza o acesso de leitura ao pai. O
   *   `orgId` do input e ignorado.
   * - **`idPai` ausente** (ESPACO raiz): deriva/valida a org via
   *   `resolveOrgIdsForUser` (unica autoridade de membership).
   *
   * O retorno e SEMPRE uma org concreta — `createFromTemplate` lanca
   * `BadRequestException` se a org for vazia (a IA nao tem org de token).
   *
   * @throws {CapabilityError} `INVALID_INPUT` / `FORBIDDEN` conforme as regras de org.
   * @throws {import('@nestjs/common').NotFoundException} Pai fora do escopo.
   */
  private async resolveDestinoOrg(
    idPai: string | undefined,
    orgIdInput: string | undefined,
    principal: ToolPrincipal,
  ): Promise<string> {
    // LISTA sob um destino: herda a org do pai (findOne autoriza o acesso).
    if (idPai) {
      const parent = await this.projectsService.findOne(idPai, principal.actorEntidadeId);
      if (!parent.orgId) {
        throw new CapabilityError(
          'INVALID_INPUT',
          'destino nao possui org — nao e possivel materializar',
          { field: 'idPai', issue: 'parent without org' },
        );
      }
      return parent.orgId;
    }

    // ESPACO como raiz: deriva/valida a org via membership.
    const orgIds = await this.projectsService.resolveOrgIdsForUser(principal.actorEntidadeId);

    if (orgIdInput) {
      if (!orgIds.some((org) => org.toString() === orgIdInput)) {
        throw new CapabilityError('FORBIDDEN', 'usuario nao pertence a org informada em orgId', {
          field: 'orgId',
          issue: 'not a member',
        });
      }
      return orgIdInput;
    }

    if (orgIds.length === 1) {
      return orgIds[0].toString();
    }
    if (orgIds.length === 0) {
      throw new CapabilityError(
        'INVALID_INPUT',
        'usuario nao pertence a nenhuma org — nao e possivel materializar um Espaco',
        { field: 'orgId', issue: 'no org membership' },
      );
    }
    throw new CapabilityError(
      'INVALID_INPUT',
      `usuario pertence a ${orgIds.length} orgs — informe orgId explicitamente`,
      { field: 'orgId', issue: 'ambiguous org' },
    );
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

  private maxLength(value: string, field: string, max: number): void {
    if (value.length > max) {
      throw new CapabilityError('INVALID_INPUT', `${field}: max length ${max} exceeded`, { field });
    }
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
