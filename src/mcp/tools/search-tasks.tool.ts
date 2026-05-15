import { Injectable, Logger } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { SearchService } from '../../search/search.service';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  assertRecord,
  invalidParams,
  optionalString,
  textResult,
} from './tool-params';

/**
 * Tool MCP `search_tasks` — busca tasks por texto livre em projetos acessíveis.
 *
 * Tenant isolation:
 *  - `ProjectsService.findAccessibleProjectIds(ctx.dEntidadeId)` resolve os
 *    projetos acessíveis ao caller (ADR-V2-042 defense-in-depth).
 *  - `SearchService.searchForMcp` filtra tasks em `IN (accessibleProjectIds)`,
 *    nunca expondo dados de outros tenants.
 *  - Se `projectId` fornecido, valida que está em `accessibleProjectIds`
 *    antes de passar para o service (anti-enumeration: mesma mensagem para
 *    "não acessível" e "não encontrado").
 *
 * NAO usa Engine: busca read-only em DTask (estrutural via Prisma direto).
 * ZERO INSERT/UPDATE/DELETE. Pilar 1 não se aplica.
 *
 * @example
 * ```json
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "method": "tools/call",
 *   "params": {
 *     "name": "search_tasks",
 *     "arguments": {
 *       "q": "login",
 *       "projectId": "123",
 *       "limit": 10
 *     }
 *   }
 * }
 * ```
 */
@Injectable()
export class SearchTasksTool implements McpTool {
  private readonly logger = new Logger(SearchTasksTool.name);

  readonly name = 'search_tasks';
  readonly description =
    'Busca tasks por texto livre em projetos acessíveis ao usuário. Escopo automático por tenant — retorna apenas tasks de projetos dos quais o usuário é membro.';
  readonly inputSchema = {
    type: 'object',
    required: ['q'],
    properties: {
      q: { type: 'string', minLength: 2, maxLength: 200 },
      projectId: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    },
  };

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly searchService: SearchService,
  ) {}

  /**
   * Handler do tools/call para `search_tasks`.
   *
   * Fluxo:
   * 1. Valida `params` como Record + `q` string com mínimo 2 chars.
   * 2. Extrai `projectId` (opcional) e `limit` (default 20, clampado 1-50).
   * 3. Resolve `accessibleProjectIds` via `ProjectsService.findAccessibleProjectIds`.
   * 4. Se `projectId` fornecido, valida que está em `accessibleProjectIds`.
   * 5. Invoca `SearchService.searchForMcp` com escopo de IDs resolvido.
   * 6. Retorna resultado serializado via `textResult`.
   *
   * @param params - Argumentos da chamada (q obrigatório + projectId/limit opcionais)
   * @param ctx - Contexto MCP autenticado (contém `dEntidadeId` como bigint)
   * @returns Envelope MCP com JSON serializado das tasks encontradas
   * @throws {McpToolError} INVALID_PARAMS quando q ausente/curto ou projectId não acessível
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = assertRecord(params);

    // Validar q obrigatório
    const q = this.parseQ(input);

    // Extrair projectId opcional
    const projectId = optionalString(input, 'projectId');

    // Extrair limit (default 20, clampar 1-50 internamente)
    const limit = this.parseLimit(input);

    this.logger.debug?.(
      `search_tasks q="${q}" projectId=${projectId ?? 'all'} limit=${limit} userId=${ctx.dEntidadeId}`,
    );

    // Resolver projetos acessíveis ao caller (ADR-V2-042)
    const accessibleIds = await this.projectsService.findAccessibleProjectIds(ctx.dEntidadeId);

    // Se accessibleIds vazio → resultado vazio sem chamar searchService
    if (accessibleIds.length === 0) {
      return textResult({ tasks: [], total: 0, q });
    }

    // Se projectId fornecido → validar que está em accessibleIds (anti-enumeration)
    if (projectId !== undefined) {
      if (!accessibleIds.includes(projectId)) {
        throw invalidParams('projectId', 'projeto não acessível');
      }
    }

    const result = await this.searchService.searchForMcp(q, ctx.dEntidadeId, accessibleIds, {
      projectId,
      limit,
    });

    return textResult(result);
  }

  /**
   * Extrai e valida o parâmetro `q`.
   *
   * @param input - Params já validados como Record
   * @returns string com mínimo 2 chars
   * @throws {McpToolError} INVALID_PARAMS se ausente, não-string ou < 2 chars
   */
  private parseQ(input: Record<string, unknown>): string {
    const value = input.q;
    if (typeof value !== 'string' || value.trim() === '') {
      throw invalidParams('q', 'required string');
    }
    if (value.length < 2) {
      throw invalidParams('q', 'q deve ter no mínimo 2 caracteres');
    }

    return value;
  }

  /**
   * Extrai `limit` do input, aplicando default 20 e clampar 1-50.
   *
   * @param input - Params já validados como Record
   * @returns number entre 1 e 50
   * @throws {McpToolError} INVALID_PARAMS se o valor não for inteiro entre 1 e 50
   */
  private parseLimit(input: Record<string, unknown>): number {
    const value = input.limit;
    if (value === undefined || value === null) {
      return 20;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 50) {
      throw invalidParams('limit', 'integer between 1 and 50 expected');
    }

    return value;
  }
}
