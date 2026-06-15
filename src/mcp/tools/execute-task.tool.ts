import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { EntidadeService } from '../../entidades/entidades.service';
import { ExecutionsService } from '../../executions/executions.service';
import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { MCP_ERROR_CODES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolError, McpToolResult } from './tool.interface';
import {
  assertRecord,
  maxStringLength,
  optionalString,
  parseBigIntParam,
  requireScope,
  requiredString,
  textResult,
} from './tool-params';

/**
 * Scope MCP exigido para disparar execuções de IA via `execute_task`
 * (ADR-V2-067). Distinto de `tasks:write` — uma key com permissão de
 * escrever tasks NÃO pode automaticamente queimar tokens de IA.
 */
const EXECUTIONS_CREATE_SCOPE = 'executions:create';

/**
 * Tool MCP `execute_task` — wrapper fino sobre `ExecutionsService.execute`,
 * que por sua vez instancia `OperacaoExecucaoClaude` (Pilar 1 — F6) para
 * persistir DPedido idClasse=-301/-302/-303 sob workflow canônico Devari.
 *
 * Contrato (ADR-V2-066, ADR-V2-049):
 *  - Modo PROMPT puro: `{ taskId }` (mínimo). Backend monta o prompt via
 *    `PromptBuilderService` a partir da DTask (título + descrição + meta).
 *  - `prompt` opcional: hoje NÃO é encaminhado ao service — o caminho oficial
 *    de prompt customizado em F6 é via DTask (PromptBuilder). Foi mantido no
 *    contrato MCP para forward-compat com possível modo PROMPT explícito;
 *    quando presente é apenas logado (audit) e ignorado pelo service. Uso
 *    real do prompt customizado: editar a `descricao` da task via `update_task`.
 *  - `contextHint` opcional: idem `prompt` — reservado, ainda não consumido
 *    pelo PromptBuilder. Logado para audit.
 *
 * Fluxo (assíncrono — fire-and-poll, ADR-V2-066):
 *  1. `requireScope(ctx, 'executions:create')` — sem o scope dedicado → FORBIDDEN
 *     (-32002). Tools legadas (15) NÃO usam scope check; `execute_task` é a
 *     primeira consumidora desse helper (ADR-V2-067).
 *  2. Tenant isolation (ADR-V2-042): `tasksService.findOne(taskId)` (que já valida
 *     existência) + `projectsService.findOne(task.projectId, ctx.dEntidadeId)`
 *     (que valida membership do usuário no projeto via DVincula -158).
 *  3. Resolve `userId` (DUserGroup.chave) a partir de `ctx.dEntidadeId`
 *     (DEntidade.chave) via `EntidadeService.getUserGroupIdFromEntidade` —
 *     `ExecutionsService.execute` espera DUserGroup.chave e internamente faz
 *     a volta com `getEntidadeIdFromUserGroup`.
 *  4. Delega a `executionsService.execute(projectId, { taskId }, userId)` —
 *     que dispara Risk Gate (DVFS chave 3), classifica em -301/-302/-303,
 *     persiste e enfileira (LOW) ou marca `awaiting_approval` (MED/HIGH).
 *  5. Risk HIGH NÃO bloqueia a chamada — o resultado retorna `approval.status:
 *     'awaiting_approval'` (ADR-V2-006). O cliente sabe pelo response que precisa
 *     do fluxo de aprovação (POST /executions/:id/approve, fora do escopo MCP).
 *
 * Erros possíveis do service (mapeados):
 *  - `NotFoundException` (projeto/task inexistente) → propagado (já é HTTP 404
 *    equivalente; o router MCP traduz para o code apropriado).
 *  - `ForbiddenException` (sem membership no projeto) → propagado idêntico.
 *  - `BadRequestException` do `CommandValidatorService`: em modo PROMPT o
 *    placeholder estruturado é seguro por construção, mas defesa-em-profundidade
 *    mapeia para `INVALID_PARAMS reason='risk_gate_blocked'`.
 *
 * Auditoria dupla: o router MCP já emite `MCP_CALL` (DEvento -495); o Engine
 * F6 emite `EXECUTION_REQUESTED` (DEvento -300+) — ZERO mudança no audit aqui.
 *
 * @example
 * ```jsonrpc
 * // Request (cliente MCP)
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "method": "tools/call",
 *   "params": {
 *     "name": "execute_task",
 *     "arguments": { "taskId": "402" }
 *   }
 * }
 * ```
 *
 * @example
 * ```jsonrpc
 * // Response (envelope textResult — payload JSON-stringified)
 * {
 *   "content": [{
 *     "type": "text",
 *     "text": "{\"executionId\":\"1000123\",\"taskId\":\"402\",\"projectId\":\"100\",\"status\":\"QUEUED\",\"riskLevel\":\"LOW\",\"riskClassId\":\"-301\",\"createdAt\":\"2026-06-15T14:30:00.000Z\",\"pollHint\":\"Use get_task(taskId) ...\"}"
 *   }]
 * }
 * ```
 *
 * @see ADR-V2-066 (async fire-and-poll para `execute_task`)
 * @see ADR-V2-067 (scope MCP `executions:create`)
 * @see ADR-V2-005 (OperacaoExecucaoClaude / Pilar 1)
 * @see ADR-V2-006 (Risk via idClasse -301/-302/-303)
 * @see ADR-V2-042 (tenant isolation MCP)
 * @see ADR-V2-049 (PromptBuilder canônico — modo PROMPT)
 */
