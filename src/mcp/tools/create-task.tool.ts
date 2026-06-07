import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  assertRecord,
  invalidParams,
  maxStringLength,
  optionalIso8601,
  optionalString,
  parseBigIntParam,
  requiredString,
  textResult,
} from './tool-params';

/**
 * Enum de prioridade alinhado ao DTO canonico `CreateTaskDto`
 * (DTabela -421..-424 — LOW/MEDIUM/HIGH/URGENT).
 */
const PRIORITY_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

/**
 * Tool MCP `create_task` — wrapper fino sobre `TasksService.create`.
 *
 * Expoe a paridade de campos que o `CreateTaskDto` ja suporta, sem
 * duplicar logica de negocio (Pilar 2): priority/dueDate/idPai/
 * assigneeTeamId sao repassados diretos; `idBloco` e exposto como campo
 * top-level e traduzido internamente para `dados.idBloco` (ADR-V2-065),
 * evitando que o LLM injete chaves arbitrarias em `dados`.
 *
 * Validacoes (enum, ISO 8601, BigInt-parseabilidade) falham com
 * INVALID_PARAMS limpo ANTES de chegar no service (sem 500).
 *
 * Tenant isolation (ADR-V2-042): valida o acesso ao projeto via
 * `projectsService.findOne(projectId, ctx.dEntidadeId)` antes de criar.
 */
@Injectable()
export class CreateTaskTool implements McpTool {
  readonly name = 'create_task';
  readonly description =
    'Cria uma task no projeto informado. Campos opcionais: priority (LOW/MEDIUM/HIGH/URGENT), dueDate (ISO 8601), idPai (subtarefa), assigneeTeamId (time) e idBloco (vincula a um Bloco via dados.idBloco).';
  readonly inputSchema = {
    type: 'object',
    required: ['projectId', 'titulo'],
    properties: {
      projectId: { type: 'string' },
      titulo: { type: 'string', maxLength: 500 },
      descricao: { type: 'string', maxLength: 5000 },
      assigneeId: { type: 'string' },
      priority: {
        type: 'string',
        enum: [...PRIORITY_VALUES],
        description: 'Prioridade (LOW/MEDIUM/HIGH/URGENT)',
      },
      dueDate: {
        type: 'string',
        description: 'Data limite no formato ISO 8601 (ex: 2026-06-30)',
      },
      idPai: {
        type: 'string',
        description: 'ID da task pai (subtarefa, ADR-V2-047)',
      },
      assigneeTeamId: {
        type: 'string',
        description: 'ID do time responsavel (DEntidade -155)',
      },
      idBloco: {
        type: 'string',
        description: 'ID do Bloco (DTask -200) a vincular via dados.idBloco',
      },
    },
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Handler do tools/call para `create_task`.
   *
   * Fluxo:
   * 1. Valida params (projectId/titulo obrigatorios + limites de string).
   * 2. Extrai e valida campos opcionais (enum priority, ISO 8601 dueDate,
   *    BigInt-parseabilidade de assigneeId/idPai/assigneeTeamId/idBloco).
   * 3. Verifica acesso ao projeto (ADR-V2-042).
   * 4. Monta o DTO espalhando condicionalmente os campos presentes;
   *    `idBloco` vira `dados: { idBloco }`. Mantem `source: 'mcp'`.
   * 5. Delega para `tasksService.create`.
   *
   * @param params - Argumentos da chamada (ver `inputSchema`)
   * @param ctx - Contexto MCP autenticado (contem `dEntidadeId`)
   * @returns Envelope MCP com a task criada
   * @throws {McpToolError} INVALID_PARAMS quando algum campo viola o schema
   * @throws {NotFoundException} Projeto fora do scope ou inexistente
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = assertRecord(params);
    const projectId = requiredString(input, 'projectId');
    const assigneeId = optionalString(input, 'assigneeId');
    const titulo = requiredString(input, 'titulo');
    const descricao = optionalString(input, 'descricao');

    maxStringLength(titulo, 'titulo', 500);
    if (descricao) {
      maxStringLength(descricao, 'descricao', 5000);
    }

    parseBigIntParam(projectId, 'projectId');
    if (assigneeId) {
      parseBigIntParam(assigneeId, 'assigneeId');
    }

    // Novos campos (paridade com CreateTaskDto).
    const priority = this.extractPriority(input);
    const dueDate = optionalIso8601(input, 'dueDate');
    const idPai = optionalString(input, 'idPai');
    const assigneeTeamId = optionalString(input, 'assigneeTeamId');
    const idBloco = optionalString(input, 'idBloco');

    if (idPai) {
      parseBigIntParam(idPai, 'idPai');
    }
    if (assigneeTeamId) {
      parseBigIntParam(assigneeTeamId, 'assigneeTeamId');
    }
    if (idBloco) {
      parseBigIntParam(idBloco, 'idBloco');
    }

    await this.projectsService.findOne(projectId, ctx.dEntidadeId);

    const result = await this.tasksService.create(
      {
        projectId,
        nome: titulo,
        ...(descricao ? { descricao } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(priority ? { priority } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(idPai ? { idPai } : {}),
        ...(assigneeTeamId ? { assigneeTeamId } : {}),
        ...(idBloco ? { dados: { idBloco } } : {}),
        source: 'mcp',
      },
      ctx.dEntidadeId,
    );

    return textResult(result);
  }

  /**
   * Extrai `priority` opcional validando contra o enum canonico. Retorna
   * `undefined` quando ausente/null.
   */
  private extractPriority(input: Record<string, unknown>): string | undefined {
    const value = input.priority;
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string' || !PRIORITY_VALUES.includes(value as never)) {
      throw invalidParams('priority', `one of [${PRIORITY_VALUES.join('|')}] expected`);
    }
    return value;
  }
}
