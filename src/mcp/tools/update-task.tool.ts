import { Injectable, Logger } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { MCP_ERROR_CODES, MCP_SCOPES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { assertTaskNotLockedByOther } from './task-concurrency.guard';
import { McpTool, McpToolError, McpToolResult } from './tool.interface';
import {
  V3_STATUS_CODES,
  assertIso8601,
  assertRecord,
  invalidParams,
  optionalRecordField,
  parseBigIntParam,
  requireScope,
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
 *   `assigneeId` / `dueDate` / `idPai` / `idBloco` / `fields` (campos basicos).
 *   `dueDate`/`idPai`/`idBloco` seguem semantica ternaria
 *   (ausente=nao toca, null=remove, string=define); `idBloco` e `fields` sao
 *   empacotados numa UNICA chave `dados` (ADR-V2-065). `fields` (valores das
 *   colunas customizaveis da Lista): presente=merge (o service mescla por
 *   chave), ausente=nao toca; `null` DENTRO de `fields` limpa aquela coluna.
 *   A MCP nao valida o tipo dos valores — o backend valida server-side.
 * - `tasksService.updateStatus` — para `status` V3 (state machine + telemetria).
 *
 * Ordem de execucao quando multiplos campos sao enviados:
 *   update → updateStatus
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
    'Atualiza qualquer combinacao de campos de uma task (name, description, priority, assigneeId, status, dueDate, idPai, idBloco, fields). Para dueDate/idPai/idBloco: ausente=nao toca, null=remove, string=define. fields (valores das colunas customizaveis da Lista): presente=merge, ausente=nao toca, null DENTRO de fields limpa a coluna. Use update_status se for atualizar APENAS o status.';
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
      dueDate: {
        type: ['string', 'null'],
        description: 'Data limite ISO 8601; null remove; ausente nao toca',
      },
      idPai: {
        type: ['string', 'null'],
        description:
          'string=novo pai (subtarefa, ADR-V2-047); null=move para raiz; ausente=nao toca',
      },
      idBloco: {
        type: ['string', 'null'],
        description:
          'string=vincula ao Bloco (DTask -200); null=desvincula; ausente=nao toca (via dados.idBloco)',
      },
      fields: {
        type: 'object',
        additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
        description:
          'Valores das colunas customizaveis da Lista, chaveados por ColumnDef.key (ex: f_a1b2). Valores: string|number|boolean|null (null limpa o valor). Validados server-side contra o schema da Lista (DProject.tableFields).',
      },
    },
    // IMPORTANTE: NAO usar `anyOf`/`oneOf`/`allOf` na RAIZ do inputSchema.
    // Clientes MCP (Claude Code, Cursor, Gemini) rejeitam tools cujo input_schema
    // tem combinadores no topo e as descartam silenciosamente do tools/list —
    // foi exatamente o que mantinha esta tool invisivel na conexao. A regra
    // "pelo menos 1 campo de update" e aplicada no handler (ver abaixo).
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Handler do tools/call para `update_task`.
   *
   * Fluxo:
   * 1. Gate de autorização (ADR-V2-068).
   * 2. Valida params (assertRecord + taskId required + BigInt parseable).
   * 3. Extrai e valida campos opcionais com type-checking.
   * 4. Exige ao menos UM campo de update (caso contrario INVALID_PARAMS).
   *    Esta e a UNICA aplicacao da regra ">=1 campo" — o inputSchema NAO usa
   *    `anyOf` na raiz de proposito (clientes MCP descartam a tool nesse caso).
   * 5. Resolve `accessibleProjectIds` para o caller.
   * 6. Executa em ordem: update(basicos) → updateStatus.
   * 7. Re-hidrata via `findOne` e retorna snapshot final.
   *
   * Excecoes nao tratadas (`NotFoundException`, `BadRequestException`,
   * etc.) propagam ao router e sao tratadas conforme protocolo MCP.
   *
   * @param params - Argumentos da chamada (ver `inputSchema`)
   * @param ctx - Contexto MCP autenticado (contem `dEntidadeId`)
   * @returns Envelope MCP com snapshot final da task (apos todas as
   *   atualizacoes aplicadas em sequencia)
   * @throws {McpToolError} FORBIDDEN (-32002) quando scope `tasks:write` ausente
   * @throws {McpToolError} INVALID_PARAMS quando schema viola
   * @throws {NotFoundException} Task fora do scope ou inexistente
   * @throws {BadRequestException} Transicao de status invalida
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    // Gate de autorização (ADR-V2-068). Antes de qualquer query.
    requireScope(ctx, MCP_SCOPES.TASKS_WRITE);

    const input = assertRecord(params);
    const taskId = requiredString(input, 'taskId');
    parseBigIntParam(taskId, 'taskId');

    // Extracao + validacao individual de cada campo opcional.
    const name = this.extractOptionalString(input, 'name', 512);
    const description = this.extractOptionalString(input, 'description', 10000);
    const priority = this.extractOptionalEnum(input, 'priority', PRIORITY_VALUES);
    const assigneeId = this.extractOptionalStringOrNull(input, 'assigneeId');
    const status = this.extractOptionalEnum(input, 'status', V3_STATUS_CODES);

    // Novos campos com semantica ternaria (ausente/null/string).
    // dueDate: valida ISO 8601 quando string; idPai/idBloco: valida
    // BigInt-parseabilidade quando string. null e repassado ao service,
    // que o interpreta como "remover" (raiz/desvincular/sem prazo).
    const dueDate = this.extractOptionalStringOrNull(input, 'dueDate', { iso8601: true });
    const idPai = this.extractOptionalStringOrNull(input, 'idPai', { bigint: true });
    const idBloco = this.extractOptionalStringOrNull(input, 'idBloco', { bigint: true });

    // `fields`: presente=merge (repassado ao service, que mescla por chave),
    // ausente=nao toca. `null` DENTRO de fields (remocao de valor de coluna)
    // e repassado fiel — o backend o interpreta como "limpar".
    const fields = optionalRecordField(input, 'fields');

    const hasBasicUpdate =
      name !== undefined ||
      description !== undefined ||
      priority !== undefined ||
      assigneeId !== undefined ||
      dueDate !== undefined ||
      idPai !== undefined ||
      idBloco !== undefined ||
      fields !== undefined;
    const hasStatusUpdate = status !== undefined;

    if (!hasBasicUpdate && !hasStatusUpdate) {
      throw new McpToolError(MCP_ERROR_CODES.INVALID_PARAMS, 'Invalid params', {
        field: 'arguments',
        issue: 'at least one field to update is required',
      });
    }

    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      ctx.dEntidadeId,
    );

    // Trava de concorrência MCP (task #794): carrega o estado ATUAL da task
    // (também serve de tenant gate — findOne valida o scope) e recusa se ela
    // está EXECUTING com workSession aberta de OUTRO ator, ANTES de qualquer
    // mutação. update_timer é isento (decisão #3).
    const currentTask = await this.tasksService.findOne(taskId, accessibleProjectIds);
    assertTaskNotLockedByOther(currentTask, ctx.dEntidadeId);

    if (hasBasicUpdate) {
      this.logger.debug(`update_task ${taskId} — basicos`);
      // assigneeId === null e codificado como '' (string vazia), que o
      // TasksService.update interpreta como "limpar" (idAssignee = null).
      // Diferente de `undefined`, que significa "nao tocar".
      // dueDate/idPai: passar valor (string|null) direto — o service
      // distingue undefined/null/string (semantica ternaria).
      // idBloco/fields: empacotados numa UNICA chave `dados` — o service faz
      // merge superficial (null em idBloco desvincula; null DENTRO de fields
      // limpa a coluna). Dois spreads separados de `{ dados: ... }` se
      // sobrescreveriam, impossibilitando enviar idBloco E fields juntos.
      const dados: Record<string, unknown> = {
        ...(idBloco !== undefined ? { idBloco } : {}),
        ...(fields !== undefined ? { fields } : {}),
      };
      const basicDto: Record<string, unknown> = {
        ...(name !== undefined ? { nome: name } : {}),
        ...(description !== undefined ? { descricao: description } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(assigneeId !== undefined ? { assigneeId: assigneeId ?? '' } : {}),
        ...(dueDate !== undefined ? { dueDate } : {}),
        ...(idPai !== undefined ? { idPai } : {}),
        ...(Object.keys(dados).length > 0 ? { dados } : {}),
      };
      await this.tasksService.update(taskId, basicDto as never, accessibleProjectIds);
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
   * Helper privado: extrai um campo que aceita explicitamente `null`
   * (semantica ternaria: ausente=nao toca, null=remove, string=define).
   * Retorna `undefined` se ausente, `null` se explicitamente nulo, string
   * se valida.
   *
   * Validacao adicional opcional quando o valor e string:
   *   - `iso8601`: exige formato ISO 8601 (ex: dueDate)
   *   - `bigint`: exige string parseavel como BigInt (ex: idPai/idBloco)
   *
   * @param input - Objeto de argumentos da chamada
   * @param field - Nome do campo a extrair
   * @param opts - Validacoes adicionais para o caso string
   * @returns `undefined` (ausente) | `null` (remover) | string (definir)
   * @throws {McpToolError} INVALID_PARAMS quando o valor existe mas e invalido
   */
  private extractOptionalStringOrNull(
    input: Record<string, unknown>,
    field: string,
    opts?: { iso8601?: boolean; bigint?: boolean },
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
    if (opts?.iso8601) {
      assertIso8601(value, field);
    }
    if (opts?.bigint) {
      parseBigIntParam(value, field);
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
