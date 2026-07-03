import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { MCP_ERROR_CODES, MCP_SCOPES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolError, McpToolResult } from './tool.interface';
import {
  assertRecord,
  invalidParams,
  maxStringLength,
  optionalBoolean,
  optionalString,
  parseBigIntParam,
  requireScope,
  requiredString,
  textResult,
} from './tool-params';

/** idClasse hierárquicas aceitas por esta tool (ADR-V2-051). */
const ID_CLASSE_SPACE = '-350';
const ID_CLASSE_FOLDER = '-351';
const ID_CLASSE_LIST = '-352';
const ALLOWED_CLASSES = [ID_CLASSE_SPACE, ID_CLASSE_FOLDER, ID_CLASSE_LIST];

/** Descrição da tool — DEVE bater byte-a-byte com `tools.schema.json`. */
const CREATE_PROJECT_DESCRIPTION =
  'Cria um projeto na hierarquia Space/Folder/List: -350 SPACE (raiz numa org), -351 FOLDER (dentro de um SPACE), -352 LIST (dentro de FOLDER ou SPACE; recebe os 9 statuses V3). Para SPACE a org e resolvida automaticamente quando o usuario pertence a uma unica org; informe orgId quando pertence a varias. FOLDER/LIST herdam a org do pai (idPai obrigatorio). Depois use create_block e create_task.';

/**
 * Tool MCP `create_project` — wrapper fino sobre `ProjectsService.create` para
 * criar um projeto na hierarquia canônica Space/Folder/List (ADR-V2-051).
 *
 * Completa o ciclo de "montar o workspace do zero" via MCP: com esta tool +
 * `create_block` + `create_task`, o agente cria Space → Folder → List → Bloco
 * → Task sem tocar a UI.
 *
 * Pilar 2 (reuso): NÃO duplica transação/seed/DVincula/espelho. Delega 100% a
 * `ProjectsService.create` — a mesma rota de `POST /projects`. O service cria
 * atomicamente DProject + DEntidade-espelho -158 (ADR-V2-058) + DVincula -171
 * MANAGER para o criador + (só para LIST -352) os 9 statuses V3, e valida a
 * hierarquia antes da transação.
 *
 * O miolo desta tool é a **resolução de org** — o MCP não tem org de token:
 * - **SPACE (-350):** deve nascer numa org (`idEstab`), senão vira órfão
 *   invisível na Camada A pública (ADR-V2-069). A org é derivada das
 *   memberships do usuário via `resolveOrgIdsForUser` (única autoridade —
 *   nunca cria em org alheia). 1 org → auto; N orgs sem `orgId` → erro claro
 *   pedindo `orgId`; `orgId` de org à qual o usuário não pertence → FORBIDDEN;
 *   0 orgs → erro.
 * - **FOLDER/LIST (-351/-352):** exigem `idPai` e **herdam** a org do pai via
 *   `findOne(idPai)` (que também autoriza o acesso ao pai — ADR-V2-042/069).
 *   `orgId` do input é ignorado de propósito (subtree fica sempre na org do
 *   SPACE).
 *
 * Validações de shape (whitelist de idClasse, tamanhos, hex de cor,
 * BigInt-parseabilidade) falham com INVALID_PARAMS limpo ANTES de chegar no
 * service (sem 500). A condicionalidade idPai↔tipo é validada aqui (schema
 * plano — sem `oneOf` na raiz, anti-footgun tools/list).
 *
 * @see ADR-V2-051 — Hierarquia Space/Folder/List
 * @see ADR-V2-069/070 — Camada A no MCP + widening de `projects:write`
 */
@Injectable()
export class CreateProjectTool implements McpTool {
  readonly name = 'create_project';
  readonly description = CREATE_PROJECT_DESCRIPTION;
  readonly inputSchema = {
    type: 'object',
    required: ['nome', 'idClasse'],
    properties: {
      nome: {
        type: 'string',
        minLength: 3,
        maxLength: 255,
        description: 'Nome do projeto/espaco/lista',
      },
      idClasse: {
        type: 'string',
        enum: ['-350', '-351', '-352'],
        description:
          'Tipo: -350 SPACE (raiz, sem idPai), -351 FOLDER (idPai=SPACE), -352 LIST (idPai=FOLDER ou SPACE; recebe seed de statuses V3)',
      },
      idPai: {
        type: 'string',
        description: 'ID do projeto pai. OBRIGATORIO p/ FOLDER/LIST; PROIBIDO p/ SPACE.',
      },
      orgId: {
        type: 'string',
        description:
          'ID da org (DEntidade -152). So para SPACE quando o usuario pertence a mais de uma org. Ignorado p/ FOLDER/LIST (herdam a org do pai).',
      },
      descricao: { type: 'string', maxLength: 2000, description: 'Descricao opcional' },
      prefix: {
        type: 'string',
        maxLength: 8,
        description: 'Prefixo das tasks (LIST): DEV -> DEV-1. Default DEV.',
      },
      privado: {
        type: 'boolean',
        description: 'SPACE privado (visivel so a membros explicitos). Default false.',
      },
      color: { type: 'string', description: 'Cor hex #RRGGBB' },
      icon: { type: 'string', maxLength: 50, description: 'Emoji ou slug do icone' },
    },
  };

  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * Handler do tools/call para `create_project`.
   *
   * Fluxo:
   * 1. Gate de autorização (scope `projects:write`, ADR-V2-068/070).
   * 2. Valida params (nome/idClasse obrigatórios, whitelist de tipo, limites,
   *    hex de cor, BigInt-parseabilidade de idPai/orgId).
   * 3. Resolve a org de destino por tipo (SPACE deriva/valida via
   *    `resolveOrgIdsForUser`; FOLDER/LIST herdam via `findOne(idPai)`).
   * 4. Delega para `projectsService.create` com o `orgId` resolvido.
   *
   * @param params - Argumentos da chamada (ver `inputSchema`)
   * @param ctx - Contexto MCP autenticado (contém `dEntidadeId` e `scopes`)
   * @returns Envelope MCP com o projeto criado (`ProjectResponseDto`)
   * @throws {McpToolError} FORBIDDEN (-32002) quando scope `projects:write`
   *   ausente OU quando `orgId` aponta para org à qual o usuário não pertence
   * @throws {McpToolError} INVALID_PARAMS quando algum campo viola o schema, o
   *   tipo é inválido, ou a resolução de org é ambígua/impossível
   * @throws {NotFoundException} Projeto pai fora do escopo ou inexistente
   *   (propagado de `findOne`)
   * @throws {BadRequestException} Hierarquia inválida (propagado de `create`)
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    // Gate de autorização (ADR-V2-068/070). Antes de qualquer query.
    requireScope(ctx, MCP_SCOPES.PROJECTS_WRITE);

