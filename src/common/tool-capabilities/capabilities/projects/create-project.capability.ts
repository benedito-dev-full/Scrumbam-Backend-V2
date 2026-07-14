import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../../../projects/projects.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/** idClasse hierarquicas aceitas por esta capability (ADR-V2-051). */
const ID_CLASSE_SPACE = '-350';
const ID_CLASSE_FOLDER = '-351';
const ID_CLASSE_LIST = '-352';
const ALLOWED_CLASSES = [ID_CLASSE_SPACE, ID_CLASSE_FOLDER, ID_CLASSE_LIST];

/** Descricao — DEVE bater byte-a-byte com `tools.schema.json`. */
const CREATE_PROJECT_DESCRIPTION =
  'Cria um projeto na hierarquia Space/Folder/List: -350 SPACE (raiz numa org), -351 FOLDER (dentro de um SPACE), -352 LIST (dentro de FOLDER ou SPACE; recebe os 9 statuses V3). Para SPACE a org e resolvida automaticamente quando o usuario pertence a uma unica org; informe orgId quando pertence a varias. FOLDER/LIST herdam a org do pai (idPai obrigatorio). Depois use create_block e create_task.';

/**
 * `CreateProjectCapability` — capability neutra `create_project` (Onda 4).
 *
 * Casca FINA sobre `ProjectsService.create` para criar um projeto na hierarquia
 * canonica Space/Folder/List (ADR-V2-051). MESMA delegacao do wrapper legado
 * (`src/mcp/tools/create-project.tool.ts`): o service cria atomicamente
 * DProject + DEntidade-espelho -158 (ADR-V2-058) + DVincula -171 MANAGER para o
 * criador + (so LIST -352) os 9 statuses V3, e valida a hierarquia.
 *
 * O miolo desta capability e a **resolucao de org** — a IA nao tem org de token:
 * - **SPACE (-350):** deve nascer numa org (`idEstab`), senao vira orfao
 *   invisivel na Camada A publica (ADR-V2-069). A org e derivada das memberships
 *   do usuario via `resolveOrgIdsForUser` (unica autoridade). 1 org → auto; N
 *   orgs sem `orgId` → erro pedindo `orgId`; `orgId` de org alheia → FORBIDDEN;
 *   0 orgs → erro.
 * - **FOLDER/LIST (-351/-352):** exigem `idPai` e **herdam** a org do pai via
 *   `findOne(idPai)` (que tambem autoriza o acesso ao pai — ADR-V2-042/069).
 *   `orgId` do input e ignorado (subtree fica na org do SPACE).
 *
 * Tenant isolation (ADR-V2-042): `principal.actorEntidadeId` (SEMPRE do auth) e
 * a unica autoridade de membership — nunca de input da IA.
 *
 * `requiredScopes: ['projects:write']` — espelha `requireScope(ctx,
 * MCP_SCOPES.PROJECTS_WRITE)` da tool legada. No Nexus, `principal.can('projects:write')`.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 4 (projects-write)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-051 (hierarquia Space/Folder/List)
 * @see ADR-V2-069/070 (Camada A no MCP + widening de `projects:write`)
 */
@Injectable()
export class CreateProjectCapability implements Capability {
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
  readonly requiredScopes = ['projects:write'] as const;

  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * Cria o projeto. Valida params (nome/idClasse obrigatorios, whitelist de
   * tipo, limites, hex de cor, BigInt-parseabilidade de idPai/orgId), resolve a
   * org de destino por tipo e delega.
   *
   * @param input - Argumentos no formato neutro (ver `inputSchema`).
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com o projeto criado (`ProjectResponseDto`).
   * @throws {CapabilityError} `FORBIDDEN` quando `orgId` aponta para org alheia;
   *   `INVALID_INPUT` quando um campo viola o schema ou a resolucao de org e
   *   ambigua/impossivel.
   * @throws {import('@nestjs/common').NotFoundException} Projeto pai fora do
   *   escopo ou inexistente (propagado de `findOne`).
   * @throws {import('@nestjs/common').BadRequestException} Hierarquia invalida
   *   (propagado de `create`).
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const nome = this.requiredString(input, 'nome');
    const idClasse = this.requiredString(input, 'idClasse');
    const idPai = this.optionalString(input, 'idPai');
    const orgIdInput = this.optionalString(input, 'orgId');
    const descricao = this.optionalString(input, 'descricao');
    const prefix = this.optionalString(input, 'prefix');
    const color = this.optionalString(input, 'color');
    const icon = this.optionalString(input, 'icon');
    const privado = this.optionalBoolean(input, 'privado');

