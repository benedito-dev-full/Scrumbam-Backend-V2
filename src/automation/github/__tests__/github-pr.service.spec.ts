import { GithubPrService } from '../github-pr.service';

describe('GithubPrService', () => {
  function buildService() {
    const prisma = {
      dPedido: {
        findFirst: jest.fn().mockResolvedValue({ dados: { statusCode: '-519' } }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const config = { get: jest.fn() };
    const logService = { recordSystem: jest.fn().mockResolvedValue(undefined) };
    const service = new GithubPrService(prisma as any, config as any, logService as any);
    return { service, prisma, logService };
  }

  it('abre PR somente para branch scrumban/exec-* com diff nao vazio e persiste prUrl', async () => {
    const { service, prisma } = buildService();
    const pullsCreate = jest.fn().mockResolvedValue({
      data: { html_url: 'https://github.com/acme/repo/pull/7', number: 7 },
    });
    service.setOctokitFactoryForTests(async () => ({ pulls: { create: pullsCreate } }));

    const prUrl = await service.openPrIfNeeded({
      executionId: '123',
      projectId: '20',
      agentId: '30',
      correlationId: 'corr',
      projectDados: {},
      repoUrl: 'https://github.com/acme/repo',
      branch: 'scrumban/exec-123',
      baseBranch: 'main',
      commandText: 'npm test',
      filesChanged: 2,
      diffNonEmpty: true,
    });

    expect(prUrl).toBe('https://github.com/acme/repo/pull/7');
    expect(pullsCreate).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'acme',
      repo: 'repo',
      head: 'scrumban/exec-123',
      base: 'main',
    }));
    expect(prisma.dPedido.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        dados: expect.objectContaining({
          pullRequest: expect.objectContaining({ url: 'https://github.com/acme/repo/pull/7' }),
        }),
      }),
    }));
  });

  it('rejeita head branch fora do prefixo permitido', async () => {
    const { service, logService } = buildService();
    const pullsCreate = jest.fn();
    service.setOctokitFactoryForTests(async () => ({ pulls: { create: pullsCreate } }));

    const prUrl = await service.openPrIfNeeded({
      executionId: '123',
      projectId: '20',
      agentId: '30',
      correlationId: 'corr',
      projectDados: {},
      repoUrl: 'https://github.com/acme/repo',
      branch: 'feature/freeform',
      baseBranch: 'main',
      commandText: 'npm test',
      filesChanged: 1,
      diffNonEmpty: true,
    });

    expect(prUrl).toBeNull();
    expect(pullsCreate).not.toHaveBeenCalled();
    expect(logService.recordSystem).toHaveBeenCalledWith(expect.objectContaining({
      code: 'GITHUB_PR_FAILED',
      line: 'PR_HEAD_BRANCH_REJECTED',
    }));
  });

  it('nao abre PR quando diff esta vazio', async () => {
    const { service, logService } = buildService();

    const prUrl = await service.openPrIfNeeded({
      executionId: '123',
      projectId: '20',
      agentId: '30',
      correlationId: 'corr',
      projectDados: {},
      repoUrl: 'https://github.com/acme/repo',
      branch: 'scrumban/exec-123',
      baseBranch: 'main',
      commandText: 'npm test',
      filesChanged: 0,
      diffNonEmpty: false,
    });

    expect(prUrl).toBeNull();
    expect(logService.recordSystem).toHaveBeenCalledWith(expect.objectContaining({
      line: 'github pr skipped: empty diff',
    }));
  });

  it('audita erro quando repo do projeto esta ausente', async () => {
    const { service, logService } = buildService();

    const prUrl = await service.openPrIfNeeded({
      executionId: '123',
      projectId: '20',
      agentId: '30',
      correlationId: 'corr',
      projectDados: {},
      branch: 'scrumban/exec-123',
      baseBranch: 'main',
      commandText: 'npm test',
      filesChanged: 1,
      diffNonEmpty: true,
    });

    expect(prUrl).toBeNull();
    expect(logService.recordSystem).toHaveBeenCalledWith(expect.objectContaining({
      line: 'PROJECT_GITHUB_REPO_MISSING',
    }));
  });
});
