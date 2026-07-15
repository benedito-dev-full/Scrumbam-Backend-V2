import { Injectable, NotFoundException } from '@nestjs/common';

import { ProjectsService } from '../../../../projects/projects.service';
import { TaskResponseDto } from '../../../../tasks/dto/task-response.dto';
import { TasksService } from '../../../../tasks/tasks.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/**
 * Metricas de progresso de um bloco, calculadas em memoria sobre as tasks
 * retornadas (a "pagina" atual). Segue a semantica do FRONTEND
 * (`calcBlockProgress`) — espelha a tool legada.
 */
interface BlockMetrics {
  total: number;
  done: number;
  failed: number;
  inProgress: number;
  percent: number;
}

const DONE_STATUS = new Set(['DONE']);
const FAILED_STATUS = new Set(['FAILED']);
const IN_PROGRESS_STATUS = new Set(['EXECUTING']);

/**
 * `ListBlockTasksCapability` — capability neutra `list_block_tasks`
 * (Onda 3, reads so-MCP).
 *
 * Casca fina READ-ONLY sobre `TasksService.findOne` + `TasksService.findMany`
 * (filtro `idBloco`) — a MESMA composicao que o wrapper legado MCP
 * (`src/mcp/tools/list-block-tasks.tool.ts`) ja faz (Pilar 2).
 *
 * Tenant isolation (ADR-V2-042 — defense-in-depth): `findOne(blockId, ...)`
 * lanca `NotFoundException` identica se o bloco nao existir ou estiver fora
 * do escopo (anti-enumeration), ANTES de listar as tasks.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 3 (blocks-read)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class ListBlockTasksCapability implements Capability {
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
  readonly requiredScopes = ['tasks:read'] as const;

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Lista as tasks de um bloco com paginacao por cursor e metricas opcionais.
   *
   * @param input - `{ blockId: string, includeMetrics?: boolean, limit?: number, cursor?: string }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com `{ blockId, items, pagination, metrics? }`.
   * @throws {CapabilityError} `INVALID_INPUT` quando algum campo e invalido.
   * @throws {import('@nestjs/common').NotFoundException} `blockId` nao acessivel ou inexistente.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const blockId = this.requiredString(input, 'blockId');
    this.assertBigIntParseable(blockId, 'blockId');

    const includeMetrics = this.optionalBoolean(input, 'includeMetrics') ?? false;

    const cursor = this.optionalString(input, 'cursor');
    if (cursor) {
      this.assertBigIntParseable(cursor, 'cursor');
    }

    const limit = this.optionalLimit(input);

    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      principal.actorEntidadeId,
    );

    if (accessibleProjectIds.length === 0) {
      throw new NotFoundException(`Task ${blockId} não encontrada`);
    }

    const block = await this.tasksService.findOne(blockId, accessibleProjectIds);

    const result = await this.tasksService.findMany(
      {
        projectId: block.projectId,
        idBloco: blockId,
        ...(cursor ? { cursor } : {}),
        limit,
      },
      accessibleProjectIds,
    );

    return {
      data: {
        blockId,
        items: result.items,
        pagination: result.pagination,
        ...(includeMetrics ? { metrics: this.computeBlockMetrics(result.items) } : {}),
      },
    };
  }

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

  private requiredString(input: Record<string, unknown>, field: string): string {
    const value = input[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', `${field}: required string`, { field });
    }
    return value;
  }

  private optionalString(input: Record<string, unknown>, field: string): string | undefined {
    const value = input[field];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', `${field}: string expected`, { field });
    }
    return value;
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

  private optionalLimit(input: Record<string, unknown>): number {
    const value = input.limit;
    if (value === undefined || value === null) {
      return 20;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 50) {
      throw new CapabilityError('INVALID_INPUT', 'limit: integer between 1 and 50 expected', {
        field: 'limit',
      });
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
}
