import { Injectable, Logger } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { MCP_ERROR_CODES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolError, McpToolResult } from './tool.interface';
import {
  V3_STATUS_CODES,
  assertRecord,
  invalidParams,
  parseBigIntParam,
  requiredString,
  textResult,
} from './tool-params';

/**
 * Enum de prioridade alinhado ao DTO canonico `UpdateTaskDto` e seed
 * de DTabela -421..-424 (LOW/MEDIUM/HIGH/URGENT).
 */
const PRIORITY_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
type PriorityValue = (typeof PRIORITY_VALUES)[number];

/**
 * Tool MCP `update_task` — atualizacao parcial de task (orquestracao
 * condicional sobre 3 metodos do TasksService).
 *
 * Decisao de design (Strategist §4.1): UMA tool com todos os campos
 * opcionais (excluindo `taskId` que e obrigatorio), evitando inflar
 * `tools/list` com tools-quase-iguais. Internamente roteia para:
 *
 * - `tasksService.update` — para `name` / `description` / `priority` /
 *   `assigneeId` (campos basicos).
 * - `tasksService.updateSprint` — para `sprintId` (transferencia entre sprints).
 * - `tasksService.updateStatus` — para `status` V3 (state machine + telemetria).
 *
 * Ordem de execucao quando multiplos campos sao enviados:
 *   update → updateSprint → updateStatus
 *
 * Status por ultimo minimiza side-effects de transicao invalida em
 * estado intermediario (ex: assignee atualizado antes da transicao
 * para EXECUTING garante que o movedBy refletido em telemetria seja
 * consistente). O estado FINAL e sempre re-hidratado via
 * `tasksService.findOne` para entregar uma snapshot consistente.
 *
 * Tenant isolation (ADR-V2-042):
 *   Resolve `accessibleProjectIds` UMA vez e propaga para cada call
 *   subsequente. Cada metodo do TasksService valida que `task.idProject`
 *   esta no scope autorizado (anti enumeration).
 *
 * `update_status` legada PERMANECE — alguns LLMs vao usa-la
 * diretamente. Coexistencia OK; descriptions distintas evitam
 * confusao.
 *
 * @example
 * ```json
 * // Request JSON-RPC: atualizar nome e status simultaneamente
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "method": "tools/call",
 *   "params": {
 *     "name": "update_task",
 *     "arguments": {
 *       "taskId": "123",
 *       "name": "Novo titulo",
 *       "status": "READY"
 *     }
 *   }
 * }
 * ```
 *
 * @see GetTaskTool (Task #1 — leitura simples)
 * @see UpdateStatusTool (legada — atualiza APENAS status)
 */
@Injectable()
export class UpdateTaskTool implements McpTool {
  private readonly logger = new Logger(UpdateTaskTool.name);

  readonly name = 'update_task';
  readonly description =
    'Atualiza qualquer combinacao de campos de uma task (name, description, priority, assigneeId, sprintId, status). Use update_status se for atualizar APENAS o status.';
  readonly inputSchema = {
    type: 'object',
    required: ['taskId'],
    properties: {
      taskId: { type: 'string' },
      name: { type: 'string', maxLength: 512 },
      description: { type: 'string', maxLength: 10000 },
      priority: {
        type: 'string',
        enum: [...PRIORITY_VALUES],
        description: 'Prioridade (LOW/MEDIUM/HIGH/URGENT)',
      },
      assigneeId: {
        type: ['string', 'null'],
        description: 'ID do assignee (DEntidade) ou null para remover',
      },
      status: {
        type: 'string',
        enum: [...V3_STATUS_CODES],
        description:
          'Codigo V3: INBOX|READY|EXECUTING|DONE|FAILED|CANCELLED|DISCARDED|VALIDATING|VALIDATED',
      },
      sprintId: {
        type: 'string',
        description: 'ID do sprint (DTabela -400) para mover a task',
      },
    },
    anyOf: [
      { required: ['name'] },
      { required: ['description'] },
      { required: ['priority'] },
      { required: ['assigneeId'] },
      { required: ['status'] },
      { required: ['sprintId'] },
    ],
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Handler do tools/call para `update_task`.
   *
   * Fluxo:
   * 1. Valida params (assertRecord + taskId required + BigInt parseable).
   * 2. Extrai e valida campos opcionais com type-checking.
   * 3. Exige ao menos UM campo de update (caso contrario INVALID_PARAMS —
   *    redundancia em relacao ao `anyOf` do schema, mas necessaria caso
   *    o cliente envie sem validar contra o schema).
   * 4. Resolve `accessibleProjectIds` para o caller.
   * 5. Executa em ordem: update(basicos) → updateSprint → updateStatus.
   * 6. Re-hidrata via `findOne` e retorna snapshot final.
   *
   * Excecoes nao tratadas (`NotFoundException`, `BadRequestException`,
   * etc.) propagam ao router e sao tratadas conforme protocolo MCP.
   *
   * @param params - Argumentos da chamada (ver `inputSchema`)
   * @param ctx - Contexto MCP autenticado (contem `dEntidadeId`)
   * @returns Envelope MCP com snapshot final da task (apos todas as
   *   atualizacoes aplicadas em sequencia)
   * @throws {McpToolError} INVALID_PARAMS quando schema viola
   * @throws {NotFoundException} Task fora do scope ou inexistente
   * @throws {BadRequestException} Transicao de status invalida
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = assertRecord(params);
    const taskId = requiredString(input, 'taskId');
    parseBigIntParam(taskId, 'taskId');

    // Extracao + validacao individual de cada campo opcional.
    const name = this.extractOptionalString(input, 'name', 512);
    const description = this.extractOptionalString(input, 'description', 10000);
    const priority = this.extractOptionalEnum(input, 'priority', PRIORITY_VALUES);
    const assigneeId = this.extractOptionalStringOrNull(input, 'assigneeId');
    const status = this.extractOptionalEnum(input, 'status', V3_STATUS_CODES);
    const sprintId = this.extractOptionalString(input, 'sprintId');

    const hasBasicUpdate =
      name !== undefined ||
      description !== undefined ||
      priority !== undefined ||
      assigneeId !== undefined;
    const hasSprintUpdate = sprintId !== undefined;
    const hasStatusUpdate = status !== undefined;

    if (!hasBasicUpdate && !hasSprintUpdate && !hasStatusUpdate) {
      throw new McpToolError(MCP_ERROR_CODES.INVALID_PARAMS, 'Invalid params', {
        field: 'arguments',
        issue: 'at least one field to update is required',
      });
    }

    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      ctx.dEntidadeId,
    );

