import type { Request, Response } from 'express';
import pino from 'pino';
import { ProvisionProjectError } from '../src/git/clone';
import { createProvisionProjectHandler } from '../src/handlers/provision-project.handler';

function silentLogger() {
  return pino({ level: 'silent' });
}

function invokeHandler(
  body: Record<string, unknown>,
  deps: Partial<Parameters<typeof createProvisionProjectHandler>[0]> = {},
) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const handler = createProvisionProjectHandler({
    logger: silentLogger(),
    provisionImpl:
      deps.provisionImpl ??
      (jest.fn(() => ({
        projectPath: '/home/dev-benedito/projetos/proj',
        alreadyExisted: false,
        currentBranch: 'main',
        headCommitSha: 'a'.repeat(40),
        usedSshKey: true,
      })) as never),
    allowedBaseDirs: deps.allowedBaseDirs,
  });

  handler({ body } as Request, { status } as unknown as Response);
  return { status, json };
}

describe('PROVISION_PROJECT handler', () => {
  it('happy path retorna ACK com dados do clone', () => {
    const provisionImpl = jest.fn(() => ({
      projectPath: '/home/dev-benedito/projetos/proj',
      alreadyExisted: false,
      currentBranch: 'main',
      headCommitSha: 'a'.repeat(40),
      usedSshKey: true,
    }));

    const { status, json } = invokeHandler(
      {
        projectSlug: 'proj',
        repoUrl: 'git@github.com:org/repo.git',
        useSshKey: true,
        baseDir: '/home/dev-benedito/projetos',
        depth: 1,
        timeoutSec: 60,
      },
      { provisionImpl: provisionImpl as never, allowedBaseDirs: ['/home/dev-benedito/projetos'] },
    );

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        accepted: true,
        projectPath: '/home/dev-benedito/projetos/proj',
        currentBranch: 'main',
      }),
    );
    expect(provisionImpl).toHaveBeenCalledWith(
      'proj',
      'git@github.com:org/repo.git',
      expect.objectContaining({
        useSshKey: true,
        baseDir: '/home/dev-benedito/projetos',
        depth: 1,
        timeoutSec: 60,
      }),
    );
  });

  it('repoUrl invalido retorna 422 e nao chama provisionImpl', () => {
    const provisionImpl = jest.fn();
    const { status, json } = invokeHandler(
      { projectSlug: 'proj', repoUrl: 'https://evil.example.com/org/repo' },
      { provisionImpl: provisionImpl as never },
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'REPO_URL_INVALID' }));
    expect(provisionImpl).not.toHaveBeenCalled();
  });

  it('PROJECT_DIR_EXISTS_NOT_GIT vira 409', () => {
    const provisionImpl = jest.fn(() => {
      throw new ProvisionProjectError('PROJECT_DIR_EXISTS_NOT_GIT', 'pasta existe sem .git');
    });
    const { status, json } = invokeHandler(
      { projectSlug: 'proj', repoUrl: 'https://github.com/org/repo' },
      { provisionImpl: provisionImpl as never },
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'PROJECT_DIR_EXISTS_NOT_GIT' }),
    );
  });

  it('useSshKey null vira 422 INVALID_USE_SSH_KEY', () => {
    const provisionImpl = jest.fn();
    const { status, json } = invokeHandler(
      {
        projectSlug: 'proj',
        repoUrl: 'https://github.com/org/repo',
        useSshKey: null,
      },
      { provisionImpl: provisionImpl as never },
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'INVALID_USE_SSH_KEY' }),
    );
    expect(provisionImpl).not.toHaveBeenCalled();
  });

  /**
   * C11#1 payload sem projectSlug: validatePayload roda
   * `typeof b.projectSlug !== 'string'` → falha como INVALID_SLUG
   * (regex nao bate em undefined). Handler responde 422 e NAO chama
   * provisionImpl.
   */
  it('payload sem projectSlug vira 422 INVALID_SLUG e nao chama provisionImpl', () => {
    const provisionImpl = jest.fn();
    const { status, json } = invokeHandler(
      // sem projectSlug
      { repoUrl: 'https://github.com/org/repo' },
      { provisionImpl: provisionImpl as never },
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'INVALID_SLUG' }));
    expect(provisionImpl).not.toHaveBeenCalled();
  });

  /**
   * C11#2 baseDir fora do permitido (allowedBaseDirs): a checagem
   * acontece dentro de provisionProject (allowedBaseDirs vem do agent
   * config). Handler propaga ProvisionProjectError(BASE_DIR_INVALID)
   * mapeando para 422.
   */
  it('baseDir fora de allowedBaseDirs vira 422 BASE_DIR_INVALID', () => {
    const provisionImpl = jest.fn(() => {
      throw new ProvisionProjectError(
        'BASE_DIR_INVALID',
        'baseDir /etc nao esta em allowedProjectRoots',
      );
    });
    const { status, json } = invokeHandler(
      {
        projectSlug: 'proj',
        repoUrl: 'https://github.com/org/repo.git',
        baseDir: '/etc',
      },
      {
        provisionImpl: provisionImpl as never,
        allowedBaseDirs: ['/home/dev-benedito/projetos'],
      },
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'BASE_DIR_INVALID' }));
    expect(provisionImpl).toHaveBeenCalledTimes(1);
  });

  /**
   * C11#3 alreadyExisted=true: pasta existente com .git valido, pull
   * --ff-only deu certo. Handler propaga `alreadyExisted: true` no ACK
   * (frontend usa para distinguir provisionamento novo vs sync).
   */
  it('sucesso com alreadyExisted=true reflete no ACK 200', () => {
    const provisionImpl = jest.fn(() => ({
      projectPath: '/home/dev-benedito/projetos/proj-existing',
      alreadyExisted: true,
      currentBranch: 'main',
      headCommitSha: 'c'.repeat(40),
      usedSshKey: true,
    }));

    const { status, json } = invokeHandler(
      { projectSlug: 'proj-existing', repoUrl: 'git@github.com:org/repo.git' },
      { provisionImpl: provisionImpl as never },
    );

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        accepted: true,
        alreadyExisted: true,
        projectPath: '/home/dev-benedito/projetos/proj-existing',
        currentBranch: 'main',
        headCommitSha: 'c'.repeat(40),
      }),
    );
  });
});
