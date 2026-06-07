import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { TaskResponseDto } from '../../tasks/dto/task-response.dto';
import { TasksService } from '../../tasks/tasks.service';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  invalidParams,
  optionalLimit,
  optionalRecord,
  optionalString,
  parseBigIntParam,
  requiredString,
  textResult,
} from './tool-params';

/**
 * Métricas de progresso de um bloco, calculadas em memória sobre as tasks
 * retornadas (a "página" atual). Segue a semântica do FRONTEND
 * (`calcBlockProgress`), NÃO a da CTE recursiva legada (`PhaseTreeService`).
 */
interface BlockMetrics {
  total: number;
  done: number;
  failed: number;
  inProgress: number;
  percent: number;
}

/** Status V3 considerados "concluídos" para fins de progresso (semântica do front). */
const DONE_STATUS = new Set(['DONE', 'VALIDATED', 'CANCELLED']);
/** Status V3 considerados "falha". */
const FAILED_STATUS = new Set(['FAILED', 'DISCARDED']);
/** Status V3 considerados "em andamento". */
const IN_PROGRESS_STATUS = new Set(['EXECUTING', 'VALIDATING']);

/**
 * MCP tool `list_block_tasks` — lista as tasks de um Bloco (lista plana + métricas).
 *
 * **Substitui a antiga `get_block_tree`.** No modelo PLANO do Scrumban V2 o
 * vínculo task→bloco é o campo JSON `DTask.dados.idBloco` (NÃO `idPai` — este
 * significa exclusivamente subtarefa). A árvore recursiva por `idPai` da tool
 * antiga não enxergava as tasks do bloco (que têm `idPai=null`), retornando
 * métricas zeradas. Esta tool corrige isso reusando o filtro `idBloco` já
 * existente em `TasksService.findMany` (Pilar 2 — endpoint genérico).
 *
 * **Fluxo (defense-in-depth — ADR-V2-042):**
 * 1. Resolve `accessibleProjectIds` do usuário MCP.
 * 2. Scope vazio → `NotFoundException` (mensagem idêntica anti-enumeration).
 * 3. `TasksService.findOne(blockId, accessibleProjectIds)` — 404 idêntico se o
 *    bloco não existir ou estiver fora do escopo (anti-enumeration). Descobre o
 *    `projectId` do bloco a partir do DTO retornado.
 * 4. `TasksService.findMany({ projectId, idBloco: blockId, limit, cursor })` —
 *    lista plana das tasks do bloco (inclui tasks `idPai=null`).
 * 5. Se `includeMetrics=true`, calcula `metrics` em memória sobre os `items`
 *    (status code já presente no DTO) — ZERO query extra.
 *
 * **Métricas (semântica do front, sobre a página corrente):**
 *   - `done` ∈ {DONE, VALIDATED, CANCELLED}
 *   - `failed` ∈ {FAILED, DISCARDED}
 *   - `inProgress` ∈ {EXECUTING, VALIDATING} (READY/INBOX → backlog, não inProgress)
 *   - `total` = nº de tasks retornadas
 *   - `percent` = total === 0 ? 0 : round(done / total * 100)
 *
 * **Nota de paginação:** as métricas refletem apenas a página carregada
 * (`limit`, default 20). Para blocos com mais tasks, ajuste `limit`/`cursor`.
 *
 * **Performance:** 2 queries (findOne + findMany), métricas O(n) em memória,
 * ZERO N+1.
 *
 * @see ADR-V2-042 (tenant isolation: findOne gate + defense-in-depth)
 * @see Pilar 2 (endpoints genéricos: reusar TasksService.findMany, não duplicar)
 *
 * @example
 * ```json
 * // Request: tasks do bloco 42 com métricas
 * {"blockId": "42", "includeMetrics": true, "limit": 20}
 * // Response:
 * {
 *   "blockId": "42",
 *   "items": [ /* TaskResponseDto[] — dados.idBloco === "42" *\/ ],
 *   "pagination": { "hasMore": false, "nextCursor": null },
 *   "metrics": { "total": 10, "done": 6, "failed": 1, "inProgress": 2, "percent": 60 }
 * }
 * ```
 */
@Injectable()
export class ListBlockTasksTool implements McpTool {
  private readonly logger = new Logger(ListBlockTasksTool.name);