    if (hasBasicUpdate) {
      this.logger.debug(`update_task ${taskId} — basicos`);
      // assigneeId === null e codificado como '' (string vazia), que o
      // TasksService.update interpreta como "limpar" (idAssignee = null).
      // Diferente de `undefined`, que significa "nao tocar".
      const basicDto: Record<string, unknown> = {
        ...(name !== undefined ? { nome: name } : {}),
        ...(description !== undefined ? { descricao: description } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(assigneeId !== undefined ? { assigneeId: assigneeId ?? '' } : {}),
      };
      await this.tasksService.update(taskId, basicDto as never, accessibleProjectIds);
    }

    if (hasSprintUpdate) {
      this.logger.debug(`update_task ${taskId} — sprint=${sprintId}`);
      await this.tasksService.updateSprint(
        taskId,
        { sprintId: sprintId as string },
        accessibleProjectIds,
      );
    }

    if (hasStatusUpdate) {
      this.logger.debug(`update_task ${taskId} — status=${status}`);
      await this.tasksService.updateStatus(
        taskId,
        { status: status as string, movedBy: ctx.dEntidadeId.toString() },
        ctx.dEntidadeId,
        accessibleProjectIds,
      );
    }

    const finalTask = await this.tasksService.findOne(taskId, accessibleProjectIds);
    return textResult(finalTask);
  }

  /**
   * Helper privado: extrai campo opcional como string, valida tipo e
   * maxLength. Retorna `undefined` se ausente/null.
   */
  private extractOptionalString(
    input: Record<string, unknown>,
    field: string,
    maxLength?: number,
  ): string | undefined {
    const value = input[field];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw invalidParams(field, 'string expected');
    }
    if (maxLength !== undefined && value.length > maxLength) {
      throw invalidParams(field, `max length ${maxLength} exceeded`);
    }
    return value;
  }

  /**
   * Helper privado: extrai `assigneeId` que aceita explicitamente `null`
   * (semantica: "remover assignee"). Retorna `undefined` se ausente,
   * `null` se explicitamente nulo, string se valida.
   */
  private extractOptionalStringOrNull(
    input: Record<string, unknown>,
    field: string,
  ): string | null | undefined {
    if (!(field in input)) {
      return undefined;
    }
    const value = input[field];
    if (value === null) {
      return null;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw invalidParams(field, 'string or null expected');
    }
    return value;
  }

  /**
   * Helper privado: extrai campo opcional como enum string. Retorna
   * `undefined` se ausente, ou string validada contra o conjunto.
   */
  private extractOptionalEnum<T extends string>(
    input: Record<string, unknown>,
    field: string,
    allowed: readonly T[],
  ): T | undefined {
    const value = input[field];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      throw invalidParams(field, `one of [${allowed.join('|')}] expected`);
    }
    return value as T;
  }

  /** Exporta o conjunto de prioridades para reuso em testes. */
  static readonly PRIORITY_VALUES: readonly PriorityValue[] = PRIORITY_VALUES;
}
