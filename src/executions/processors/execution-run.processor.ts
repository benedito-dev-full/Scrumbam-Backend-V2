import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { AgentTunnelService } from '../../automation/agents/agent-tunnel.service';
import { AUTOMATION_CLASS_IDS } from '../../automation/constants/automation-class-ids';
import {
  ExecutionWorktree,
  ExecutionWorktreeService,
} from '../../automation/runtime/execution-worktree.service';
import {
  ExecutionRuntimeLogService,
} from '../../automation/runtime/execution-runtime-log.service';
import {
  RemoteAgentRuntime,
  RemoteExecutionClient,
  RemoteStructuredCommand,
} from '../../automation/runtime/remote-execution-client';
import { RollbackService } from '../../automation/runtime/rollback.service';
import { GithubPrService } from '../../automation/github/github-pr.service';
import { EXECUTION_QUEUE_NAME } from '../queues/execution-queue.constants';
import { ExecutionRunJobData } from '../queues/execution-queue.service';

const EXECUTION_CLASSES = [
  AUTOMATION_CLASS_IDS.EXEC_LOW,
  AUTOMATION_CLASS_IDS.EXEC_MEDIUM,
  AUTOMATION_CLASS_IDS.EXEC_HIGH,
];
const MAX_OUTPUT_BYTES = 1024 * 1024;
const INTERNAL_TIMEOUT_MS = 300000;

interface ExecutionPedido {
  chave: bigint;
  idClasse: bigint;
  idLocEscritu: bigint | null;
  dados: Record<string, unknown>;
}

interface RuntimeProject {
  chave: bigint;
  dados: Record<string, unknown>;
}

interface RuntimeAgent {
  chave: bigint;
  dados: Record<string, unknown>;
}

@Injectable()
@Processor(EXECUTION_QUEUE_NAME, { concurrency: 3 })
export class ExecutionRunProcessor extends WorkerHost {
  private readonly logger = new Logger(ExecutionRunProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventProducer: EventProducerService,
    private readonly agentTunnel: AgentTunnelService,
    private readonly remoteClient: RemoteExecutionClient,
    private readonly logService: ExecutionRuntimeLogService,
    private readonly worktreeService: ExecutionWorktreeService,
    private readonly rollbackService: RollbackService,
    private readonly githubPrService: GithubPrService,
  ) {
    super();
  }

