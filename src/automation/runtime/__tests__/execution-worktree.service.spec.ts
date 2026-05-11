import { UnprocessableEntityException } from '@nestjs/common';
import { ExecutionWorktreeService } from '../execution-worktree.service';

describe('ExecutionWorktreeService', () => {
  const agent = {
    agentId: '30',
    tunnelPort: 20000,
    agentCommandSecretEncrypted: 'encrypted',
  };

  it('cria worktree isolada scrumban/exec-<id> para comandos com escrita', async () => {
    const remoteClient = { execute: jest.fn().mockResolvedValue({ exitCode: 0 }) };
    const logService = { recordSystem: jest.fn().mockResolvedValue(undefined) };
    const service = new ExecutionWorktreeService(remoteClient as any, logService as any);
    const context = { nextSequence: 1, bytesWritten: 0, truncated: false };

    const result = await service.prepare(
      {
        executionId: '123',
        projectId: '20',
        correlationId: 'corr',
        agent,
        projectAutomation: { remotePath: '/srv/repo', remoteBranch: 'main' },
        command: { executable: 'npm', args: ['install'] },
      },
      context,
    );

    expect(result).toEqual({
      branch: 'scrumban/exec-123',
      baseBranch: 'main',
      rootPath: '/srv/repo',
      workspace: '/srv/repo/worktrees/exec-123',
      isolated: true,
    });
    expect(remoteClient.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: '/srv/repo',
        command: expect.objectContaining({
          executable: 'git',
          args: ['worktree', 'add', '-B', 'scrumban/exec-123', '/srv/repo/worktrees/exec-123', 'main'],
        }),
      }),
      context,
    );
  });

  it('falha fechado se remotePath absoluto nao estiver configurado', async () => {
    const service = new ExecutionWorktreeService({ execute: jest.fn() } as any, { recordSystem: jest.fn() } as any);

    await expect(
      service.prepare(
        {
          executionId: '123',
          projectId: '20',
          correlationId: 'corr',
          agent,
          projectAutomation: {},
          command: { executable: 'npm', args: ['install'] },
        },
        { nextSequence: 1, bytesWritten: 0, truncated: false },
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('mantem read-only sem worktree isolada', async () => {
    const remoteClient = { execute: jest.fn() };
    const service = new ExecutionWorktreeService(remoteClient as any, { recordSystem: jest.fn() } as any);

    const result = await service.prepare(
      {
        executionId: '123',
        projectId: '20',
        correlationId: 'corr',
        agent,
        projectAutomation: { remotePath: '/srv/repo', remoteBranch: 'main' },
        command: { executable: 'git', args: ['status'] },
      },
      { nextSequence: 1, bytesWritten: 0, truncated: false },
    );

    expect(result.isolated).toBe(false);
    expect(result.workspace).toBe('/srv/repo');
    expect(remoteClient.execute).not.toHaveBeenCalled();
  });
});

