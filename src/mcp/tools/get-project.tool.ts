import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { ProjectMembersService } from '../../projects/project-members.service';
import { ProjectsService } from '../../projects/projects.service';
import { MCP_SCOPES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  assertRecord,
  invalidParams,
  parseBigIntParam,
  requireScope,
  requiredString,
  textResult,
} from './tool-params';

/**
 * Valores permitidos para o parametro `include[]` da tool `get_project`.
 *
 * Cada include adiciona um campo opcional ao payload de resposta:
 *  - `members` → adiciona `members: ListProjectMembersResponseDto`
 *  - `stats`   → adiciona `stats: ProjectStatsDto` (contagem por status V3)
 *
 * `activity` foi EXCLUIDO desta task (Strategist §4.4 — adiado).
 */
const ALLOWED_INCLUDES = ['members', 'stats'] as const;
type GetProjectInclude = (typeof ALLOWED_INCLUDES)[number];

/**
 * Tool MCP `get_project` — busca dados completos de um projeto, com campos
 * opcionais via `include[]` (`members`, `stats`).
 *
 * Payload base inclui `tableFields` (ADR-V2-061): o schema versionado das
 * colunas customizáveis da Lista (`{ version, columns[] }`), ou `null` para
 * projetos que não são Lista (ou Listas sem schema). Esse campo vem SEMPRE no
 * payload base — de graça, populado pelo `ProjectsService.findOne` (a mesma
 * query do REST `GET /projects/:id`), SEM custo de query adicional. Por isso
 * NÃO é um `include[]` opt-in: os includes (`members`, `stats`) existem apenas
 * para campos que disparam queries extras; `tableFields` não dispara nenhuma.
 * O agente/LLM recebe o schema de colunas para, no futuro (Task 4b — escrita),
 * preencher/editar valores com conhecimento das colunas. Esta tool é LEITURA
 * PURA — nenhuma escrita, nenhuma mutação.
 *
 * Tenant isolation (ADR-V2-042 — defense in depth):
 * 1. Resolve `accessibleProjectIds` via `ProjectsService.findAccessibleProjectIds`.
 * 2. Se `projectId` NAO esta no scope autorizado, lanca `NotFoundException`
 *    com mensagem identica a "projeto nao encontrado" (anti enumeration attack).
 *    Esse gate uniforme tambem garante que `members`/`stats` NAO sao
 *    chamados quando o usuario nao tem acesso (cortocircuito antes do Promise.all).
 * 3. Apos o gate, executa em PARALELO (Promise.all):
 *    - dados base via `ProjectsService.findOne(projectId, ctx.dEntidadeId)`
 *    - includes solicitados (cada um e uma chamada independente)
 *
 * NAO usa Engine: leitura simples em tabelas estruturais (DProject, DVincula,
 * DTabela). Pilar 1 (Engine) so aplica em DPedido idClasse=-300 (transacional).
 *
 * Decisao de design (Strategist §4.4): UMA tool com `include[]` em vez de
 * 4 tools separadas. Reduz round-trips do LLM (1 call vs N) e mantem a
 * superficie do schema enxuta. Cada include e opt-in — sem `include`, retorna
 * apenas o projeto base.
 *
 * @example
 * ```json
 * // Apenas projeto base
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "method": "tools/call",
 *   "params": {
 *     "name": "get_project",
 *     "arguments": { "projectId": "123" }
 *   }
 * }
 *
 * // Projeto + members + stats
 * {
 *   "jsonrpc": "2.0",
 *   "id": 2,
 *   "method": "tools/call",
 *   "params": {
 *     "name": "get_project",
 *     "arguments": {
 *       "projectId": "123",
 *       "include": ["members", "stats"]
 *     }
 *   }
 * }
 * ```
 */
