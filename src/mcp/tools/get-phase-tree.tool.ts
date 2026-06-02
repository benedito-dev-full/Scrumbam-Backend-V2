import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { PhaseTreeService } from '../../tasks/services/phase-tree.service';
import { TasksService } from '../../tasks/tasks.service';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  invalidParams,
  optionalRecord,
  parseBigIntParam,
  requiredString,
  textResult,
} from './tool-params';

/**
 * MCP tool `get_phase_tree` — retorna a árvore recursiva de uma fase/task.
 *
 * **Delega para `PhaseTreeService.buildTree`** com suporte a métrica
 * (Pilar 2 — reutiliza endpoint genérico TasksController + service). O
 * tenant gate é feito explicitamente em **defense-in-depth** (ADR-V2-042):
 * 1. Resolve `accessibleProjectIds` do usuário MCP
 * 2. Chama `TasksService.findOne(phaseId, accessibleProjectIds)` ANTES de
 *    `buildTree` — lança 404 (identicamente) se fase não acessível
 * 3. Delega para `PhaseTreeService.buildTree(phaseId, { maxDepth, includeMetrics })`
 *    que executa CTE recursiva (+CTE agregadora opcional para métricas)
 * 4. Retorna `PhaseTreeResponseDto` (raiz + totalNodes + maxDepthReached)
 *
 * **Métricas (includeMetrics=true):** status DONE/FAILED/EXECUTING/PENDING
 * contados em CTE única (ZERO N+1). Cada nó recebe agregação por fase.
 *
 * **Guardrail:** maxDepth clamped [1..20] para evitar recursões patológicas.
 *
 * **Performance:** 1-2 queries total (fase + tree ± metrics CTE), ~45-120ms.
 *
 * @see ADR-V2-047 (Fases 0-7: tree recursiva + métricas consolidadas)
 * @see PhaseTreeService — implementação da CTE recursiva + agregação
 * @see ADR-V2-042 (tenant isolation: findOne gate + defense-in-depth)
 * @see Pilar 2 (endpoints genéricos: TasksController + PhaseTreeService)
 *
 * @example
 * ```json
 * // Request: árvore da fase raiz 100, máx 2 níveis, com métricas
 * {"phaseId": "100", "maxDepth": 2, "includeMetrics": true}
 * // Response: { root: {...}, totalNodes: 15, maxDepthReached: 2 }
 * // (cada nó tem children[] + metrics: {total, done, failed, inProgress, percent})
 * ```
 */
@Injectable()
export class GetPhaseTreeTool implements McpTool {
  private readonly logger = new Logger(GetPhaseTreeTool.name);

  readonly name = 'get_phase_tree';
  readonly description =
    'Retorna arvore recursiva de uma fase ou task. Aceita maxDepth (1..20) e includeMetrics opcionais. Escopo automatico por tenant.';
  readonly inputSchema = {
    type: 'object',
    required: ['phaseId'],
    properties: {
      phaseId: { type: 'string', description: 'ID da fase ou task raiz (chave DTask)' },
      maxDepth: {
        type: 'integer',
        minimum: 1,
        maximum: 20,
        description: 'Profundidade maxima de descida (default 20)',
      },
      includeMetrics: {
        type: 'boolean',
        default: false,
        description:
          'Quando true, anexa metricas (total/done/failed/inProgress/percent) em cada no de fase. ZERO N+1 (CTE agregadora).',
      },
    },
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
    private readonly phaseTreeService: PhaseTreeService,
  ) {}

