import { UnprocessableEntityException } from '@nestjs/common';
import { ExecutionWorktreeService } from '../execution-worktree.service';

/**
 * Specs do stub V2 deprecated de `ExecutionWorktreeService`.
 *
 * Apos ADR-V2-030/-032/-033 o backend NAO mais executa `git worktree add`
 * remotamente — quem isola (ou nao) o filesystem eh o Claude Code dentro
 * do projeto. Este service permanece como stub para nao quebrar o grafo
 * do `ExecutionRunProcessor` enquanto Sub-tarefa 2.4 nao finaliza o fluxo
 * V2 end-to-end.
 *
 * Specs validam:
 * - prepare() retorna metadados logicos (`isolated: false`, branch nominal)
 * - prepare() valida `remotePath` (fail-closed se ausente / invalido)
 * - requiresIsolatedWorktree() sempre retorna `false`
 */
describe('ExecutionWorktreeService (V2 stub deprecated)', () => {
  const agent = {
    agentId: '30',
    tunnelPort: 20000,
    agentCommandSecretEncrypted: 'encrypted',
  };

  it('prepare() retorna metadados logicos sem outbound (V2 stub)', async () => {
    const service = new ExecutionWorktreeService();

    const result = await service.prepare({
      executionId: '123',
      projectId: '20',
      correlationId: 'corr',
      agent,
      projectAutomation: { remotePath: '/srv/repo', remoteBranch: 'main' },
    });

    expect(result).toEqual({
      branch: 'scrumban/exec-123',
      baseBranch: 'main',
      rootPath: '/srv/repo',
      workspace: '/srv/repo',
      isolated: false,
    });
  });

  it('prepare() usa baseBranch="main" como default quando remoteBranch ausente', async () => {
    const service = new ExecutionWorktreeService();

    const result = await service.prepare({
      executionId: '999',
      projectId: '20',
      correlationId: 'corr',
      agent,
      projectAutomation: { remotePath: '/srv/repo' },
    });

    expect(result.baseBranch).toBe('main');
    expect(result.isolated).toBe(false);
  });

  it('requiresIsolatedWorktree() sempre retorna false (V2 stub)', () => {
    const service = new ExecutionWorktreeService();
    expect(service.requiresIsolatedWorktree()).toBe(false);
  });

  it('prepare() falha com UnprocessableEntityException se remotePath ausente', async () => {
    const service = new ExecutionWorktreeService();

    await expect(
      service.prepare({
        executionId: '123',
        projectId: '20',
        correlationId: 'corr',
        agent,
        projectAutomation: {},
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('prepare() falha com UnprocessableEntityException se remotePath nao for absoluto', async () => {
    const service = new ExecutionWorktreeService();

    await expect(
      service.prepare({
        executionId: '123',
        projectId: '20',
        correlationId: 'corr',
        agent,
        projectAutomation: { remotePath: 'relative/path' },
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('prepare() falha com UnprocessableEntityException se remotePath contiver caracteres invalidos', async () => {
    const service = new ExecutionWorktreeService();

    await expect(
      service.prepare({
        executionId: '123',
        projectId: '20',
        correlationId: 'corr',
        agent,
        projectAutomation: { remotePath: '/srv/repo/../etc' },
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});
