import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { ProjectMembersService } from '../../projects/project-members.service';
import { ProjectsService } from '../../projects/projects.service';
import { TabelaService } from '../../tabelas/tabelas.service';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  assertRecord,
  invalidParams,
  parseBigIntParam,
  requiredString,
  textResult,
} from './tool-params';

/**
 * Valores permitidos para o parametro `include[]` da tool `get_project`.
 *
 * Cada include adiciona um campo opcional ao payload de resposta:
 *  - `members` → adiciona `members: ListProjectMembersResponseDto`
 *  - `sprints` → adiciona `sprints: ListTabelaResponseDto` (primeira pagina, 20 itens)
 *  - `stats`   → adiciona `stats: ProjectStatsDto` (contagem por status V3)
 *
 * `activity` foi EXCLUIDO desta task (Strategist §4.4 — adiado).
 */
const ALLOWED_INCLUDES = ['members', 'sprints', 'stats'] as const;
type GetProjectInclude = (typeof ALLOWED_INCLUDES)[number];

const SPRINT_CLASS_ID = '-400';
const SPRINTS_PAGE_SIZE = 20;

/**
 * Tool MCP `get_project` — busca dados completos de um projeto, com campos
 * opcionais via `include[]` (`members`, `sprints`, `stats`).
 *
 * Tenant isolation (ADR-V2-042 — defense in depth):
 * 1. Resolve `accessibleProjectIds` via `ProjectsService.findAccessibleProjectIds`.
 * 2. Se `projectId` NAO esta no scope autorizado, lanca `NotFoundException`
 *    com mensagem identica a "projeto nao encontrado" (anti enumeration attack).
 *    Esse gate uniforme tambem garante que `members`/`sprints`/`stats` NAO sao
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
    'Busca dados de um projeto por ID. Suporta include opcional (members, sprints, stats) para reduzir round-trips do LLM.';
  readonly inputSchema = {
    type: 'object',
    required: ['projectId'],
    properties: {
      projectId: { type: 'string' },
      include: {
        type: 'array',
        items: { type: 'string', enum: [...ALLOWED_INCLUDES] },
        uniqueItems: true,
        description:
          'Campos opcionais a incluir no payload de resposta. Valores: members | sprints | stats.',
      },
    },
  };

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectMembersService: ProjectMembersService,
    private readonly tabelaService: TabelaService,
  ) {}

  /**
   * Handler do tools/call para `get_project`.
   *
   * Fluxo:
   * 1. Valida params (object + `projectId` string nao vazia + BigInt parseable).
   * 2. Valida `include[]` (array opcional; cada item dentro do enum).
   * 3. Resolve projetos acessiveis ao caller (ADR-V2-042 — defense in depth).
   * 4. Gate: se `projectId` nao pertence ao scope, lanca `NotFoundException`
   *    com mensagem identica a projeto inexistente (anti enumeration).
   * 5. Executa em PARALELO via Promise.all:
   *    - `findOne(projectId, dEntidadeId)` (sempre — dados base)
   *    - `getMembers(projectId)` se `include` contem `members`
   *    - `listarPorClasse({ idClasse: '-400', dEntidadeId: projectId })` se `sprints`
   *    - `getStats(projectId, dEntidadeId)` se `stats`
   * 6. Compoe resultado mesclando apenas as keys solicitadas.
   *
   * Excecoes nao tratadas (`NotFoundException`, etc.) propagam para o
   * `McpRouterService.dispatchTool`, que NAO traduz para JSON-RPC error
   * (propaga como exception runtime).
   *
   * @param params - Argumentos da chamada (`{ projectId: string, include?: string[] }`)
   * @param ctx - Contexto MCP autenticado (contem `dEntidadeId`)
   * @returns Envelope MCP com JSON serializado do projeto (+ campos do include)
   * @throws {McpToolError} INVALID_PARAMS quando projectId/include invalido
   * @throws {NotFoundException} Quando projeto fora do scope do usuario MCP
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
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
    const wantsSprints = include.includes('sprints');
    const wantsStats = include.includes('stats');

    const [project, members, sprints, stats] = await Promise.all([
      this.projectsService.findOne(projectId, ctx.dEntidadeId),
      wantsMembers ? this.projectMembersService.getMembers(projectId) : Promise.resolve(undefined),
      wantsSprints
        ? this.tabelaService.listarPorClasse({
            idClasse: SPRINT_CLASS_ID,
            dEntidadeId: projectId,
            pageSize: SPRINTS_PAGE_SIZE,
          })
        : Promise.resolve(undefined),
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
    if (wantsSprints) {
      result.sprints = sprints;
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
   *  - `array` de strings dentro do enum (`members` | `sprints` | `stats`)
   *
   * Rejeita (com INVALID_PARAMS):
   *  - Valor nao-array (ex: string, object, number)
   *  - Item nao-string dentro do array
   *  - String fora do enum (ex: `activity`, `tasks`)
   *
   * Duplicatas sao toleradas — `wantsX` checa via `includes()`. Mas o schema
   * JSON declara `uniqueItems: true`; um cliente conformante nunca deve
   * enviar duplicatas. Toleramos para nao falhar em casos defensivos.
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
        throw invalidParams('include', 'each item must be one of: members, sprints, stats');
      }
    }

    return raw as GetProjectInclude[];
  }
}