  /**
   * Constrói árvore recursiva com tenant gate via `findOne` + CTE.
   *
   * **Fluxo:**
   * 1. Valida `phaseId` (BigInt), `maxDepth` (1..20), `includeMetrics` (bool)
   * 2. Resolve `accessibleProjectIds` do usuário (ADR-V2-042)
   * 3. Tenant gate: `findOne(phaseId, accessibleProjectIds)` — 404 se fora scope
   * 4. CTE recursiva: `buildTree(phaseId, {maxDepth, includeMetrics})`
   *    - 1ª CTE lista fase raiz e descendentes via idPai
   *    - 2ª CTE (opcional): agrega status por fase_root se includeMetrics=true
   * 5. Montagem em memória: Map<id, PhaseTreeNodeDto> com 2 passadas
   * 6. Response: { root, totalNodes, maxDepthReached }
   *
   * **Métricas:** para cada nó, conta tasks filho com:
   *   - total: número de tasks na subárvore
   *   - done: idStatus = idClasse para status DONE (-444)
   *   - failed: idStatus = idClasse para status FAILED (-445)
   *   - inProgress: idStatus = idClasse para status EXECUTING (-443)
   *   - pending: total - done - failed - inProgress
   *   - percent: 100 * done / total (ou 0 se total=0)
   *
   * @throws {McpToolError} INVALID_PARAMS quando phaseId/maxDepth/includeMetrics inválidos
   * @throws {NotFoundException} Quando phaseId não acessível ou inexistente
   *   (404 genérico, sem leak de enumeration — ADR-V2-042)
   *
   * @example
   * ```json
   * // Request: árvore simples (maxDepth default, sem métricas)
   * {"phaseId": "100"}
   * // Response:
   * {
   *   "root": {
   *     "chave": "100",
   *     "nome": "Fase 1",
   *     "children": [
   *       {"chave": "101", "nome": "Feature A", "children": [], "metrics": null},
   *       {"chave": "102", "nome": "Feature B", "children": [], "metrics": null}
   *     ],
   *     "metrics": null
   *   },
   *   "totalNodes": 3,
   *   "maxDepthReached": 2
   * }
   * ```
   *
   * @example
   * ```json
   * // Request: árvore com métricas e profundidade limitada
   * {"phaseId": "100", "maxDepth": 2, "includeMetrics": true}
   * // Response: (similar, mas cada nó tem metrics: {total: 10, done: 7, failed: 1, ...})
   * ```
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = optionalRecord(params);
    const phaseId = requiredString(input, 'phaseId');
    parseBigIntParam(phaseId, 'phaseId');

    const maxDepthRaw = input.maxDepth;
    let maxDepth: number | undefined;
    if (maxDepthRaw !== undefined && maxDepthRaw !== null) {
      if (
        typeof maxDepthRaw !== 'number' ||
        !Number.isInteger(maxDepthRaw) ||
        maxDepthRaw < 1 ||
        maxDepthRaw > 20
      ) {
        throw invalidParams('maxDepth', 'integer between 1 and 20 expected');
      }
      maxDepth = maxDepthRaw;
    }

    const includeMetricsRaw = input.includeMetrics;
    let includeMetrics = false;
    if (includeMetricsRaw !== undefined && includeMetricsRaw !== null) {
      if (typeof includeMetricsRaw !== 'boolean') {
        throw invalidParams('includeMetrics', 'boolean expected');
      }
      includeMetrics = includeMetricsRaw;
    }

    // Tenant gate: resolve scope e exige que findOne retorne (lanca NotFound caso contrario).
    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      ctx.dEntidadeId,
    );

    if (accessibleProjectIds.length === 0) {
      // Mensagem identica ao caso "fase nao encontrada" — anti-enumeration.
      throw new NotFoundException(`Task ${phaseId} não encontrada`);
    }

    // findOne lanca NotFoundException com mensagem identica se phaseId
    // estiver fora do scope ou nao existir. PhaseTreeService tambem faz
    // sua propria checagem de idProject — defense-in-depth.
    await this.tasksService.findOne(phaseId, accessibleProjectIds);

    this.logger.debug(
      `get_phase_tree phaseId=${phaseId} maxDepth=${maxDepth ?? 'default'} includeMetrics=${includeMetrics}`,
    );

    const tree = await this.phaseTreeService.buildTree(BigInt(phaseId), {
      maxDepth,
      includeMetrics,
    });

    return textResult(tree);
  }
}
