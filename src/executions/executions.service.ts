import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import { EntidadeService } from '../entidades/entidades.service';
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

const PROJECT_MEMBERSHIP_CLASSES = [BigInt(-170), BigInt(-171), BigInt(-172), BigInt(-173)];

/**
 * Default timeout para o placeholder estruturado de `command` quando
 * o caller usa modo PROMPT sem passar `command` explicitamente.
 * 10min — mesmo default semântico do `IExecucaoData.command.timeoutMs`.
 */
const DEFAULT_PROMPT_MODE_TIMEOUT_MS = 600000;

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

    const membership = await this.prisma.dVincula.findFirst({
      where: {
        idClasse: { in: PROJECT_MEMBERSHIP_CLASSES },
        idLocEscritu: BigInt(projectId),
        idEntidade: userEntidadeId,
        excluido: false,
      },
    });
    if (!membership) {
      throw new ForbiddenException(`Usuario nao tem acesso ao projeto ${projectId}.`);
    }

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