@Injectable()
export class ExecuteTaskTool implements McpTool {
  private readonly logger = new Logger(ExecuteTaskTool.name);

  readonly name = 'execute_task';
  readonly description =
    'Dispara uma execução Claude Code (IA) para a task informada. Async fire-and-poll: retorna {executionId, status=QUEUED|AWAITING_APPROVAL, riskLevel}. Use get_task(taskId) para acompanhar (EXECUTING → DONE/FAILED). Risk MED/HIGH retorna awaiting_approval (não é erro). Requer scope MCP "executions:create".';
  readonly inputSchema = {
    type: 'object',
    required: ['taskId'],
    properties: {
      taskId: {
        type: 'string',
        description: 'ID da DTask a executar (chave da DTask, BigInt-parseável)',
      },
      prompt: {
        type: 'string',
        maxLength: 8000,
        description:
          'RESERVADO (forward-compat): hoje o backend monta o prompt a partir da DTask via PromptBuilderService (ADR-V2-049). Para customizar o prompt, edite a descrição da task via update_task. Se informado, este campo é apenas logado para audit.',
      },
      contextHint: {
        type: 'string',
        maxLength: 2000,
        description:
          'RESERVADO (forward-compat): contexto adicional para o PromptBuilder (ex: "foque em testes"). Ainda não consumido — logado para audit.',
      },
    },
    additionalProperties: false,
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
    private readonly executionsService: ExecutionsService,
    private readonly entidadeService: EntidadeService,
  ) {}