    const input = assertRecord(params);
    const nome = requiredString(input, 'nome');
    const idClasse = requiredString(input, 'idClasse');
    const idPai = optionalString(input, 'idPai');
    const orgIdInput = optionalString(input, 'orgId');
    const descricao = optionalString(input, 'descricao');
    const prefix = optionalString(input, 'prefix');
    const color = optionalString(input, 'color');
    const icon = optionalString(input, 'icon');
    const privado = optionalBoolean(input, 'privado');

    // Whitelist de tipo (schema plano → validação condicional aqui).
    if (!ALLOWED_CLASSES.includes(idClasse)) {
      throw new McpToolError(
        MCP_ERROR_CODES.INVALID_PARAMS,
        'idClasse deve ser -350 (SPACE), -351 (FOLDER) ou -352 (LIST)',
        { field: 'idClasse', issue: 'unsupported class' },
      );
    }

    maxStringLength(nome, 'nome', 255);
    if (nome.length < 3) {
      throw invalidParams('nome', 'min length 3 required');
    }
    if (descricao) {
      maxStringLength(descricao, 'descricao', 2000);
    }
    if (prefix) {
      maxStringLength(prefix, 'prefix', 8);
    }
    if (icon) {
      maxStringLength(icon, 'icon', 50);
    }
    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      throw invalidParams('color', 'hex #RRGGBB expected');
    }
    if (idPai) {
      parseBigIntParam(idPai, 'idPai');
    }
    if (orgIdInput) {
      parseBigIntParam(orgIdInput, 'orgId');
    }

    const resolvedOrgId = await this.resolveOrgId(idClasse, idPai, orgIdInput, ctx);

    const result = await this.projectsService.create(
      {
        nome,
        idClasse,
        orgId: resolvedOrgId,
        ...(idPai ? { idPai } : {}),
        ...(descricao ? { description: descricao } : {}),
        ...(prefix ? { prefix } : {}),
        ...(privado !== undefined ? { privado } : {}),
        ...(color ? { color } : {}),
        ...(icon ? { icon } : {}),
      },
      ctx.dEntidadeId,
    );

    return textResult(result);
  }

  /**
   * Resolve a org de destino (`idEstab`) do projeto conforme o tipo.
   *
   * SPACE deriva/valida a org via `resolveOrgIdsForUser` (única autoridade de
   * membership). FOLDER/LIST herdam a org do pai via `findOne(idPai)` (que
   * também autoriza o acesso ao pai). O `orgId` do input é honrado apenas para
   * SPACE — para FOLDER/LIST é ignorado (subtree fica na org do SPACE).
   *
   * @throws {McpToolError} INVALID_PARAMS / FORBIDDEN conforme as regras de org
   * @throws {NotFoundException} Pai fora do escopo (propagado de `findOne`)
   */
  private async resolveOrgId(
    idClasse: string,
    idPai: string | undefined,
    orgIdInput: string | undefined,
    ctx: McpUserContext,
  ): Promise<string> {
    if (idClasse === ID_CLASSE_SPACE) {
      if (idPai) {
        throw new McpToolError(MCP_ERROR_CODES.INVALID_PARAMS, 'SPACE e raiz e nao aceita idPai', {
          field: 'idPai',
          issue: 'not allowed for SPACE',
        });
      }

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
          'usuario nao pertence a nenhuma org — nao e possivel criar SPACE',
          { field: 'orgId', issue: 'no org membership' },
        );
      }
      throw new McpToolError(
        MCP_ERROR_CODES.INVALID_PARAMS,
        `usuario pertence a ${orgIds.length} orgs — informe orgId explicitamente`,
        { field: 'orgId', issue: 'ambiguous org' },
      );
    }

    // FOLDER / LIST: exigem idPai e herdam a org do pai.
    if (!idPai) {
      throw new McpToolError(MCP_ERROR_CODES.INVALID_PARAMS, 'FOLDER/LIST exigem idPai', {
        field: 'idPai',
        issue: 'required for FOLDER/LIST',
      });
    }

    const parent = await this.projectsService.findOne(idPai, ctx.dEntidadeId);
    if (!parent.orgId) {
      throw new McpToolError(
        MCP_ERROR_CODES.INVALID_PARAMS,
        'projeto pai nao possui org — nao e possivel herdar',
        { field: 'idPai', issue: 'parent without org' },
      );
    }

    return parent.orgId;
  }
}
