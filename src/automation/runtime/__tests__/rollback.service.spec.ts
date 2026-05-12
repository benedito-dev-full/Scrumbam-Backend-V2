import { ExecutionRuntimeLogService } from '../execution-runtime-log.service';
import { RollbackService } from '../rollback.service';

/**
 * Specs do stub V2 deprecated de `RollbackService`.
 *
 * Apos ADR-V2-030/-032/-033 o backend NAO mais executa rollback de
 * worktree remotamente — caso seja necessario desfazer alteracoes do
 * Claude Code, isso sera modelado como nova execucao Claude Code ou via
 * fluxo de PR no GitHub. Este service permanece como stub para preservar
 * a interface do `ExecutionRunProcessor` enquanto Sub-tarefa 2.4 nao
 * reescreve o fluxo end-to-end.
 *
 * Specs validam:
 * - rollbackWorktree() NAO faz nenhum outbound remoto
 * - rollbackWorktree() registra evento `ROLLBACK_NOT_IMPLEMENTED_V2`
 *   no log estruturado
 * - falhas no logService NAO propagam (best-effort)
 */
type LogServiceMock = Pick<ExecutionRuntimeLogService, 'recordSystem'>;

describe('RollbackService (V2 stub deprecated)', () => {
  it('rollbackWorktree() nao faz outbound e registra evento ROLLBACK_NOT_IMPLEMENTED_V2', async () => {
    const logService: LogServiceMock = {
      recordSystem: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RollbackService(logService as ExecutionRuntimeLogService);

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
      { nextSequence: 1, bytesWritten: 0, truncated: false },
    );

    expect(logService.recordSystem).toHaveBeenCalledTimes(1);
    expect(logService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: '123',
        projectId: '20',
        agentId: '30',
        correlationId: 'corr',
        code: 'ROLLBACK_NOT_IMPLEMENTED_V2',
      }),
    );
  });

  it('rollbackWorktree() nao propaga erros do logService (best-effort)', async () => {
    const logService: LogServiceMock = {
      recordSystem: jest.fn().mockRejectedValue(new Error('log subsystem down')),
    };
    const service = new RollbackService(logService as ExecutionRuntimeLogService);

    await expect(
      service.rollbackWorktree(
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
        { nextSequence: 1, bytesWritten: 0, truncated: false },
      ),
    ).resolves.not.toThrow();

    expect(logService.recordSystem).toHaveBeenCalled();
  });
});
