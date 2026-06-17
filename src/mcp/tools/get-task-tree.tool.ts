import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { PhaseTreeService } from '../../tasks/services/phase-tree.service';
import { TasksService } from '../../tasks/tasks.service';
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
 * MCP tool `get_task_tree` — árvore hierárquica abaixo de uma task/fase raiz.
 *
 * Wrapper fino sobre `PhaseTreeService.buildTree` (Pilar 2 — reuso da CTE
 * recursiva já otimizada, ZERO N+1). Retorna `{ root, totalNodes,
 * maxDepthReached }`; cada nó traz `{ id, nome, idClasse, idPai, status, depth,
 * children[], metrics }`. `metrics` só é populado em nós-fase (idClasse=-200)
 * quando `includeMetrics=true`; nós-task têm `metrics: null`.
 *
 * **Fluxo (defense-in-depth — ADR-V2-042):**
 * 1. `requireScope(ctx, tasks:read)`.
 * 2. Valida params (`taskId` BigInt obrigatório; `maxDepth` 1-20; `includeMetrics` boolean).
 * 3. Tenant gate: resolve `accessibleProjectIds`; scope vazio → 404 anti-enumeration.
 * 4. `tasksService.findOne(taskId, accessibleProjectIds)` — 404 idêntico se a
 *    raiz não existe ou está fora do escopo (anti-enumeration), ANTES de `buildTree`.
 *    (O `buildTree` já tem defense-in-depth por `idProject`; o gate prévio é
 *    obrigatório por consistência ADR-V2-042, igual a `list_block_tasks`.)
 * 5. `phaseTreeService.buildTree(BigInt(taskId), { maxDepth, includeMetrics })`.
 *
 * **Performance:** 1 query de gate (findOne) + CTE recursiva (1 query),
 * ZERO N+1. A CTE tem cap de profundidade (guardrail anti-DoS).
 *
 * NÃO usa Engine: leitura pura em tabela estrutural (DTask). Pilar 1 (Engine)
 * só aplica em DPedido idClasse=-300 (executions transacionais).
 *
 * @see ADR-V2-042 (tenant isolation: findOne gate + anti-enumeration)
 * @see ADR-V2-047 (árvore de fases via idPai / PhaseTreeService)
 * @see ADR-V2-068 (scope catalog — tasks:read)
 */
@Injectable()
export class GetTaskTreeTool implements McpTool {
  private readonly logger = new Logger(GetTaskTreeTool.name);

  /** Cap absoluto de profundidade (espelha MAX_TREE_DEPTH do PhaseTreeService). */
  private static readonly MAX_DEPTH = 20;

  readonly name = 'get_task_tree';
  readonly description =
    'Retorna a arvore hierarquica (fase->task->subtask) abaixo de uma task/fase raiz, com metricas opcionais por fase. Retorna { root, totalNodes, maxDepthReached }. Escopo automatico por tenant.';
  readonly inputSchema = {
    type: 'object',
    required: ['taskId'],
    properties: {
      taskId: { type: 'string', description: 'ID da task/fase raiz (chave DTask)' },
      maxDepth: {
        type: 'integer',
        minimum: 1,
        maximum: 20,
        description: 'Profundidade maxima (1-20). Default 20.',
      },
      includeMetrics: {
        type: 'boolean',
        default: false,
        description:
          'Quando true, anexa metricas (total/done/failed/inProgress/percent) nos nos-fase (idClasse=-200).',
      },
    },
  };

  constructor(
    private readonly phaseTreeService: PhaseTreeService,
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Monta a árvore hierárquica abaixo da raiz informada, com escopo de tenant.
   *
   * @param params - `{ taskId: string, maxDepth?: number, includeMetrics?: boolean }`
   * @param ctx - Contexto do usuário MCP (resolve tenant via `dEntidadeId`)
   * @returns `McpToolResult` com `{ root, totalNodes, maxDepthReached }` serializado.
   *
   * @throws {McpToolError} FORBIDDEN (-32002) quando scope `tasks:read` ausente
   * @throws {McpToolError} INVALID_PARAMS quando taskId/maxDepth/includeMetrics inválidos.
   * @throws {NotFoundException} Quando a raiz não é acessível ou inexistente.
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    // Gate de autorização (ADR-V2-068). Antes de qualquer query.
    requireScope(ctx, MCP_SCOPES.TASKS_READ);

    const input = assertRecord(params);
    const taskId = requiredString(input, 'taskId');
    parseBigIntParam(taskId, 'taskId');

    // maxDepth opcional — valida cedo para INVALID_PARAMS limpo (o service
    // faria clamp silencioso; preferimos rejeitar valores fora do range).
    let maxDepth: number | undefined;
    if (input.maxDepth !== undefined && input.maxDepth !== null) {
      const raw = input.maxDepth;
      if (
        typeof raw !== 'number' ||
        !Number.isInteger(raw) ||
        raw < 1 ||
        raw > GetTaskTreeTool.MAX_DEPTH
      ) {
        throw invalidParams('maxDepth', 'integer between 1 and 20 expected');
      }
      maxDepth = raw;
    }

    let includeMetrics = false;
    if (input.includeMetrics !== undefined && input.includeMetrics !== null) {
      if (typeof input.includeMetrics !== 'boolean') {
        throw invalidParams('includeMetrics', 'boolean expected');
      }
      includeMetrics = input.includeMetrics;
    }

    // Tenant gate (ADR-V2-042): resolve scope e exige que findOne retorne.
    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      ctx.dEntidadeId,
    );

    if (accessibleProjectIds.length === 0) {
      // Mensagem identica ao caso "task nao encontrada" — anti-enumeration.
      throw new NotFoundException(`Task ${taskId} não encontrada`);
    }

    // findOne lanca NotFoundException com mensagem identica se a raiz estiver
    // fora do scope ou nao existir (anti-enumeration), ANTES de buildTree.
    await this.tasksService.findOne(taskId, accessibleProjectIds);

    this.logger.debug(
      `get_task_tree taskId=${taskId} maxDepth=${maxDepth ?? 'default'} includeMetrics=${includeMetrics}`,
    );

    const tree = await this.phaseTreeService.buildTree(BigInt(taskId), {
      ...(maxDepth !== undefined ? { maxDepth } : {}),
      includeMetrics,
    });

    return textResult(tree);
  }
}
