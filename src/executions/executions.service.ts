import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import { EntidadeService } from '../entidades/entidades.service';
import { ProjectRefService } from '../projects/project-ref.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { ClaudeRunnerService } from './claude-runner.service';
import { AgentTunnelService } from '../automation/agents/agent-tunnel.service';
import { AUTOMATION_CLASS_IDS } from '../automation/constants/automation-class-ids';
import { CommandValidatorService } from './services/command-validator.service';
import { PromptBuilderService } from './services/prompt-builder.service';
import { ExecutionQueueService } from './queues/execution-queue.service';
import { ExecuteCommandDto, StructuredCommandDto } from './dto/execute-command.dto';
import { ExecutionResponseDto, serializeExecution } from './dto/execution-response.dto';
import OperacaoExecucaoClaude from '../engine/lib/operacao/OperacaoExecucaoClaude';
import {
  EXECUTION_DEFAULT_TIMEOUT_SEC,
  executionTaskLockKey,
  NON_TERMINAL_STATUS_CODES,
  resolveExecutionTimeoutSec,
  toActiveExecutionStatus,
} from './constants/execution-lifecycle.const';

const PROJECT_MEMBERSHIP_CLASSES = [BigInt(-170), BigInt(-171), BigInt(-172), BigInt(-173)];

/**
 * Timeout do placeholder estruturado de `command` no modo PROMPT.
 * ADR-V2-082: coerente com a fonte única (`dados.timeoutSec` = 1800s) —
 * some a incoerência antiga 600000 ms (placeholder) × 1800 s (processor).
 */
const DEFAULT_PROMPT_MODE_TIMEOUT_MS = EXECUTION_DEFAULT_TIMEOUT_SEC * 1000;

/**
 * `code` do 409 de execução duplicada (ADR-V2-082). Exportado para os
 * adapters MCP/Nexus reconhecerem o conflito.
 */
export const EXECUTION_IN_PROGRESS_CODE = 'EXECUTION_IN_PROGRESS';

/**
 * Extrai `{ executionId, status }` do 409 `EXECUTION_IN_PROGRESS` lançado por
 * `ExecutionsService.execute` (ADR-V2-082). Usado pelos adapters MCP/Nexus
 * para mapear o conflito sem depender do formato HTTP.
 *
 * @param err - Erro capturado
 * @returns Dados do conflito, ou `null` se não for este 409
 *
 * @example
 * ```typescript
 * const c = parseExecutionInProgressConflict(err);
 * if (c) throw new McpToolError(INVALID_PARAMS, '...', { reason: 'execution_in_progress', ...c });
 * ```
 */
export function parseExecutionInProgressConflict(
  err: unknown,
): { executionId: string; status: string } | null {
  if (!(err instanceof ConflictException)) return null;
  const resp = err.getResponse() as { code?: unknown; details?: Record<string, unknown> } | string;
  if (typeof resp !== 'object' || resp === null || resp.code !== EXECUTION_IN_PROGRESS_CODE) {
    return null;
  }
  return {
    executionId: String(resp.details?.executionId ?? ''),
    status: String(resp.details?.status ?? ''),
  };
}

/**
 * Limites da transação que segura o advisory lock por task (Ciclo 2 / M1):
 * espera até 10s por conexão e até 60s pelo trabalho (prompt + Risk Gate + INSERT).
 */
const TASK_LOCK_MAX_WAIT_MS = 10_000;
const TASK_LOCK_TIMEOUT_MS = 60_000;

/** idClasse de execução (-301/-302/-303) — ADR-V2-006. */
const EXECUTION_RISK_CLASSES = [
  AUTOMATION_CLASS_IDS.EXEC_LOW,
  AUTOMATION_CLASS_IDS.EXEC_MEDIUM,
  AUTOMATION_CLASS_IDS.EXEC_HIGH,
];