    // Whitelist de tipo (schema plano → validacao condicional aqui).
    if (!ALLOWED_CLASSES.includes(idClasse)) {
      throw new CapabilityError(
        'INVALID_INPUT',
        'idClasse deve ser -350 (SPACE), -351 (FOLDER) ou -352 (LIST)',
        { field: 'idClasse', issue: 'unsupported class' },
      );
    }

    this.maxLength(nome, 'nome', 255);
    if (nome.length < 3) {
      throw new CapabilityError('INVALID_INPUT', 'nome: min length 3 required', { field: 'nome' });
    }
    if (descricao) {
      this.maxLength(descricao, 'descricao', 2000);
    }
    if (prefix) {
      this.maxLength(prefix, 'prefix', 8);
    }
    if (icon) {
      this.maxLength(icon, 'icon', 50);
    }
    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      throw new CapabilityError('INVALID_INPUT', 'color: hex #RRGGBB expected', { field: 'color' });
    }
    if (idPai) {
      this.assertBigIntParseable(idPai, 'idPai');
    }
    if (orgIdInput) {
      this.assertBigIntParseable(orgIdInput, 'orgId');
    }

    const resolvedOrgId = await this.resolveOrgId(idClasse, idPai, orgIdInput, principal);

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
      } as never,
      principal.actorEntidadeId,
    );

    return { data: result };
  }

  /**
   * Resolve a org de destino (`idEstab`) do projeto conforme o tipo.
   *
   * SPACE deriva/valida a org via `resolveOrgIdsForUser` (unica autoridade de
   * membership). FOLDER/LIST herdam a org do pai via `findOne(idPai)` (que
   * tambem autoriza o acesso ao pai). O `orgId` do input e honrado apenas para
   * SPACE — para FOLDER/LIST e ignorado.
   *
   * @throws {CapabilityError} `INVALID_INPUT` / `FORBIDDEN` conforme as regras de org.
   * @throws {import('@nestjs/common').NotFoundException} Pai fora do escopo.
   */
  private async resolveOrgId(
    idClasse: string,
    idPai: string | undefined,
    orgIdInput: string | undefined,
    principal: ToolPrincipal,
  ): Promise<string> {
    if (idClasse === ID_CLASSE_SPACE) {
      if (idPai) {
        throw new CapabilityError('INVALID_INPUT', 'SPACE e raiz e nao aceita idPai', {
          field: 'idPai',
          issue: 'not allowed for SPACE',
        });
      }

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
          'usuario nao pertence a nenhuma org — nao e possivel criar SPACE',
          { field: 'orgId', issue: 'no org membership' },
        );
      }
      throw new CapabilityError(
        'INVALID_INPUT',
        `usuario pertence a ${orgIds.length} orgs — informe orgId explicitamente`,
        { field: 'orgId', issue: 'ambiguous org' },
      );
    }

    // FOLDER / LIST: exigem idPai e herdam a org do pai.
    if (!idPai) {
      throw new CapabilityError('INVALID_INPUT', 'FOLDER/LIST exigem idPai', {
        field: 'idPai',
        issue: 'required for FOLDER/LIST',
      });
    }

    const parent = await this.projectsService.findOne(idPai, principal.actorEntidadeId);
    if (!parent.orgId) {
      throw new CapabilityError(
        'INVALID_INPUT',
        'projeto pai nao possui org — nao e possivel herdar',
        { field: 'idPai', issue: 'parent without org' },
      );
    }

    return parent.orgId;
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
