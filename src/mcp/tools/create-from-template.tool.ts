import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { MCP_ERROR_CODES, MCP_SCOPES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolError, McpToolResult } from './tool.interface';
import {
  assertRecord,
  maxStringLength,
  optionalBoolean,
  optionalString,
  parseBigIntParam,
  requireScope,
  requiredString,
  textResult,
} from './tool-params';

/** Descrição da tool — DEVE bater byte-a-byte com `tools.schema.json`. */
const CREATE_FROM_TEMPLATE_DESCRIPTION =
  'Materializa um template (idClasse -401 TEMPLATE_LIST / -402 TEMPLATE_SPACE) numa arvore real (List/Space com blocos e tasks molde-limpo). Para template de LISTA informe idPai (SPACE/FOLDER destino — herda a org do destino). Para template de ESPACO omita idPai (nasce como raiz — a org e resolvida automaticamente quando o usuario pertence a uma unica org; informe orgId quando pertence a varias). Templates GLOBAIS sao visiveis a todas as orgs; templates de outra org retornam nao-encontrado.';

/**
 * Tool MCP `create_from_template` — wrapper fino sobre
 * `ProjectsService.createFromTemplate` para materializar um template do
 * catálogo (DClasse -401 TEMPLATE_LIST / -402 TEMPLATE_SPACE) numa árvore real
 * (List/Space com blocos e tasks molde-limpo). ADR-V2-061.
 *
 * Fecha o ciclo "montar um workspace inteiro via MCP com um comando só": com
 * `create_project` + `create_block` + `create_task` o agente monta a hierarquia
 * do zero; com esta tool ele instancia um molde pronto de uma vez.
 *
 * Pilar 2 (reuso): NÃO duplica NADA do motor. Delega 100% a
 * `ProjectsService.createFromTemplate`, que aciona `cloneTree` com
 * `fromTemplate=true` (remap -401→-352 LIST / -402→-350 SPACE), copia
 * blocos/tasks (molde-limpo: INBOX, sem assignee/prazo, novo identifier) e
 * carimba o `idEstab` da org de destino em todos os nós. Zero lógica de
 * clone/seed/remap/RBAC reimplementada aqui.
 *
 * **Autorização de ORIGEM (o template) vem de graça:** o service considera um
 * template usável se `idEstab === org resolvida` (org-scoped) OU
 * `idEstab === null` (global — semeado/plataforma). Template de outra org →
 * 404 leak-free. O `cloneTree` PULA o RBAC de origem de propósito (usar ≠
 * gerenciar — não exige MANAGER na origem). A tool NÃO valida a origem: ao
 * resolver corretamente a org de DESTINO, a visibilidade da origem se resolve
 * sozinha.
 *
 * **O miolo desta tool é a resolução da org de DESTINO** — o MCP não tem org de
 * token, e `createFromTemplate` LANÇA `BadRequestException` se a org for vazia.
 * A tool SEMPRE resolve uma org concreta antes de delegar (nunca passa
 * `undefined`). A regra ramifica pela PRESENÇA de `idPai` (não pela classe do
 * template — o service é a autoridade da consistência classe↔idPai):
 * - **`idPai` presente** (materializa LISTA sob um SPACE/FOLDER): herda a org do
 *   destino via `findOne(idPai)` (que também autoriza o acesso ao pai). O
 *   `orgId` do input é ignorado (o subtree fica na org do destino).
 * - **`idPai` ausente** (materializa ESPAÇO como raiz): deriva/valida a org via
 *   `resolveOrgIdsForUser` (única autoridade de membership). 1 org → auto; N
 *   orgs sem `orgId` → erro pedindo `orgId`; `orgId` de org à qual o usuário não
 *   pertence → FORBIDDEN; 0 orgs → erro.
 *
 * Validações de shape (obrigatório/tipos/tamanhos/BigInt-parseabilidade) falham
 * com INVALID_PARAMS limpo ANTES de tocar o service. Schema plano (sem
 * `anyOf`/`oneOf`/`allOf` na raiz — anti-footgun tools/list); toda a
 * condicionalidade é validada no handler.
 *
 * @see ADR-V2-061 — Feature Templates (DClasse -401/-402 + remap obrigatório)
 * @see ADR-V2-069/070 — Camada A no MCP sem org de token + `projects:write`
 * @see ADR-V2-051 — Hierarquia Space/Folder/List
 */