@Injectable()
export class GetProjectTool implements McpTool {
  private readonly logger = new Logger(GetProjectTool.name);

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

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectMembersService: ProjectMembersService,
  ) {}

  /**
   * Handler do tools/call para `get_project`.
   *
   * Fluxo:
   * 1. Gate de autorização (ADR-V2-068).
   * 2. Valida params (object + `projectId` string nao vazia + BigInt parseable).
   * 3. Valida `include[]` (array opcional; cada item dentro do enum).
   * 4. Resolve projetos acessiveis ao caller (ADR-V2-042 — defense in depth).
   * 5. Gate: se `projectId` nao pertence ao scope, lanca `NotFoundException`
   *    com mensagem identica a projeto inexistente (anti enumeration).
   * 6. Executa em PARALELO via Promise.all:
   *    - `findOne(projectId, dEntidadeId)` (sempre — dados base)
   *    - `getMembers(projectId)` se `include` contem `members`
   *    - `getStats(projectId, dEntidadeId)` se `stats`
   * 7. Compoe resultado mesclando apenas as keys solicitadas.
   *
   * @param params - Argumentos da chamada (`{ projectId: string, include?: string[] }`)
   * @param ctx - Contexto MCP autenticado (contem `dEntidadeId`)
   * @returns Envelope MCP com JSON serializado do projeto (+ campos do include)
   * @throws {McpToolError} FORBIDDEN (-32002) quando scope `tasks:read` ausente
   * @throws {McpToolError} INVALID_PARAMS quando projectId/include invalido
   * @throws {NotFoundException} Quando projeto fora do scope do usuario MCP
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    // Gate de autorização (ADR-V2-068). Antes de qualquer query.
    requireScope(ctx, MCP_SCOPES.TASKS_READ);

    const input = assertRecord(params);
    const projectId = requiredString(input, 'projectId');
    parseBigIntParam(projectId, 'projectId');

    const include = this.parseInclude(input.include);

    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      ctx.dEntidadeId,
    );

    if (!accessibleProjectIds.includes(projectId)) {
      // Mensagem identica a projeto inexistente — anti enumeration (ADR-V2-042).
      throw new NotFoundException(`Projeto ${projectId} não encontrado`);
    }

    // Promise.all com placeholders condicionais. Garante paralelizacao real
    // dos includes quando o LLM pede multiplos campos em uma so chamada.
    const wantsMembers = include.includes('members');
    const wantsStats = include.includes('stats');

    const [project, members, stats] = await Promise.all([
      this.projectsService.findOne(projectId, ctx.dEntidadeId),
      wantsMembers ? this.projectMembersService.getMembers(projectId) : Promise.resolve(undefined),
      wantsStats
        ? this.projectsService.getStats(projectId, ctx.dEntidadeId)
        : Promise.resolve(undefined),
    ]);

    // Compoe payload apenas com as keys efetivamente solicitadas — evita
    // poluir o output com undefined nos includes nao pedidos.
    const result: Record<string, unknown> = { ...project };
    if (wantsMembers) {
      result.members = members;
    }
    if (wantsStats) {
      result.stats = stats;
    }

    this.logger.debug?.(`get_project projectId=${projectId} includes=[${include.join(',')}]`);

    return textResult(result);
  }

  /**
   * Valida e normaliza o parametro `include[]`.
   *
   * Aceita:
   *  - `undefined` ou ausente → array vazio (so retorna projeto base)
   *  - `array` de strings dentro do enum (`members` | `stats`)
   *
   * Rejeita (com INVALID_PARAMS):
   *  - Valor nao-array (ex: string, object, number)
   *  - Item nao-string dentro do array
   *  - String fora do enum (ex: `activity`, `tasks`)
   *
   * @param raw - Valor cru do campo `include` em `params`
   * @returns Array de includes validados (pode ser vazio)
   * @throws {McpToolError} INVALID_PARAMS para qualquer formato fora do contrato
   */
  private parseInclude(raw: unknown): GetProjectInclude[] {
    if (raw === undefined || raw === null) {
      return [];
    }
    if (!Array.isArray(raw)) {
      throw invalidParams('include', 'array expected');
    }
    const allowed: ReadonlySet<string> = new Set(ALLOWED_INCLUDES);
    for (const item of raw) {
      if (typeof item !== 'string' || !allowed.has(item)) {
        throw invalidParams('include', 'each item must be one of: members, stats');
      }
    }

    return raw as GetProjectInclude[];
  }
}
