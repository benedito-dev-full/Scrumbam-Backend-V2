import { Injectable, NotFoundException } from '@nestjs/common';

import { ProjectsService } from '../../../../projects/projects.service';
import { PhaseTreeService } from '../../../../tasks/services/phase-tree.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/** Cap absoluto de profundidade (espelha MAX_TREE_DEPTH do PhaseTreeService). */
const MAX_DEPTH = 20;

/**
 * `GetTaskTreeCapability` — capability neutra `get_task_tree` (Onda 3, reads so-MCP).
 *
 * Casca fina READ-ONLY sobre `PhaseTreeService.buildTree` — a MESMA CTE
 * recursiva que o wrapper legado MCP (`src/mcp/tools/get-task-tree.tool.ts`)
 * ja usa (Pilar 2 — reuso, ZERO N+1). `inputSchema` espelha 1:1 o schema legado.
 *
 * Tenant isolation (ADR-V2-042 — defense-in-depth): resolve
 * `accessibleProjectIds`; scope vazio ou raiz fora do escopo lanca
 * `NotFoundException` com a MESMA mensagem anti-enumeration da tool legada,
 * ANTES de `buildTree`.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 3 (tasks-read)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 * @see ADR-V2-047 (arvore de fases via idPai / PhaseTreeService)
 */
@Injectable()
export class GetTaskTreeCapability implements Capability {
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
  readonly requiredScopes = ['tasks:read'] as const;

  constructor(
    private readonly phaseTreeService: PhaseTreeService,
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Monta a arvore hierarquica abaixo da raiz informada, com escopo de tenant.
   *
   * @param input - `{ taskId: string, maxDepth?: number, includeMetrics?: boolean }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com `{ root, totalNodes, maxDepthReached }`.
   * @throws {CapabilityError} `INVALID_INPUT` quando taskId/maxDepth/includeMetrics invalidos.
   * @throws {import('@nestjs/common').NotFoundException} Raiz nao acessivel ou inexistente.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const taskId = this.requiredString(input, 'taskId');
    this.assertBigIntParseable(taskId, 'taskId');

    const maxDepth = this.optionalMaxDepth(input);
    const includeMetrics = this.optionalBoolean(input, 'includeMetrics') ?? false;

    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      principal.actorEntidadeId,
    );

    if (accessibleProjectIds.length === 0) {
      throw new NotFoundException(`Task ${taskId} não encontrada`);
    }

    // findOne lanca NotFoundException com mensagem identica se a raiz estiver
    // fora do scope ou nao existir (anti-enumeration), ANTES de buildTree.
    await this.tasksService.findOne(taskId, accessibleProjectIds);

    const tree = await this.phaseTreeService.buildTree(BigInt(taskId), {
      ...(maxDepth !== undefined ? { maxDepth } : {}),
      includeMetrics,
    });

    return { data: tree };
  }

  private requiredString(input: Record<string, unknown>, field: string): string {
    const value = input[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', `${field}: required string`, { field });
    }
    return value;
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

  private optionalMaxDepth(input: Record<string, unknown>): number | undefined {
    const raw = input.maxDepth;
    if (raw === undefined || raw === null) {
      return undefined;
    }
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > MAX_DEPTH) {
      throw new CapabilityError('INVALID_INPUT', 'maxDepth: integer between 1 and 20 expected', {
        field: 'maxDepth',
      });
    }
    return raw;
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
}
