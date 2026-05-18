import type { Request, Response } from 'express';
import pino from 'pino';
import { ProvisionProjectError } from '../src/git/clone';
import { createProvisionProjectHandler } from '../src/handlers/provision-project.handler';

const MOCK_PROJECT_PATH = '/home/dev-benedito/projetos/proj';
const MOCK_CLAUDE_MD_PATH = '/home/dev/.claude/CLAUDE.md';

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

  describe('claudeMdWriterImpl (fire-and-forget)', () => {
    const validBody = {
      projectSlug: 'proj',
      repoUrl: 'git@github.com:org/repo.git',
      useSshKey: true,
    };

    function makeProvisionImpl() {
      return jest.fn(() => ({
        projectPath: MOCK_PROJECT_PATH,
        alreadyExisted: false,
        currentBranch: 'main',
        headCommitSha: 'a'.repeat(40),
        usedSshKey: true,
      }));
    }

    it('claudeMdWriterImpl é chamado com (slug, projectPath, claudeMdPath) após 200', async () => {
      const writerImpl = jest.fn(() => Promise.resolve());
      const json = jest.fn();
      const status = jest.fn(() => ({ json }));

      const handler = createProvisionProjectHandler({
        logger: pino({ level: 'silent' }),
        provisionImpl: makeProvisionImpl() as never,
        claudeMdPath: MOCK_CLAUDE_MD_PATH,
        claudeMdWriterImpl: writerImpl,
      });

      handler({ body: validBody } as Request, { status } as unknown as Response);

      expect(status).toHaveBeenCalledWith(200);

      // Fire-and-forget: aguardar micro/macrotask
      await new Promise<void>((r) => setImmediate(r));

      expect(writerImpl).toHaveBeenCalledTimes(1);
      expect(writerImpl).toHaveBeenCalledWith('proj', MOCK_PROJECT_PATH, MOCK_CLAUDE_MD_PATH);
    });

    it('falha do writer não altera status do response (ainda 200)', async () => {
      const writerImpl = jest.fn(() => Promise.reject(new Error('disco cheio')));
      const json = jest.fn();
      const status = jest.fn(() => ({ json }));

      const handler = createProvisionProjectHandler({
        logger: pino({ level: 'silent' }),
        provisionImpl: makeProvisionImpl() as never,
        claudeMdPath: MOCK_CLAUDE_MD_PATH,
        claudeMdWriterImpl: writerImpl,
      });

      handler({ body: validBody } as Request, { status } as unknown as Response);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ accepted: true }));

      // Aguardar a rejeição ser capturada silenciosamente
      await new Promise<void>((r) => setImmediate(r));

      // Sem exceção não tratada: o teste não deve ter falhado
      expect(writerImpl).toHaveBeenCalledTimes(1);
    });

    it('sem claudeMdPath, writer não é chamado', async () => {
      const writerImpl = jest.fn(() => Promise.resolve());
      const json = jest.fn();
      const status = jest.fn(() => ({ json }));

      const handler = createProvisionProjectHandler({
        logger: pino({ level: 'silent' }),
        provisionImpl: makeProvisionImpl() as never,
        claudeMdWriterImpl: writerImpl,
        // claudeMdPath ausente
      });

      handler({ body: validBody } as Request, { status } as unknown as Response);

      expect(status).toHaveBeenCalledWith(200);

      await new Promise<void>((r) => setImmediate(r));

      expect(writerImpl).not.toHaveBeenCalled();
    });
  });
});
