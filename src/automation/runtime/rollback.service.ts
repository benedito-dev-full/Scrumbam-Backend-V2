import { Injectable, Logger } from '@nestjs/common';
import {
  ExecutionLogContext,
  ExecutionRuntimeLogService,
} from './execution-runtime-log.service';
import {
  RemoteAgentRuntime,
  RemoteExecutionClient,
  RemoteStructuredCommand,
} from './remote-execution-client';
import { ExecutionWorktree } from './execution-worktree.service';

export interface RollbackInput {
  executionId: string;
  projectId: string;
  correlationId: string;
  agent: RemoteAgentRuntime;
  worktree: ExecutionWorktree;
}

const INTERNAL_TIMEOUT_MS = 300000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

@Injectable()
export class RollbackService {
  private readonly logger = new Logger(RollbackService.name);

  constructor(
    private readonly remoteClient: RemoteExecutionClient,
    private readonly logService: ExecutionRuntimeLogService,
  ) {}

  async rollbackWorktree(
    input: RollbackInput,
    logContext: ExecutionLogContext,
  ): Promise<void> {
    if (!input.worktree.isolated) {
      await this.logService.recordSystem({
        executionId: input.executionId,
        projectId: input.projectId,
        agentId: input.agent.agentId,
        correlationId: input.correlationId,
        line: 'rollback skipped: execution did not use isolated worktree',
      });
      return;
    }

    await this.logService.recordSystem({
      executionId: input.executionId,
      projectId: input.projectId,
      agentId: input.agent.agentId,
      correlationId: input.correlationId,
      line: `rollback removing isolated worktree ${input.worktree.branch}`,
    });

    await this.runBestEffort(input, logContext, {
      executable: 'git',
      args: ['worktree', 'remove', '--force', input.worktree.workspace],
      cwd: input.worktree.rootPath,
      timeoutMs: INTERNAL_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    });

    await this.runBestEffort(input, logContext, {
      executable: 'git',
      args: ['branch', '-D', input.worktree.branch],
      cwd: input.worktree.rootPath,
      timeoutMs: INTERNAL_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    });
  }

  private async runBestEffort(
    input: RollbackInput,
    logContext: ExecutionLogContext,
    command: RemoteStructuredCommand,
  ): Promise<void> {
    try {
      await this.remoteClient.execute(
        {
          executionId: input.executionId,
          projectId: input.projectId,
          correlationId: input.correlationId,
          agent: input.agent,
          workspace: input.worktree.rootPath,
          command,
        },
        logContext,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `rollback_best_effort_failed executionId=${input.executionId} error=${message}`,
      );
      await this.logService.recordSystem({
        executionId: input.executionId,
        projectId: input.projectId,
        agentId: input.agent.agentId,
        correlationId: input.correlationId,
        line: `rollback command failed: ${message}`,
        code: 'ROLLBACK_COMMAND_FAILED',
      });
    }
  }
}