  readonly name = 'list_block_tasks';
  readonly description =
    'Lista as tasks de um Bloco (via dados.idBloco) como lista plana, com paginacao e metricas opcionais (total/done/failed/inProgress/percent da pagina). Escopo automatico por tenant.';
  readonly inputSchema = {
    type: 'object',
    required: ['blockId'],
    properties: {
      blockId: { type: 'string', description: 'ID do Bloco (chave DTask idClasse=-200)' },
      includeMetrics: {
        type: 'boolean',
        default: false,
        description:
          'Quando true, anexa metricas de progresso (total/done/failed/inProgress/percent) calculadas sobre a pagina retornada. ZERO query extra.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      cursor: { type: 'string', description: 'Cursor de paginacao' },
    },
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Lista as tasks de um bloco com paginação por cursor e métricas opcionais.
   *
   * @param params - `{ blockId: string, includeMetrics?: boolean, limit?: number, cursor?: string }`
   * @param ctx - Contexto do usuário MCP (resolve tenant via `dEntidadeId`)
   * @returns `McpToolResult` com `{ blockId, items, pagination, metrics? }` serializado.
   *
   * @throws {McpToolError} INVALID_PARAMS quando blockId/includeMetrics/limit/cursor inválidos.
   * @throws {NotFoundException} Quando blockId não acessível ou inexistente
   *   (404 genérico, sem leak de enumeration — ADR-V2-042).
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = optionalRecord(params);
    const blockId = requiredString(input, 'blockId');
    parseBigIntParam(blockId, 'blockId');

    const includeMetricsRaw = input.includeMetrics;
    let includeMetrics = false;
    if (includeMetricsRaw !== undefined && includeMetricsRaw !== null) {
      if (typeof includeMetricsRaw !== 'boolean') {
        throw invalidParams('includeMetrics', 'boolean expected');
      }
      includeMetrics = includeMetricsRaw;
    }

    const cursor = optionalString(input, 'cursor');
    if (cursor) {
      parseBigIntParam(cursor, 'cursor');
    }

    const limit = optionalLimit(input);

    // Tenant gate (ADR-V2-042): resolve scope e exige que findOne retorne.
    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      ctx.dEntidadeId,
    );

    if (accessibleProjectIds.length === 0) {
      // Mensagem identica ao caso "bloco nao encontrado" — anti-enumeration.
      throw new NotFoundException(`Task ${blockId} não encontrada`);
    }

    // findOne lanca NotFoundException com mensagem identica se blockId estiver
    // fora do scope ou nao existir (anti-enumeration). Descobre o projeto do bloco.
    const block = await this.tasksService.findOne(blockId, accessibleProjectIds);

    this.logger.debug(
      `list_block_tasks blockId=${blockId} projectId=${block.projectId} includeMetrics=${includeMetrics} limit=${limit}`,
    );

    const result = await this.tasksService.findMany(
      {
        projectId: block.projectId,
        idBloco: blockId,
        ...(cursor ? { cursor } : {}),
        limit,
      },
      accessibleProjectIds,
    );

    return textResult({
      blockId,
      items: result.items,
      pagination: result.pagination,
      ...(includeMetrics ? { metrics: this.computeBlockMetrics(result.items) } : {}),
    });
  }

  /**
   * Calcula métricas de progresso em memória sobre as tasks da página.
   *
   * Usa a semântica do FRONTEND (`calcBlockProgress`) — ver buckets em
   * {@link DONE_STATUS}, {@link FAILED_STATUS}, {@link IN_PROGRESS_STATUS}.
   *
   * @param items - Tasks do bloco (cada uma com `status` code V3 string).
   * @returns Contagens por bucket + `percent` arredondado.
   */
  private computeBlockMetrics(items: TaskResponseDto[]): BlockMetrics {
    let done = 0;
    let failed = 0;
    let inProgress = 0;

    for (const item of items) {
      const status = item.status;
      if (DONE_STATUS.has(status)) {
        done += 1;
      } else if (FAILED_STATUS.has(status)) {
        failed += 1;
      } else if (IN_PROGRESS_STATUS.has(status)) {
        inProgress += 1;
      }
    }

    const total = items.length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);

    return { total, done, failed, inProgress, percent };
  }
}
