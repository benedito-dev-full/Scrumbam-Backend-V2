import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  ExecutionLogContext,
  ExecutionRuntimeLogService,
} from './execution-runtime-log.service';
import {
  RemoteAgentRuntime,
  RemoteExecutionClient,
  RemoteStructuredCommand,
} from './remote-execution-client';

export interface ProjectAutomationRuntimeConfig {
  remotePath?: string;
  remoteBranch?: string;
}

export interface ExecutionWorktreeInput {
  executionId: string;
  projectId: string;
  correlationId: string;
  agent: RemoteAgentRuntime;
  projectAutomation: ProjectAutomationRuntimeConfig;
  command: {
    executable?: string;
    args?: string[];
  };
}

export interface ExecutionWorktree {
  branch: string;
  baseBranch: string;
  rootPath: string;
  workspace: string;
  isolated: boolean;
}

const INTERNAL_TIMEOUT_MS = 300000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

@Injectable()
export class ExecutionWorktreeService {
  constructor(
    private readonly remoteClient: RemoteExecutionClient,
    private readonly logService: ExecutionRuntimeLogService,
  ) {}

  async prepare(
    input: ExecutionWorktreeInput,
    logContext: ExecutionLogContext,
  ): Promise<ExecutionWorktree> {
    const rootPath = this.requireRemotePath(input.projectAutomation.remotePath);
    const branch = `scrumban/exec-${input.executionId}`;
    const baseBranch = input.projectAutomation.remoteBranch ?? 'main';
    const workspace = `${rootPath}/worktrees/exec-${input.executionId}`;
    const needsIsolation = this.requiresIsolatedWorktree(input.command);

    if (!needsIsolation) {
      return { branch, baseBranch, rootPath, workspace: rootPath, isolated: false };
    }

    await this.logService.recordSystem({
      executionId: input.executionId,
      projectId: input.projectId,
      agentId: input.agent.agentId,
      correlationId: input.correlationId,
      line: `creating isolated worktree ${branch}`,
    });

    await this.remoteClient.execute(
      {
        executionId: input.executionId,
        projectId: input.projectId,
        correlationId: input.correlationId,
        agent: input.agent,
        workspace: rootPath,
        command: this.command(
          'git',
          ['worktree', 'add', '-B', branch, workspace, baseBranch],
          rootPath,
        ),
      },
      logContext,
    );

    return { branch, baseBranch, rootPath, workspace, isolated: true };
  }

  requiresIsolatedWorktree(command: { executable?: string; args?: string[] }): boolean {
    const executable = command.executable;
    const args = command.args ?? [];
    if (!executable) return true;

    if (['ls', 'grep', 'cat', 'echo', 'pwd', 'find'].includes(executable)) {
      return false;
    }

    if (executable === 'git') {
      return !['status', 'diff', 'log', 'branch'].includes(args[0] ?? '');
    }

    return true;
  }

  private requireRemotePath(remotePath: string | undefined): string {
    if (!remotePath || !remotePath.startsWith('/')) {
      throw new UnprocessableEntityException(
        'Projeto sem dados.automation.remotePath absoluto para runtime remoto.',
      );
    }
    if (remotePath.includes('..') || /[\r\n`$;&|<>]/.test(remotePath)) {
      throw new UnprocessableEntityException(
        'dados.automation.remotePath invalido para runtime remoto.',
      );
    }
    return remotePath.replace(/\/+$/, '');
  }

  private command(
    executable: string,
    args: string[],
    cwd: string,
  ): RemoteStructuredCommand {
    return {
      executable,
      args,
      cwd,
      timeoutMs: INTERNAL_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    };
  }
}

