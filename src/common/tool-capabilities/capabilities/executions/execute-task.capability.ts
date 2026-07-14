import { BadRequestException, Injectable } from '@nestjs/common';

import { EntidadeService } from '../../../../entidades/entidades.service';
import { ExecutionsService } from '../../../../executions/executions.service';
import { ProjectsService } from '../../../../projects/projects.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/**
 * Mapa idClasse (risco) -> string legivel (ADR-V2-006). Espelha o legado
 * `ExecuteTaskTool` byte-a-byte para preservar o shape de resposta.
 */
const RISK_CLASS_ID_MAP: Record<'LOW' | 'MEDIUM' | 'HIGH', string> = {
  LOW: '-301',
  MEDIUM: '-302',
  HIGH: '-303',
};

/**
 * Dica de polling identica a do wrapper legado — mantida como constante para
 * garantir paridade textual com `src/mcp/tools/execute-task.tool.ts`.
 */
const POLL_HINT =
  'Use get_task(taskId) para acompanhar o status V3 (EXECUTING → DONE/FAILED). ' +
  'Se status=awaiting_approval, a execução está pausada pelo Risk Gate (MED/HIGH) ' +
  'e exige POST /executions/:id/approve fora do MCP.';

/**
 * `ExecuteTaskCapability` — capability neutra `execute_task` (Onda 6, ADR-V2-079).
 *
 * A tool MAIS SENSIVEL da unificacao: dispara `claude -p` na VPS (DPedido
 * idClasse=-301/-302/-303 via `OperacaoExecucaoClaude` — Pilar 1). Custo real +
 * efeito externo irreversivel. Por isso e a ULTIMA onda, isolada, e no Nexus
 * fica atras de TRES travas cumulativas:
 *  1. **Feature-flag** `NEXUS_EXECUTE_TASK_ENABLED` (default OFF) — controla se
 *     esta capability e sequer REGISTRADA para a superficie Nexus (ver
 *     `ToolCapabilitiesModule`). Flag OFF => a tool nao existe no chat.
 *  2. **Scope** `executions:create` (ADR-V2-067) — DISTINTO de `tasks:write`:
 *     escrever uma task NAO concede queimar tokens de IA. No Nexus deriva do
 *     RBAC (`RoleResolverService`: so MANAGER/ADMIN o recebe); default nega.
 *  3. **Confirmacao explicita** `confirm:true` no input — o modelo so pode
 *     dispara-la APOS o usuario confirmar no turno (instruido no system-prompt).
 *     Ausente/false => `INVALID_INPUT` (o modelo nao dispara sozinho).
 *
 * Casca FINA sobre `ExecutionsService.execute` — a MESMA chamada de service que
 * o wrapper MCP legado (`src/mcp/tools/execute-task.tool.ts`) faz. Esta
 * capability NAO fala com Prisma nem instancia o Engine: o `ExecutionsService`
 * e dono do `OperacaoExecucaoClaude` (Pilar 1 preservado). O fluxo espelha o
 * legado byte-a-byte:
 *  1. Valida `confirm` (trava propria do Nexus — ver acima).
 *  2. Valida `taskId` (BigInt-parseavel).
 *  3. Tenant isolation (ADR-V2-042): `tasksService.findOne(taskId)` +
 *     `projectsService.findOne(task.projectId, principal.actorEntidadeId)` —
 *     `actorEntidadeId` SEMPRE do auth, nunca de input da IA.
 *  4. Resolve DUserGroup.chave via `entidadeService.getUserGroupIdFromEntidade`.
 *  5. Delega a `executionsService.execute(projectId, { taskId }, userGroupId)` —
 *     Risk Gate (DVFS chave 3) roda DENTRO de `op.calcula()`, ZERO duplicacao.
 *  6. Retorna o MESMO shape do legado: `{ executionId, taskId, projectId,
 *     status, riskLevel, riskClassId, createdAt, pollHint }`.
 *
 * **MCP inalterado (golden verde):** o MCP continua servindo `execute_task`
 * pelo wrapper legado (`McpRouterService` roteia `executeTaskTool` diretamente,
 * SEM passar pelo `McpCapabilityAdapter`). Esta capability serve EXCLUSIVAMENTE
 * a superficie Nexus. Por isso o `inputSchema` aqui inclui `confirm` (contrato
 * do chat) sem tocar o wire MCP (`tools.schema.json` / golden permanecem com
 * apenas `taskId`).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 6
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-066 (async fire-and-poll), ADR-V2-067 (scope executions:create)
 * @see ADR-V2-005 (OperacaoExecucaoClaude / Pilar 1), ADR-V2-006 (Risk via idClasse)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class ExecuteTaskCapability implements Capability {
  readonly name = 'execute_task';
  readonly description =
    'Dispara uma execução Claude Code (IA) para a task informada. Async fire-and-poll: retorna {executionId, status=QUEUED|AWAITING_APPROVAL, riskLevel}. Use get_task(taskId) para acompanhar (EXECUTING → DONE/FAILED). Risk MED/HIGH retorna awaiting_approval (não é erro). Requer scope MCP "executions:create". AÇÃO SENSÍVEL: só dispare com confirm=true APÓS o usuário confirmar explicitamente no chat.';
  readonly inputSchema = {
    type: 'object',
    required: ['taskId', 'confirm'],
    properties: {
      taskId: {
        type: 'string',
        description: 'ID da DTask a executar (chave da DTask, BigInt-parseável)',
      },
      confirm: {
        type: 'boolean',
        description:
          'Confirmação explícita do usuário. DEVE ser true e só pode ser definido APÓS o usuário confirmar no chat que quer disparar a execução na VPS (custo real + efeito externo). Ausente ou false => a execução é recusada.',
      },
    },
    additionalProperties: false,
  };
  readonly requiredScopes = ['executions:create'] as const;

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
    private readonly executionsService: ExecutionsService,
    private readonly entidadeService: EntidadeService,
  ) {}

  /**
   * Executa (dispara) uma task. Aplica a trava de confirmacao ANTES de qualquer
   * query, valida input, confirma o tenant (task + projeto), resolve o
   * DUserGroup e delega ao `ExecutionsService`. Ver JSDoc da classe para o
   * fluxo completo e as tres travas do Nexus.
   *
   * @param input - Argumentos neutros (ver `inputSchema`): `taskId` + `confirm`.
   * @param principal - Ator neutro. `actorEntidadeId` SEMPRE do auth (ADR-V2-042).
   * @returns `CapabilityResult` com `{ executionId, taskId, projectId, status,
   *   riskLevel, riskClassId, createdAt, pollHint }` (shape do legado).
   * @throws {CapabilityError} `INVALID_INPUT` quando `confirm` != true, `taskId`
   *   ausente/nao-BigInt, ou o Risk Gate rejeita o command (`reason:
   *   'risk_gate_blocked'`).
   * @throws {import('@nestjs/common').NotFoundException} Task/projeto fora do
   *   tenant ou inexistente (propagada).
   * @throws {import('@nestjs/common').ForbiddenException} Sem membership no
   *   projeto da task (propagada).
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    // 1. Trava de confirmacao explicita (o modelo nao dispara sozinho).
    if (input.confirm !== true) {
      throw new CapabilityError(
        'INVALID_INPUT',
        'execute_task requires explicit user confirmation (confirm=true) — confirme com o usuário antes de disparar a execução.',
        { field: 'confirm', reason: 'confirmation_required' },
      );
    }

    // 2. Validacao de input.
    const taskId = this.requiredString(input, 'taskId');
    this.assertBigIntParseable(taskId, 'taskId');

    // 3. Tenant isolation (ADR-V2-042). findOne confirma existencia da task;
    // projectsService.findOne confirma membership do ator no projeto.
    const task = await this.tasksService.findOne(taskId);
    await this.projectsService.findOne(task.projectId, principal.actorEntidadeId);

    // 4. Resolve DUserGroup.chave a partir da DEntidade.chave do ator.
    const userGroupId = await this.entidadeService.getUserGroupIdFromEntidade(
      principal.actorEntidadeId,
    );

    // 5. Delega ao service de F6 (Pilar 1). Modo PROMPT puro: so taskId.
    try {
      const execution = await this.executionsService.execute(
        task.projectId,
        { taskId },
        userGroupId.toString(),
      );

      return {
        data: {
          executionId: execution.id,
          taskId,
          projectId: task.projectId,
          status: execution.approval.status,
          riskLevel: execution.riskLevel,
          riskClassId: RISK_CLASS_ID_MAP[execution.riskLevel],
          createdAt: execution.createdAt,
          pollHint: POLL_HINT,
        },
      };
    } catch (err) {
      // Defesa em profundidade (ADR-V2-066): CommandValidator pode rejeitar o
      // command estruturado. Traduz para INVALID_INPUT com reason
      // 'risk_gate_blocked' (mesmo mapeamento semantico do wrapper legado).
      if (err instanceof BadRequestException) {
        const detail =
          typeof err.message === 'string' ? err.message : 'Risk Gate rejected command';
        throw new CapabilityError('INVALID_INPUT', 'Risk Gate blocked execution', {
          reason: 'risk_gate_blocked',
          detail,
        });
      }
      // NotFoundException / ForbiddenException e demais erros propagam inalterados.
      throw err;
    }
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
}
