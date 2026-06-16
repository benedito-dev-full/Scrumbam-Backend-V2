import { Injectable, Logger } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { SearchService } from '../../search/search.service';
import { MCP_SCOPES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  assertRecord,
  invalidParams,
  optionalString,
  requireScope,
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
   * @param params - Argumentos da chamada (q obrigatório + projectId/limit opcionais)
   * @param ctx - Contexto MCP autenticado (contém `dEntidadeId` como bigint)
   * @returns Envelope MCP com JSON serializado das tasks encontradas
   * @throws {McpToolError} FORBIDDEN (-32002) quando scope `tasks:read` ausente
   * @throws {McpToolError} INVALID_PARAMS quando q ausente/curto ou projectId não acessível
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    // Gate de autorização (ADR-V2-068). Antes de qualquer query.
    requireScope(ctx, MCP_SCOPES.TASKS_READ);

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
