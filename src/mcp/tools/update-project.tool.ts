import { Injectable, Logger } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { UpdateProjectDto } from '../../projects/dto/update-project.dto';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  assertRecord,
  invalidParams,
  optionalString,
  parseBigIntParam,
  requiredString,
  textResult,
} from './tool-params';

/**
 * Tool MCP `update_project` — atualiza propriedades de um projeto existente.
 *
 * Requer role MANAGER no projeto (verificado internamente pelo
 * `ProjectsService.update` via `requireManagerRole`). ForbiddenException
 * propagada para o router sem try/catch — o router decide como traduzir.
 *
 * Tenant isolation:
 *  - NÃO passa `organizationId` para `projectsService.update` (MCP é
 *    cross-org por design — o caller tem MCP key de org específica mas o
 *    scope de projetos acessíveis é resolvido por `dEntidadeId` globalmente).
 *  - MANAGER check no service garante que o caller não pode atualizar
 *    projetos onde não tem role.
 *
 * Pelo menos UM campo além de `projectId` deve estar presente;
 * caso contrário, `invalidParams` é lançado antes de chamar o service.
 *
 * NAO usa Engine: update em DProject é cadastro estrutural (Prisma direto
 * via ProjectsService). Pilar 1 (Engine) aplica apenas em DPedido idClasse=-300.
 *
 * @example
 * ```json
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "method": "tools/call",
 *   "params": {
 *     "name": "update_project",
 *     "arguments": {
 *       "projectId": "123",
 *       "nome": "Novo Nome do Projeto",
 *       "automationEnabled": true
 *     }
 *   }
 * }
 * ```
 */
@Injectable()
export class UpdateProjectTool implements McpTool {
  private readonly logger = new Logger(UpdateProjectTool.name);

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

  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * Handler do tools/call para `update_project`.
   *
   * Fluxo:
   * 1. Valida `params` como Record + `projectId` string não vazia + BigInt parseable.
   * 2. Valida que ao menos um campo além de `projectId` foi fornecido.
   * 3. Constrói DTO com APENAS os campos presentes (omite `undefined`).
   * 4. Chama `projectsService.update(projectId, dto, ctx.dEntidadeId)` —
   *    SEM `organizationId` (MCP é cross-org).
   * 5. Retorna resultado serializado via `textResult`.
   *
   * ForbiddenException (caller não é MANAGER) e NotFoundException (projeto
   * não existe) propagam para o `McpRouterService.dispatchTool` sem tratamento
   * local — o router os captura e relança como exceção runtime.
   *
   * @param params - Argumentos da chamada (projectId + campos opcionais)
   * @param ctx - Contexto MCP autenticado (contém `dEntidadeId` como bigint)
   * @returns Envelope MCP com JSON serializado do projeto atualizado
   * @throws {McpToolError} INVALID_PARAMS quando projectId ausente/inválido ou nenhum campo fornecido
   * @throws {ForbiddenException} Quando caller não tem role MANAGER no projeto
   * @throws {NotFoundException} Quando projeto não encontrado
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = assertRecord(params);
    const projectId = requiredString(input, 'projectId');
    parseBigIntParam(projectId, 'projectId');

    // Extrair campos opcionais presentes no input.
    const nome = optionalString(input, 'nome');
    const description = optionalString(input, 'description');
    const prefix = optionalString(input, 'prefix');

    // repoUrl: string | null | undefined (null = limpar repoUrl).
    const repoUrl = this.parseOptionalRepoUrl(input);

    // automationEnabled: boolean opcional.
    const automationEnabled = this.parseOptionalBoolean(input, 'automationEnabled');

    // teamId: string | null | undefined (null = desvincular time).
    const teamId = this.parseOptionalTeamId(input);

    // Garantir que ao menos um campo de atualização foi fornecido.
    const hasUpdate =
      nome !== undefined ||
      description !== undefined ||
      prefix !== undefined ||
      repoUrl !== undefined ||
      automationEnabled !== undefined ||
      teamId !== undefined;

    if (!hasUpdate) {
      throw invalidParams(
        'body',
        'at least one field to update must be provided (nome, description, prefix, automationEnabled, repoUrl, teamId)',
      );
    }

    // Construir DTO com apenas os campos presentes — não incluir undefined
    // para que o service possa diferenciar "omitido" de "null explícito".
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

    this.logger.debug?.(`update_project projectId=${projectId} fields=[${Object.keys(dto).join(',')}]`);

    // NÃO passa organizationId — MCP é cross-org (ver JSDoc da classe).
    const result = await this.projectsService.update(projectId, dto, ctx.dEntidadeId);

    return textResult(result);
  }

  /**
   * Extrai `repoUrl` do input respeitando semântica ternária:
   *  - ausente/undefined → undefined (não tocar o campo)
   *  - null explícito    → null (limpar repoUrl)
   *  - string não vazia  → string (nova URL)
   *
   * @param input - Params já validados como Record
   * @returns string | null | undefined
   * @throws {McpToolError} INVALID_PARAMS se o valor não for string nem null
   */
  private parseOptionalRepoUrl(input: Record<string, unknown>): string | null | undefined {
    if (!('repoUrl' in input)) {
      return undefined;
    }
    const value = input.repoUrl;
    if (value === null) {
      return null;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw invalidParams('repoUrl', 'string or null expected');
    }

    return value;
  }

  /**
   * Extrai `automationEnabled` do input como boolean opcional.
   *
   * @param input - Params já validados como Record
   * @param field - Nome do campo
   * @returns boolean se presente, undefined caso contrário
   * @throws {McpToolError} INVALID_PARAMS se o valor não for boolean
   */
  private parseOptionalBoolean(
    input: Record<string, unknown>,
    field: string,
  ): boolean | undefined {
    const value = input[field];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'boolean') {
      throw invalidParams(field, 'boolean expected');
    }

    return value;
  }

  /**
   * Extrai `teamId` do input respeitando semântica ternária:
   *  - ausente/undefined → undefined (não tocar o vínculo)
   *  - null explícito    → null (desvincular time)
   *  - string não vazia  → string (novo time)
   *
   * @param input - Params já validados como Record
   * @returns string | null | undefined
   * @throws {McpToolError} INVALID_PARAMS se o valor não for string nem null
   */
  private parseOptionalTeamId(input: Record<string, unknown>): string | null | undefined {
    if (!('teamId' in input)) {
      return undefined;
    }
    const value = input.teamId;
    if (value === null) {
      return null;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw invalidParams('teamId', 'string or null expected');
    }

    return value;
  }
}
