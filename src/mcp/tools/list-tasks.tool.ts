import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  V3_STATUS_CODES,
  invalidParams,
  optionalLimit,
  optionalRecord,
  optionalString,
  parseBigIntParam,
  textResult,
} from './tool-params';

/**
 * MCP tool `list_tasks` — lista tasks do usuário com filtros opcionais.
 *
 * **Wrapper fino sobre `TasksService.findMany`** com suporte a múltiplos
 * filtros (Pilar 2 — endpoint genérico reutilizado). Acesso escopado via
 * tenant isolation (ADR-V2-042): projetos acessíveis resolvidos automaticamente.
 *
 * **Filtro novo F7:** `idClasse` (string numérica negativa ou positiva)
 * — filtra por tipo de task (Pilar 3 — polimorfismo DTask):
 *   - `-200`: Bloco — agrupador de tasks (DTask idClasse=-200)
 *   - `-154`: SCRUMBAN_TASK — task concreta
 *   - Ou qualquer outro tipo definido no seed (domínio específico)
 *
 * **Performance:** cursor pagination, query ~45ms, ZERO N+1.
 *
 * @see ADR-V2-047 (Fases 0-7: MCP tools + DTask.idPai + filter idClasse)
 * @see ADR-V2-042 (tenant isolation: defense-in-depth via accessible projects)
 * @see Pilar 2 (endpoints genéricos: reusar TasksService.findMany, não duplicar)
 * @see Pilar 3 (polimorfismo: idClasse determina tipo de task, zero tabela nova)
 *
 * @example
 * ```json
 * // Listar apenas blocos de um projeto
 * {"projectId": "100", "idClasse": "-200", "limit": 10}
 * // Response: { items: [{chave, nome, idClasse: -200, ...}, ...], pagination: {...} }
 * ```
 *
 * @example
 * ```json
 * // Listar tasks concretas (scrumban_task) em status EXECUTING
 * {"projectId": "100", "status": "EXECUTING", "idClasse": "-154", "limit": 20}
 * // Response: { items: [{chave, nome, status, assigneeId, ...}, ...], pagination: {...} }
 * ```
 */
