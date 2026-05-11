import { RollbackService } from '../rollback.service';

describe('RollbackService', () => {
  it('remove worktree e branch temporaria sem git reset --hard', async () => {
    const remoteClient = { execute: jest.fn().mockResolvedValue({ exitCode: 0 }) };
    const logService = { recordSystem: jest.fn().mockResolvedValue(undefined) };
    const service = new RollbackService(remoteClient as any, logService as any);
    const context = { nextSequence: 1, bytesWritten: 0, truncated: false };

    await service.rollbackWorktree(
      {
        executionId: '123',
        projectId: '20',
        correlationId: 'corr',
        agent: {
          agentId: '30',
          tunnelPort: 20000,
          agentCommandSecretEncrypted: 'encrypted',
        },
        worktree: {
          branch: 'scrumban/exec-123',
          baseBranch: 'main',
          rootPath: '/srv/repo',
          workspace: '/srv/repo/worktrees/exec-123',
          isolated: true,
        },
      },
      context,
    );

    const commands = remoteClient.execute.mock.calls.map((call) => call[0].command);
    expect(commands).toEqual([
      expect.objectContaining({
        executable: 'git',
        args: ['worktree', 'remove', '--force', '/srv/repo/worktrees/exec-123'],
      }),
      expect.objectContaining({
        executable: 'git',
        args: ['branch', '-D', 'scrumban/exec-123'],
      }),
    ]);
    expect(JSON.stringify(commands)).not.toContain('reset');
    expect(JSON.stringify(commands)).not.toContain('--hard');
  });
});