  /**
   * Handler do `tools/call` para `execute_task`. Vide JSDoc da classe para o
   * fluxo completo. Wrapper fino — ZERO Prisma direto, ZERO instanciação de
   * Engine, ZERO duplicação de Risk Gate.
   *
   * @param params - Argumentos da chamada (ver `inputSchema`)
   * @param ctx - Contexto MCP autenticado (dEntidadeId + scopes)
   * @returns Envelope MCP `textResult` com `{ executionId, taskId, projectId,
   *   status, riskLevel, riskClassId, createdAt, pollHint }`
   *
   * @throws {McpToolError} FORBIDDEN (-32002) quando o scope `executions:create`
   *   não está na key autenticada
   * @throws {McpToolError} INVALID_PARAMS (-32602) quando `taskId` ausente/
   *   não-BigInt, ou quando `prompt`/`contextHint` excedem limites
   * @throws {McpToolError} INVALID_PARAMS com `reason='risk_gate_blocked'` se
   *   o `CommandValidatorService` rejeitar o command estruturado (defesa em
   *   profundidade — em modo PROMPT o placeholder é seguro por construção)
   * @throws {NotFoundException} Propagado quando task/projeto fora do tenant
   *   ou inexistente (ADR-V2-042)
   * @throws {ForbiddenException} Propagado quando usuário não tem membership
   *   no projeto da task (DVincula -170..-173)
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = assertRecord(params);

    // 1. Gate de autorização (ADR-V2-067). Antes de qualquer query.
    requireScope(ctx, EXECUTIONS_CREATE_SCOPE);

    // 2. Validação de input.
    const taskIdStr = requiredString(input, 'taskId');
    parseBigIntParam(taskIdStr, 'taskId');

    const prompt = optionalString(input, 'prompt');
    if (prompt !== undefined) {
      maxStringLength(prompt, 'prompt', 8000);
    }

    const contextHint = optionalString(input, 'contextHint');
    if (contextHint !== undefined) {
      maxStringLength(contextHint, 'contextHint', 2000);
    }

    // 3. Tenant isolation (ADR-V2-042). `tasksService.findOne` confirma a
    // existência da task; `projectsService.findOne(_, dEntidadeId)` confirma
    // que o usuário tem membership no projeto (DVincula sobre a espelho -158).
    const task = await this.tasksService.findOne(taskIdStr);
    await this.projectsService.findOne(task.projectId, ctx.dEntidadeId);

    // 4. Resolve DUserGroup.chave a partir de DEntidade.chave do contexto.
    // ExecutionsService.execute espera `userId` no formato DUserGroup.chave
    // (faz a volta com getEntidadeIdFromUserGroup internamente).
    const userGroupId = await this.entidadeService.getUserGroupIdFromEntidade(ctx.dEntidadeId);

    if (prompt !== undefined || contextHint !== undefined) {
      // Log de audit — campos reservados ainda não consumidos pelo PromptBuilder.
      this.logger.log(
        `[execute_task] taskId=${taskIdStr} hasPrompt=${prompt !== undefined} hasContextHint=${contextHint !== undefined} — reservados (PromptBuilder ignora; ver JSDoc)`,
      );
    }

    // 5. Delega ao service de F6. Modo PROMPT puro: só taskId.
    // Risk Gate (DVFS chave 3) roda DENTRO de op.calcula() — ZERO duplicação.
    try {
      const execution = await this.executionsService.execute(
        task.projectId,
        { taskId: taskIdStr },
        userGroupId.toString(),
      );

      // ADR-V2-006: idClasse final reflete o risco classificado (-301/-302/-303).
      // approval.status reflete o gate: 'queued' (LOW) ou 'awaiting_approval' (MED/HIGH).
      const riskClassIdMap: Record<'LOW' | 'MEDIUM' | 'HIGH', string> = {
        LOW: '-301',
        MEDIUM: '-302',
        HIGH: '-303',
      };

      return textResult({
        executionId: execution.id,
        taskId: taskIdStr,
        projectId: task.projectId,
        status: execution.approval.status,
        riskLevel: execution.riskLevel,
        riskClassId: riskClassIdMap[execution.riskLevel],
        createdAt: execution.createdAt,
        pollHint:
          'Use get_task(taskId) para acompanhar o status V3 (EXECUTING → DONE/FAILED). ' +
          'Se status=awaiting_approval, a execução está pausada pelo Risk Gate (MED/HIGH) ' +
          'e exige POST /executions/:id/approve fora do MCP.',
      });
    } catch (err) {
      // Defesa em profundidade (ADR-V2-066): o CommandValidator pode rejeitar
      // o command estruturado (placeholder do modo PROMPT é seguro por construção,
      // mas evolução do contrato pode ativar este caminho). Mapeia para INVALID_PARAMS
      // com reason='risk_gate_blocked' em vez de propagar 500.
      if (err instanceof BadRequestException) {
        const responseMessage =
          typeof err.message === 'string' ? err.message : 'Risk Gate rejected command';
        throw new McpToolError(MCP_ERROR_CODES.INVALID_PARAMS, 'Risk Gate blocked execution', {
          reason: 'risk_gate_blocked',
          detail: responseMessage,
        });
      }
      throw err;
    }
  }
}