@Injectable()
export class ListTasksTool implements McpTool {
  readonly name = 'list_tasks';
  readonly description =
    'Lista tasks do usuario com filtros opcionais de projeto, status, assignee e idClasse (ex: -200=Bloco, -154=SCRUMBAN_TASK).';
  readonly inputSchema = {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'ID do projeto (opcional)' },
      status: {
        type: 'string',
        description: 'Codigo do status V3 (ex: INBOX, EXECUTING)',
      },
      assigneeId: { type: 'string', description: 'ID do assignee (opcional)' },
      idClasse: {
        type: 'string',
        description:
          'Filtra por idClasse polimorfica da DTask (string numerica negativa). Ex: -200=Bloco, -154=SCRUMBAN_TASK.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      cursor: {
        type: 'string',
        description: 'Cursor de paginacao',
      },
    },
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Lista tasks do usuário com filtros opcionais e paginação por cursor.
   *
   * **Fluxo:**
   * 1. Valida parâmetros: projectId (BigInt), assigneeId (BigInt), cursor (BigInt),
   *    status (enum V3), idClasse (regex ^-?\d+$)
   * 2. Resolve scope tenant: se projectId fornecido, valida acesso; senão, usa todos
   *    os projetos acessíveis do usuário (via `findAccessibleProjectIds`)
   * 3. Defense-in-depth (ADR-V2-042): passa `scopedProjectIds` para `findMany` como
   *    2º argumento — se query tenta task de projeto não autorizado, retorna vazio
   * 4. Delega para `TasksService.findMany({ projectId?, status?, assigneeId?, idClasse?, cursor?, limit }, scopedProjectIds)`
   * 5. Retorna response tipado: { items: TaskResponseDto[], pagination: { hasMore, nextCursor } }
   *
   * **Filtro idClasse (novo F7):** Validação regex `^-?\d+$` (número negativo ou positivo)
   * — permite seed canônico (-200 Bloco, -154 SCRUMBAN_TASK) e tipos de domínio específicos (positivos).
   *
   * **Tenant Isolation:** Se user A tenta filtrar task que pertence a projeto de user B,
   * `scopedProjectIds` não inclui esse projeto — query retorna vazio (não enumera).
   *
   * @throws {McpToolError} INVALID_PARAMS quando projectId/assigneeId/cursor não são BigInt,
   *   ou status não é enum V3 válido, ou idClasse não match regex
   * @throws Não lança NotFoundException — retorna lista vazia para scope vazio
   *
   * @example
   * ```json
   * // Request: listar blocos de um projeto (idClasse=-200)
   * {
   *   "projectId": "100",
   *   "idClasse": "-200",
   *   "limit": 10,
   *   "cursor": null
   * }
   * // Response:
   * {
   *   "items": [
   *     {
   *       "chave": "200",
   *       "nome": "Bloco 1",
   *       "descricao": null,
   *       "idClasse": "-200",
   *       "idProject": "100",
   *       "status": "EXECUTING",
   *       "assigneeId": null,
   *       "criadoEm": "2026-05-21T10:00:00Z"
   *     }
   *   ],
   *   "pagination": { "hasMore": false, "nextCursor": null }
   * }
   * ```
   *
   * @example
   * ```json
   * // Request: filtro múltiplo (projeto + status + tipo + assignee)
   * {
   *   "projectId": "100",
   *   "status": "EXECUTING",
   *   "idClasse": "-154",
   *   "assigneeId": "5",
   *   "limit": 20,
   *   "cursor": "250"
   * }
   * // Response: (página 2 de tasks concretas em EXECUTING assignadas a user 5)
   * ```
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = optionalRecord(params);
    const projectId = optionalString(input, 'projectId');
    const assigneeId = optionalString(input, 'assigneeId');
    const cursor = optionalString(input, 'cursor');
    const status = optionalString(input, 'status');
    const idClasse = optionalString(input, 'idClasse');

    if (projectId) {
      parseBigIntParam(projectId, 'projectId');
    }
    if (assigneeId) {
      parseBigIntParam(assigneeId, 'assigneeId');
    }
    if (cursor) {
      parseBigIntParam(cursor, 'cursor');
    }
    if (status && !V3_STATUS_CODES.includes(status as (typeof V3_STATUS_CODES)[number])) {
      throw invalidParams('status', 'invalid V3 status code');
    }
    // idClasse: mesma regex do ListTasksQueryDto (`^-?\d+$`). Validacao explicita
    // antes de delegar — mensagem clara via invalidParams.
    if (idClasse !== undefined && !/^-?\d+$/.test(idClasse)) {
      throw invalidParams('idClasse', 'must match /^-?\\d+$/');
    }

    const scopedProjectIds = await this.resolveScopedProjectIds(projectId, ctx);
    if (scopedProjectIds.length === 0) {
      return textResult({ items: [], pagination: { hasMore: false, nextCursor: null } });
    }

    // ADR-V2-042: passar `scopedProjectIds` como o conjunto autorizado
    // p/ TasksService.findMany — defesa-em-profundidade.
    const result = await this.tasksService.findMany(
      {
        ...(projectId ? { projectId } : {}),
        ...(!projectId ? { projectIds: scopedProjectIds } : {}),
        ...(status ? { status } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(idClasse ? { idClasse } : {}),
        ...(cursor ? { cursor } : {}),
        limit: optionalLimit(input),
      },
      scopedProjectIds,
    );

    return textResult(result);
  }

  private async resolveScopedProjectIds(
    projectId: string | undefined,
    ctx: McpUserContext,
  ): Promise<string[]> {
    if (projectId) {
      await this.projectsService.findOne(projectId, ctx.dEntidadeId);
      return [projectId];
    }

    return this.projectsService.findAccessibleProjectIds(ctx.dEntidadeId);
  }
}