  async process(job: Job<ExecutionRunJobData>): Promise<void> {
    const { executionId, projectId, agentId } = job.data;
    const logContext = this.logService.createContext();
    const pedido = await this.loadExecution(executionId);
    if (!pedido) return;

    const dados = pedido.dados;
    const correlationId = this.asString(this.asRecord(dados.audit)?.correlationId)
      ?? `execution-${executionId}`;

    const [project, agent] = await Promise.all([
      this.loadProject(projectId),
      this.loadAgent(agentId),
    ]);

    if (!project || !agent) {
      await this.failExecution(
        pedido,
        correlationId,
        'PROJECT_OR_AGENT_NOT_FOUND',
      );
      return;
    }

    let runtimeAgent: RemoteAgentRuntime;
    try {
      runtimeAgent = this.resolveRuntimeAgent(agent);
      const probe = await this.agentTunnel.probe(runtimeAgent.tunnelPort);
      if (!probe.tunnelOk) {
        await this.failExecution(
          pedido,
          correlationId,
          probe.error ?? 'TUNNEL_UNAVAILABLE',
        );
        return;
      }

      const transitioned = await this.markRunning(executionId);
      if (!transitioned) {
        this.logger.warn(`execution_run_skip_stale executionId=${executionId}`);
        return;
      }

      await this.safeEmit(
        'execution.started',
        { executionId, projectId, agentId },
        correlationId,
      );

      await this.runExecution({
        pedido,
        project,
        agent: runtimeAgent,
        correlationId,
        logContext,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failExecution(pedido, correlationId, message);
    }
  }

  private async runExecution(input: {
    pedido: ExecutionPedido;
    project: RuntimeProject;
    agent: RemoteAgentRuntime;
    correlationId: string;
    logContext: ReturnType<ExecutionRuntimeLogService['createContext']>;
  }): Promise<void> {
    const executionId = input.pedido.chave.toString();
    const projectId = input.project.chave.toString();
    const dados = input.pedido.dados;
    const command = this.asRecord(dados.command);
    const rollbackOnFailure = dados.rollbackOnFailure === true;
    let worktree: ExecutionWorktree | null = null;

    try {
      worktree = await this.worktreeService.prepare(
        {
          executionId,
          projectId,
          correlationId: input.correlationId,
          agent: input.agent,
          projectAutomation: this.resolveProjectAutomation(input.project.dados),
          command: {
            executable: this.asString(command?.executable),
            args: this.asStringArray(command?.args),
          },
        },
        input.logContext,
      );

      const headBefore = await this.runGitText(
        input,
        worktree,
        ['rev-parse', 'HEAD'],
      );

      const result = await this.remoteClient.execute(
        {
          executionId,
          projectId,
          correlationId: input.correlationId,
          agent: input.agent,
          workspace: worktree.workspace,
          command: this.userCommand(command),
        },
        input.logContext,
      );

      if (result.exitCode !== 0) {
        const timeoutStatus = result.timedOut
          ? AUTOMATION_CLASS_IDS.EXEC_STATUS_EXPIRED
          : AUTOMATION_CLASS_IDS.EXEC_STATUS_FAILED;
        if (rollbackOnFailure) {
          await this.rollbackService.rollbackWorktree(
            { executionId, projectId, correlationId: input.correlationId, agent: input.agent, worktree },
            input.logContext,
          );
        }
        await this.finishExecution(input.pedido.chave, {
          statusCode: timeoutStatus.toString(),
          claude: {
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            outputTruncated: result.outputTruncated,
            finishedAt: new Date().toISOString(),
            durationMs: result.durationMs,
          },
        });
        await this.emitFinished(
          result.timedOut ? 'execution.expired' : 'execution.failed',
          executionId,
          projectId,
          input.agent.agentId,
          input.correlationId,
        );
        return;
      }

      const status = await this.runGitText(input, worktree, ['status', '--porcelain']);
      const filesChanged = status
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0).length;

      let headAfter = headBefore.trim();
      let pushedAt: string | undefined;
      const commitMessage = `chore: scrumban execution ${executionId}`;

      if (filesChanged > 0 && worktree.isolated) {
        await this.runGit(input, worktree, ['add', '-A']);
        await this.runGit(input, worktree, ['commit', '-m', commitMessage]);
        headAfter = (await this.runGitText(input, worktree, ['rev-parse', 'HEAD'])).trim();
        await this.runGit(input, worktree, ['push', 'origin', worktree.branch]);
        pushedAt = new Date().toISOString();
      }

      await this.finishExecution(input.pedido.chave, {
        statusCode: AUTOMATION_CLASS_IDS.EXEC_STATUS_SUCCESS.toString(),
          claude: {
            exitCode: 0,
            stdout: result.stdout,
            stderr: result.stderr,
            outputTruncated: result.outputTruncated,
            finishedAt: new Date().toISOString(),
            durationMs: result.durationMs,
          },
        git: {
          headBefore: headBefore.trim(),
          headAfter,
          branch: worktree.branch,
          commitMessage,
          pushedAt,
          filesChanged,
        },
      });

      await this.githubPrService.openPrIfNeeded({
        executionId,
        projectId,
        agentId: input.agent.agentId,
        correlationId: input.correlationId,
        projectDados: input.project.dados,
        branch: worktree.branch,
        baseBranch: worktree.baseBranch,
        commandText: this.asString(command?.text) ?? '',
        filesChanged,
        diffNonEmpty: filesChanged > 0 && headAfter !== headBefore.trim(),
      });

      await this.emitFinished('execution.succeeded', executionId, projectId, input.agent.agentId, input.correlationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.safeRecordSystem({
        executionId,
        projectId,
        agentId: input.agent.agentId,
        correlationId: input.correlationId,
        line: message,
        code: 'EXECUTION_RUNTIME_FAILED',
      });

      if (rollbackOnFailure && worktree) {
        await this.rollbackService.rollbackWorktree(
          { executionId, projectId, correlationId: input.correlationId, agent: input.agent, worktree },
          input.logContext,
        );
      }

      await this.finishExecution(input.pedido.chave, {
        statusCode: AUTOMATION_CLASS_IDS.EXEC_STATUS_FAILED.toString(),
        claude: {
          exitCode: -1,
          stderr: message,
          finishedAt: new Date().toISOString(),
        },
      });
      await this.emitFinished('execution.failed', executionId, projectId, input.agent.agentId, input.correlationId);
    }
  }

  private async loadExecution(executionId: string): Promise<ExecutionPedido | null> {
    const pedido = await this.prisma.dPedido.findFirst({
      where: {
        chave: BigInt(executionId),
        idClasse: { in: EXECUTION_CLASSES },
        excluido: false,
      },
      select: { chave: true, idClasse: true, idLocEscritu: true, dados: true },
    });

    if (!pedido) return null;
    return {
      chave: pedido.chave,
      idClasse: pedido.idClasse,
      idLocEscritu: pedido.idLocEscritu,
      dados: (pedido.dados ?? {}) as Record<string, unknown>,
    };
  }

  private async loadProject(projectId: string): Promise<RuntimeProject | null> {
    const project = await this.prisma.dProject.findFirst({
      where: { chave: BigInt(projectId), excluido: false },
      select: { chave: true, dados: true },
    });
    if (!project) return null;
    return {
      chave: project.chave,
      dados: (project.dados ?? {}) as Record<string, unknown>,
    };
  }

  private async loadAgent(agentId: string): Promise<RuntimeAgent | null> {
    const agent = await this.prisma.dEntidade.findFirst({
      where: {
        chave: BigInt(agentId),
        idClasse: AUTOMATION_CLASS_IDS.AGENT,
        excluido: false,
      },
      select: { chave: true, dados: true },
    });
    if (!agent) return null;
    return {
      chave: agent.chave,
      dados: (agent.dados ?? {}) as Record<string, unknown>,
    };
  }

  private resolveRuntimeAgent(agent: RuntimeAgent): RemoteAgentRuntime {
    const tunnelPortRaw = agent.dados.tunnelPort;
    const tunnelPort =
      typeof tunnelPortRaw === 'number'
        ? tunnelPortRaw
        : typeof tunnelPortRaw === 'string'
          ? Number(tunnelPortRaw)
          : NaN;
    const agentCommandSecretEncrypted = this.asString(agent.dados.agentCommandSecretEncrypted);
    if (!Number.isInteger(tunnelPort) || !agentCommandSecretEncrypted) {
      throw new Error('Agent sem tunnelPort ou agentCommandSecretEncrypted.');
    }
    return {
      agentId: agent.chave.toString(),
      tunnelPort,
      agentCommandSecretEncrypted,
    };
  }

  private async markRunning(executionId: string): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "DPedido"
      SET dados = jsonb_set(
            jsonb_set(
              COALESCE(dados, '{}'::jsonb),
              '{runtime}',
              COALESCE(dados->'runtime', '{}'::jsonb) || jsonb_build_object('startedAt', NOW()::text),
              true
            ),
            '{statusCode}',
            to_jsonb(${AUTOMATION_CLASS_IDS.EXEC_STATUS_RUNNING.toString()}::text),
            true
          ),
          "atualizadoEm" = NOW()
      WHERE chave = ${BigInt(executionId)}
        AND idClasse IN (${Prisma.join(EXECUTION_CLASSES)})
        AND (
          dados->>'statusCode' IN (
            ${AUTOMATION_CLASS_IDS.EXEC_STATUS_QUEUED.toString()},
            ${AUTOMATION_CLASS_IDS.EXEC_STATUS_APPROVED.toString()}
          )
          OR dados->'approval'->>'status' IN ('queued', 'approved')
        )
    `;
    return updated > 0;
  }

  private async failExecution(
    pedido: ExecutionPedido,
    correlationId: string,
    reason: string,
  ): Promise<void> {
    const executionId = pedido.chave.toString();
    const dadosAudit = this.asRecord(pedido.dados.audit);
    const projectId = this.asString(dadosAudit?.projectId) ?? pedido.idLocEscritu?.toString() ?? '';
    const agentId = this.asString(dadosAudit?.agentId) ?? '0';
    await this.safeRecordSystem({
      executionId,
      projectId,
      agentId,
      correlationId,
      line: reason,
      code: reason,
    });
    await this.finishExecution(pedido.chave, {
      statusCode: AUTOMATION_CLASS_IDS.EXEC_STATUS_FAILED.toString(),
      claude: {
        exitCode: -1,
        stderr: reason,
        finishedAt: new Date().toISOString(),
      },
    });
    await this.emitFinished('execution.failed', executionId, projectId, agentId, correlationId);
  }

  private async finishExecution(
    executionId: bigint,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const pedido = await this.prisma.dPedido.findFirst({
      where: { chave: executionId, excluido: false },
      select: { dados: true },
    });
    const dados = (pedido?.dados ?? {}) as Record<string, unknown>;
    const runtime = {
      ...this.asRecord(dados.runtime),
      finishedAt: new Date().toISOString(),
    };
    await this.prisma.dPedido.update({
      where: { chave: executionId },
      data: {
        dados: {
          ...dados,
          ...patch,
          runtime,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async emitFinished(
    type: 'execution.succeeded' | 'execution.failed' | 'execution.expired',
    executionId: string,
    projectId: string,
    agentId: string,
    correlationId: string,
  ): Promise<void> {
    await this.safeEmit(
      type,
      { executionId, projectId, agentId },
      correlationId,
    );
  }

  private async safeEmit(
    type: string,
    payload: Record<string, unknown>,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.eventProducer.addInternalEvent(
        type,
        payload,
        correlationId,
        { source: ExecutionRunProcessor.name },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`execution_event_emit_failed type=${type} error=${message}`);
    }
  }

  private async safeRecordSystem(
    input: Parameters<ExecutionRuntimeLogService['recordSystem']>[0],
  ): Promise<void> {
    try {
      await this.logService.recordSystem(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`execution_system_log_failed error=${message}`);
    }
  }

  private async runGitText(
    input: {
      pedido: ExecutionPedido;
      project: RuntimeProject;
      agent: RemoteAgentRuntime;
      correlationId: string;
      logContext: ReturnType<ExecutionRuntimeLogService['createContext']>;
    },
    worktree: ExecutionWorktree,
    args: string[],
  ): Promise<string> {
    const result = await this.runGit(input, worktree, args);
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')} failed`);
    }
    return result.stdout;
  }

  private runGit(
    input: {
      pedido: ExecutionPedido;
      project: RuntimeProject;
      agent: RemoteAgentRuntime;
      correlationId: string;
      logContext: ReturnType<ExecutionRuntimeLogService['createContext']>;
    },
    worktree: ExecutionWorktree,
    args: string[],
  ) {
    return this.remoteClient.execute(
      {
        executionId: input.pedido.chave.toString(),
        projectId: input.project.chave.toString(),
        correlationId: input.correlationId,
        agent: input.agent,
        workspace: worktree.workspace,
        command: {
          executable: 'git',
          args,
          cwd: worktree.workspace,
          timeoutMs: INTERNAL_TIMEOUT_MS,
          maxOutputBytes: MAX_OUTPUT_BYTES,
        },
      },
      input.logContext,
    );
  }

  private userCommand(command: Record<string, unknown> | undefined): RemoteStructuredCommand {
    const executable = this.asString(command?.executable);
    const args = this.asStringArray(command?.args);
    if (!executable || !args) {
      throw new Error('Execution command estruturado ausente.');
    }

    return {
      executable,
      args,
      cwd: this.asString(command?.cwd) ?? '.',
      env: this.asRecordOfString(command?.env),
      timeoutMs: this.asNumber(command?.timeoutMs) ?? 3600000,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    };
  }

  private resolveProjectAutomation(dados: Record<string, unknown>) {
    const automation = this.asRecord(dados.automation) ?? {};
    return {
      remotePath: this.asString(automation.remotePath),
      remoteBranch: this.asString(automation.remoteBranch),
    };
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private asStringArray(value: unknown): string[] | undefined {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
      ? value
      : undefined;
  }

  private asRecordOfString(value: unknown): Record<string, string> | undefined {
    const record = this.asRecord(value);
    if (!record) return undefined;
    const entries = Object.entries(record);
    if (!entries.every(([, item]) => typeof item === 'string')) return undefined;
    return Object.fromEntries(entries) as Record<string, string>;
  }
}