@Injectable()
export class CreateFromTemplateTool implements McpTool {
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

  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * Handler do tools/call para `create_from_template`.
   *
   * Fluxo:
   * 1. Gate de autorização (scope `projects:write`, ADR-V2-068/070).
   * 2. Valida params (`templateId` obrigatório; opcionais tipados; limites;
   *    BigInt-parseabilidade de templateId/idPai/orgId).
   * 3. Resolve a org de DESTINO (helper `resolveDestinoOrg`) — SEMPRE concreta.
   * 4. Delega para `projectsService.createFromTemplate` com a org resolvida.
   *
   * @param params - Argumentos da chamada (ver `inputSchema`)
   * @param ctx - Contexto MCP autenticado (contém `dEntidadeId` e `scopes`)
   * @returns Envelope MCP com o nó raiz materializado (`ProjectResponseDto`)
   * @throws {McpToolError} FORBIDDEN (-32002) quando scope `projects:write`
   *   ausente OU quando `orgId` aponta para org à qual o usuário não pertence
   * @throws {McpToolError} INVALID_PARAMS quando algum campo viola o schema ou a
   *   resolução de org é ambígua/impossível
   * @throws {NotFoundException} Template/destino inexistente ou de outra org
   *   (propagado de `createFromTemplate`/`findOne`)
   * @throws {BadRequestException} Hierarquia inválida (propagado de
   *   `createFromTemplate`)
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    // Gate de autorização (ADR-V2-068/070). Antes de qualquer query.
    requireScope(ctx, MCP_SCOPES.PROJECTS_WRITE);

    const input = assertRecord(params);
    const templateId = requiredString(input, 'templateId');
    const idPai = optionalString(input, 'idPai');
    const orgIdInput = optionalString(input, 'orgId');
    const novoNome = optionalString(input, 'novoNome');
    const novoIcone = optionalString(input, 'novoIcone');
    const includeTasks = optionalBoolean(input, 'includeTasks');

    parseBigIntParam(templateId, 'templateId');
    if (idPai) {
      parseBigIntParam(idPai, 'idPai');
    }
    if (orgIdInput) {
      parseBigIntParam(orgIdInput, 'orgId');
    }
    if (novoNome) {
      maxStringLength(novoNome, 'novoNome', 255);
    }
    if (novoIcone) {
      maxStringLength(novoIcone, 'novoIcone', 50);
    }

    const orgId = await this.resolveDestinoOrg(idPai, orgIdInput, ctx);

    const result = await this.projectsService.createFromTemplate(
      templateId,
      ctx.dEntidadeId,
      orgId,
      {
        ...(includeTasks !== undefined ? { includeTasks } : {}),
        ...(novoNome ? { novoNome } : {}),
        ...(novoIcone ? { novoIcone } : {}),
        ...(idPai ? { idPai } : {}),
      },
    );

    return textResult(result);
  }

  /**
   * Resolve a org de DESTINO (`idEstab`) onde o template será materializado.
   *
   * Ramifica pela PRESENÇA de `idPai` (não pela classe do template):
   * - **`idPai` presente** (LISTA sob SPACE/FOLDER): herda a org do destino via
   *   `findOne(idPai)` — que também autoriza o acesso de leitura ao pai. O
   *   `orgId` do input é ignorado (o subtree fica na org do destino). Essa org
   *   sempre bate com a org que o service revalida no destino.
   * - **`idPai` ausente** (ESPAÇO raiz): deriva/valida a org via
   *   `resolveOrgIdsForUser` (única autoridade de membership — nunca materializa
   *   em org alheia).
   *
   * O retorno é SEMPRE uma org concreta — `createFromTemplate` lança
   * `BadRequestException` se a org for vazia (o MCP não tem org de token).
   *
   * @throws {McpToolError} INVALID_PARAMS / FORBIDDEN conforme as regras de org
   * @throws {NotFoundException} Pai fora do escopo (propagado de `findOne`)
   */
  private async resolveDestinoOrg(
    idPai: string | undefined,
    orgIdInput: string | undefined,
    ctx: McpUserContext,
  ): Promise<string> {
    // LISTA sob um destino: herda a org do pai (findOne autoriza o acesso).
    if (idPai) {
      const parent = await this.projectsService.findOne(idPai, ctx.dEntidadeId);
      if (!parent.orgId) {
        throw new McpToolError(
          MCP_ERROR_CODES.INVALID_PARAMS,
          'destino nao possui org — nao e possivel materializar',
          { field: 'idPai', issue: 'parent without org' },
        );
      }
      return parent.orgId;
    }

    // ESPAÇO como raiz: deriva/valida a org via membership.
    const orgIds = await this.projectsService.resolveOrgIdsForUser(ctx.dEntidadeId);

    if (orgIdInput) {
      if (!orgIds.some((org) => org.toString() === orgIdInput)) {
        throw new McpToolError(
          MCP_ERROR_CODES.FORBIDDEN,
          'usuario nao pertence a org informada em orgId',
          { field: 'orgId', issue: 'not a member' },
        );
      }
      return orgIdInput;
    }

    if (orgIds.length === 1) {
      return orgIds[0].toString();
    }
    if (orgIds.length === 0) {
      throw new McpToolError(
        MCP_ERROR_CODES.INVALID_PARAMS,
        'usuario nao pertence a nenhuma org — nao e possivel materializar um Espaco',
        { field: 'orgId', issue: 'no org membership' },
      );
    }
    throw new McpToolError(
      MCP_ERROR_CODES.INVALID_PARAMS,
      `usuario pertence a ${orgIds.length} orgs — informe orgId explicitamente`,
      { field: 'orgId', issue: 'ambiguous org' },
    );
  }
}