/**
 * Marker simbólico colocado em `args[1]` do command estruturado quando
 * o caller usa modo PROMPT. O prompt REAL fica em `dados.prompt` (lido
 * pelo `execution-run.processor.ts:resolvePrompt`).
 *
 * Este marker NÃO contém NENHUM metacaractere — `CommandValidatorService.DANGEROUS_CHARS`
 * é `/[|&;\`$()<>]/`, portanto evitamos `< >` (que o teste REAL flagrou) E todos
 * os outros caracteres da regex. Usamos apenas `[a-z-]`. Fix do Reviewer
 * C1 (review-2026-05-26-prompt-builder.md) — Opção B.
 */
const PROMPT_MODE_COMMAND_PLACEHOLDER = 'task-built-prompt-placeholder';

@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger(ExecutionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entidadeService: EntidadeService,
    private readonly claudeRunnerService: ClaudeRunnerService,
    private readonly eventProducer: EventProducerService,
    private readonly commandValidator: CommandValidatorService,
    private readonly agentTunnelService: AgentTunnelService,
    private readonly executionQueue: ExecutionQueueService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly projectRef: ProjectRefService,
  ) {}

  /**
   * Cria uma execution Claude Code para um projeto.
   *
   * ADR-V2-049: aceita 3 modos (ver `ExecuteCommandDto`):
   *  - **PROMPT** (`{ taskId }`): backend monta prompt via `PromptBuilderService`,
   *    popula `dados.prompt` (canônico V2 — consumido pelo processor).
   *  - **COMMAND** (`{ command }`): contrato F13 legado — `command` literal.
   *  - **HÍBRIDO** (`{ taskId, command }`): debug — `command` vence, `taskId`
   *    fica em `dados.task.id` para audit.
   *
   * ADR-V2-006 / ADR-V2-048: Risk Level continua vencendo no `idClasse`
   * (-301/-302/-303). `taskType` é apenas metadado em `dados.taskType`.
   *
   * @param projectId - chave do DProject (string do BigInt)
   * @param dto - body validado pelo `ExecuteCommandDto`
   * @param userId - chave do DUserGroup do request (string do BigInt)
   * @param idempotencyKey - chave opcional do header Idempotency-Key
   * @returns Promise com `ExecutionResponseDto` serializado
   *
   * @throws {NotFoundException} Projeto / task inexistente
   * @throws {ForbiddenException} Usuário sem membership / task de outro projeto
   * @throws {UnprocessableEntityException} Agent inválido / túnel down
   * @throws {ConflictException} 409 `code:'EXECUTION_IN_PROGRESS'` +
   *   `details:{ reason:'execution_in_progress', executionId, status }`
   *   quando a task (`dto.taskId`) já tem execução não-terminal (ADR-V2-082) —
   *   ponto único que cobre REST + MCP + Nexus (ADR-V2-079)
   */
  async execute(
    projectId: string,
    dto: ExecuteCommandDto,
    userId: string,
    idempotencyKey?: string,
  ): Promise<ExecutionResponseDto> {
    // ADR-V2-049: DTO já garante que pelo menos um (taskId ou command) está
    // presente via @ValidateIf cross-field. Defense-in-depth (caller bypass):
    if (!dto.taskId && !dto.command) {
      throw new UnprocessableEntityException(
        'POST /projects/:id/execute exige `taskId` (modo PROMPT) OU `command` (modo COMMAND).',
      );
    }

    const project = await this.prisma.dProject.findFirst({
      where: { chave: BigInt(projectId), excluido: false },
    });
    if (!project) {
      throw new NotFoundException(`Projeto ${projectId} nao encontrado.`);
    }

    const userEntidadeId = await this.entidadeService.getEntidadeIdFromUserGroup(BigInt(userId));

    const existingExecution = idempotencyKey
      ? await this.findIdempotentExecution(projectId, userEntidadeId.toString(), idempotencyKey)
      : null;
    if (existingExecution) {
      return existingExecution;
    }

    // ADR-V2-058: RBAC do projeto em DVincula usa a chave da espelho (-158) ou
    // P legado (passthrough). Read-safe. (O -185 PROJECT_AGENT e o handle de
    // DPedido.idLocEscritu permanecem em P — fora do escopo da Fase 2.)
    const projectHandle = await this.projectRef.resolveEntidadeRef(BigInt(projectId));
    const membership = await this.prisma.dVincula.findFirst({
      where: {
        idClasse: { in: PROJECT_MEMBERSHIP_CLASSES },
        idLocEscritu: projectHandle,
        idEntidade: userEntidadeId,
        excluido: false,
      },
    });
    if (!membership) {
      throw new ForbiddenException(`Usuario nao tem acesso ao projeto ${projectId}.`);
    }

    // ADR-V2-082 (Ciclo 2 / M1): com taskId, trava anti-duplicata + criação rodam
    // sob `pg_advisory_xact_lock('exec-task:<taskId>')` — 2 requests simultâneos
    // da mesma task são serializados e o 2º enxerga a execução do 1º (409).
    if (dto.taskId) {
      const taskId = dto.taskId;
      return this.withTaskLock(taskId, async () => {
        await this.assertNoActiveExecutionForTask(taskId);
        return this.createExecution(projectId, dto, userId, userEntidadeId, idempotencyKey);
      });
    }
    return this.createExecution(projectId, dto, userId, userEntidadeId, idempotencyKey);
  }

  /**
   * Serializa por task (Ciclo 2 / M1). Abre uma transação interativa que só
   * segura `pg_advisory_xact_lock(hashtext('exec-task:<taskId>'))` enquanto `fn`
   * roda; `fn` usa as conexões normais (o Engine abre a própria transação de
   * INSERT, que COMMITA antes do lock ser liberado). Assim o 2º request da
   * mesma task só passa pela trava depois que a execução do 1º está visível.
   * Mesmo lock do `markRunning` do processor.
   *
   * @param taskId - DTask.chave
   * @param fn - Trabalho protegido (trava + criação)
   * @returns Resultado de `fn`
   */
  private async withTaskLock<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${executionTaskLockKey(taskId)}))`;
        return fn();
      },
      { maxWait: TASK_LOCK_MAX_WAIT_MS, timeout: TASK_LOCK_TIMEOUT_MS },
    );
  }

  /**
   * Monta o command/prompt, roda o Engine (calcula + grava) e enfileira LOW.
   * Extraído de `execute` para poder rodar sob {@link withTaskLock}.
   */
  private async createExecution(
    projectId: string,
    dto: ExecuteCommandDto,
    userId: string,
    userEntidadeId: bigint,
    idempotencyKey?: string,
  ): Promise<ExecutionResponseDto> {
    const correlationId = randomUUID();

    // ADR-V2-049: resolver modo (PROMPT / COMMAND / HÍBRIDO) e materializar
    // `structuredCommand`, `builtPrompt` e `builtTaskType` para passar ao Engine.
    const { structuredCommand, builtPrompt, builtTaskType, mode } =
      await this.resolveCommandAndPrompt(dto, projectId, userId, correlationId);

    // CommandValidator opera sobre o command estruturado (sempre presente após resolveCommandAndPrompt).
    this.commandValidator.validate(structuredCommand);

    const agent = await this.resolvePrimaryAgent(BigInt(projectId), dto.agentId);
    const agentId = agent.chave.toString();
    const commandText = this.toCommandText(structuredCommand);

    this.logger.log(
      `[${correlationId}] execute: project=${projectId} user=${userEntidadeId} agent=${agentId} mode=${mode} taskType=${builtTaskType ?? '-'} taskId=${dto.taskId ?? '-'}`,
    );

    const command = {
      text: commandText,
      executable: structuredCommand.executable,
      args: structuredCommand.args,
      cwd: structuredCommand.cwd,
      env: structuredCommand.env,
      timeoutMs: structuredCommand.timeoutMs,
    };

    const op = new OperacaoExecucaoClaude({
      usuario: userEntidadeId.toString(),
      classe: '-300',
      bd: this.prisma,
      projectId,
      agentId,
      taskId: dto.taskId,
      command,
      ...(builtPrompt !== undefined ? { prompt: builtPrompt } : {}),
      ...(builtTaskType !== undefined ? { taskType: builtTaskType } : {}),
      correlationId,
      agentTunnelService: this.claudeRunnerService,
      eventProducer: this.eventProducer,
    });

    await op.nova();
    op.pedidoCab.setPessoa(userEntidadeId);
    op.pedidoCab.setLocEscritu(BigInt(projectId));
    op.setExecucaoData({
      command,
      idempotency: idempotencyKey
        ? { key: idempotencyKey, userId: userEntidadeId.toString(), projectId }
        : undefined,
      rollbackOnFailure: dto.rollbackOnFailure === true,
      // ADR-V2-082: fonte ÚNICA de timeout — gravada uma vez, na criação.
      // Lida pelo processor (→ agente) e pelo sweeper de RUNNING (deadline).
      timeoutSec: resolveExecutionTimeoutSec(structuredCommand),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await op.calcula();

    const riskLevel = op.dados.risk?.level ?? 'LOW';
    op.setExecucaoData({
      riskLevelCode: this.toRiskLevelCode(riskLevel),
      statusCode:
        riskLevel === 'LOW'
          ? AUTOMATION_CLASS_IDS.EXEC_STATUS_QUEUED.toString()
          : AUTOMATION_CLASS_IDS.EXEC_STATUS_AWAITING_APPROVAL.toString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    if (riskLevel === 'LOW') {
      await op.gravarComoQueued();
    } else {
      await op.gravarComoAwaitingApproval(3600000);
    }

    const pedido = await this.prisma.dPedido.findFirst({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: { chave: (op as any).chcriacao },
      select: {
        chave: true,
        idClasse: true,
        idPessoa: true,
        dados: true,
        criadoEm: true,
        atualizadoEm: true,
      },
    });

    if (!pedido) {
      const response = serializeExecution({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chave: (op as any).chcriacao,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        idClasse: BigInt((op as any)._classeBase),
        idPessoa: userEntidadeId,
        dados: op.dados,
        criadoEm: new Date(),
        atualizadoEm: new Date(),
      });
      if (riskLevel === 'LOW') {
        await this.executionQueue.enqueueExecution({
          executionId: response.id,
          projectId,
          agentId,
        });
      }
      return response;
    }

    const response = serializeExecution({
      chave: pedido.chave,
      idClasse: pedido.idClasse,
      idPessoa: pedido.idPessoa,
      dados: pedido.dados,
      criadoEm: pedido.criadoEm,
      atualizadoEm: pedido.atualizadoEm,
    });
    if (riskLevel === 'LOW') {
      await this.executionQueue.enqueueExecution({
        executionId: response.id,
        projectId,
        agentId,
      });
    }
    return response;
  }

  /**
   * Recusa (409) disparar uma task que já tem execução não-terminal (ADR-V2-082).
   *
   * 1 query: execução -301/-302/-303 não-baixada da task com statusCode
   * QUEUED/AWAITING_APPROVAL/APPROVED/RUNNING (mais recente). Zumbis legados
   * (`baixado=false` + statusCode terminal) NÃO bloqueiam — o filtro em memória
   * repete o critério de status como defesa.
   *
   * @param taskId - DTask.chave (string)
   * @throws {ConflictException} body `{ statusCode:409, code:'EXECUTION_IN_PROGRESS',
   *   message, details:{ reason:'execution_in_progress', executionId,
   *   status:'running'|'queued'|'awaiting_approval' } }` (HttpExceptionFilter repassa `details`)
   */
  private async assertNoActiveExecutionForTask(taskId: string): Promise<void> {
    const active = await this.prisma.dPedido.findFirst({
      where: {
        idClasse: { in: EXECUTION_RISK_CLASSES },
        excluido: false,
        baixado: false,
        AND: [
          { dados: { path: ['task', 'id'], equals: taskId } },
          {
            OR: NON_TERMINAL_STATUS_CODES.map((code) => ({
              dados: { path: ['statusCode'], equals: code },
            })),
          },
        ],
      },
      select: { chave: true, dados: true },
      orderBy: { chave: 'desc' },
    });
    if (!active) return;

    const dados = (active.dados ?? {}) as Record<string, unknown>;
    const taskRef = (dados.task ?? null) as Record<string, unknown> | null;
    const statusCode = typeof dados.statusCode === 'string' ? dados.statusCode : undefined;
    if (taskRef?.id !== taskId || !statusCode || !NON_TERMINAL_STATUS_CODES.includes(statusCode)) {
      return;
    }

    const executionId = active.chave.toString();
    this.logger.warn(
      `execute_blocked_duplicate taskId=${taskId} activeExecutionId=${executionId} statusCode=${statusCode}`,
    );
    throw new ConflictException({
      statusCode: 409,
      code: EXECUTION_IN_PROGRESS_CODE,
      error: 'Conflict',
      message: `Task ${taskId} já tem uma execução em andamento (${executionId}).`,
      details: {
        reason: 'execution_in_progress',
        executionId,
        status: toActiveExecutionStatus(statusCode),
      },
    });
  }

  /**
   * Concatena `executable` + `args` em uma única linha textual (audit/log).
   * NÃO usado pelo agente VPS — apenas espelhado em `dados.command.text`
   * para legibilidade.
   */
  private toCommandText(command: StructuredCommandDto): string {
    return [command.executable, ...command.args].join(' ').trim();
  }

  /**
   * Resolve modo (PROMPT / COMMAND / HÍBRIDO), materializando:
   *   - `structuredCommand`: sempre presente (placeholder se modo PROMPT puro)
   *   - `builtPrompt`: presente apenas se PromptBuilder foi acionado
   *   - `builtTaskType`: presente apenas se PromptBuilder foi acionado
   *   - `mode`: rótulo log-friendly
   *
   * Regras ADR-V2-049:
   *  - Apenas `taskId`        → PROMPT  — builder + command placeholder.
   *  - Apenas `command`       → COMMAND — sem builder.
   *  - `taskId` + `command`   → HYBRID  — command vence; taskId fica como
   *                              metadado no Engine (dados.task.id), MAS prompt
   *                              NÃO é construído (debug puro).
   *
   * Risk Gate (ADR-V2-081): o placeholder do modo PROMPT serve APENAS ao
   * CommandValidator (validação de shell). A classificação de risco NÃO olha
   * só o placeholder — o validador DVFS chave 3 (v2) varre `dados.command.text`
   * E `dados.prompt` (o texto real que o Claude recebe), e o Engine eleva para
   * no mínimo MEDIUM se o script ativo não declarar a varredura do prompt.
   */
  private async resolveCommandAndPrompt(
    dto: ExecuteCommandDto,
    projectId: string,
    userId: string,
    correlationId: string,
  ): Promise<{
    structuredCommand: StructuredCommandDto;
    builtPrompt?: string;
    builtTaskType?: string;
    mode: 'prompt' | 'command' | 'hybrid';
  }> {
    // Caso 1 — command presente (COMMAND ou HÍBRIDO).
    if (dto.command) {
      const mode: 'command' | 'hybrid' = dto.taskId ? 'hybrid' : 'command';
      this.logger.debug(
        `[${correlationId}] resolveCommandAndPrompt: mode=${mode} (taskId=${dto.taskId ?? '-'})`,
      );
      return { structuredCommand: dto.command, mode };
    }

    // Caso 2 — apenas taskId (PROMPT). Builder é obrigatório.
    if (!dto.taskId) {
      // Já validado no execute() — guard belt-and-suspenders.
      throw new UnprocessableEntityException(
        'POST /projects/:id/execute exige `taskId` (modo PROMPT) OU `command` (modo COMMAND).',
      );
    }

    const built = await this.promptBuilder.buildFromTaskId(dto.taskId, projectId, userId);

    // Placeholder estruturado SIMBÓLICO: o prompt REAL vai em `dados.prompt`
    // (canônico V2 — consumido pelo processor em `execution-run.processor.ts:resolvePrompt`).
    // O `args[1]` aqui é um marker `<task-built-prompt>` SEM metacaracteres —
    // o CommandValidator (Pilar 1 / F13) opera sobre comandos de shell e
    // rejeita parênteses / backticks / `$()` / `;` / `|`. O texto natural do
    // prompt (com pontuação humana) NÃO deve passar por essa validação.
    // O agente VPS NÃO consome este command literalmente.
    //
    // Ver Reviewer fix C1 (review-2026-05-26-prompt-builder.md) — Opção B.
    const structuredCommand: StructuredCommandDto = {
      executable: 'claude',
      args: ['-p', PROMPT_MODE_COMMAND_PLACEHOLDER],
      timeoutMs: DEFAULT_PROMPT_MODE_TIMEOUT_MS,
    };

    this.logger.debug(
      `[${correlationId}] resolveCommandAndPrompt: mode=prompt taskId=${dto.taskId} taskType=${built.taskType} promptLen=${built.prompt.length}`,
    );

    return {
      structuredCommand,
      builtPrompt: built.prompt,
      builtTaskType: built.taskType,
      mode: 'prompt',
    };
  }

  private toRiskLevelCode(riskLevel: string): string {
    if (riskLevel === 'HIGH') return AUTOMATION_CLASS_IDS.RISK_LEVEL_HIGH.toString();
    if (riskLevel === 'MEDIUM') return AUTOMATION_CLASS_IDS.RISK_LEVEL_MEDIUM.toString();
    return AUTOMATION_CLASS_IDS.RISK_LEVEL_LOW.toString();
  }

  private async findIdempotentExecution(
    projectId: string,
    userId: string,
    idempotencyKey: string,
  ): Promise<ExecutionResponseDto | null> {
    const pedido = await this.prisma.dPedido.findFirst({
      where: {
        idClasse: {
          in: [
            AUTOMATION_CLASS_IDS.EXEC_LOW,
            AUTOMATION_CLASS_IDS.EXEC_MEDIUM,
            AUTOMATION_CLASS_IDS.EXEC_HIGH,
          ],
        },
        idLocEscritu: BigInt(projectId),
        excluido: false,
        dados: {
          path: ['idempotency', 'key'],
          equals: idempotencyKey,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      select: {
        chave: true,
        idClasse: true,
        idPessoa: true,
        dados: true,
        criadoEm: true,
        atualizadoEm: true,
      },
    });

    if (!pedido) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dados = (pedido.dados ?? {}) as any;
    if (dados?.idempotency?.userId !== userId || dados?.idempotency?.projectId !== projectId) {
      return null;
    }

    return serializeExecution({
      chave: pedido.chave,
      idClasse: pedido.idClasse,
      idPessoa: pedido.idPessoa,
      dados: pedido.dados,
      criadoEm: pedido.criadoEm,
      atualizadoEm: pedido.atualizadoEm,
    });
  }

  private async resolvePrimaryAgent(
    projectId: bigint,
    requestedAgentId?: string,
  ): Promise<{ chave: bigint }> {
    const link = await this.prisma.dVincula.findFirst({
      where: {
        idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT,
        idLocEscritu: projectId,
        tipo: 'primary',
        excluido: false,
      },
      include: {
        entidade: {
          select: { chave: true, dados: true },
        },
      },
    });

    if (!link?.entidade) {
      throw new UnprocessableEntityException(
        `Projeto ${projectId} nao tem agent primary vinculado.`,
      );
    }

    if (requestedAgentId && requestedAgentId !== link.entidade.chave.toString()) {
      throw new UnprocessableEntityException(
        `agentId informado nao e o primary do projeto ${projectId}.`,
      );
    }

    const dados = (link.entidade.dados ?? {}) as Record<string, unknown>;
    if (String(dados.statusCode) !== AUTOMATION_CLASS_IDS.AGENT_STATUS_ONLINE.toString()) {
      throw new UnprocessableEntityException('Agent primary nao esta online.');
    }

    const tunnelPort =
      typeof dados.tunnelPort === 'number'
        ? dados.tunnelPort
        : typeof dados.tunnelPort === 'string' && /^\d+$/.test(dados.tunnelPort)
          ? Number(dados.tunnelPort)
          : null;

    const probe = await this.agentTunnelService.probe(tunnelPort);
    if (!probe.tunnelOk) {
      throw new UnprocessableEntityException(
        `Tunnel do agent indisponivel: ${probe.error ?? 'TUNNEL_UNAVAILABLE'}`,
      );
    }

    return { chave: link.entidade.chave };
  }
}
