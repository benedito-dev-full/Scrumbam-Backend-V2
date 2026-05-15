import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProvisionProjectError, provisionProject } from '../src/git/clone';

function tempBase(): string {
  return mkdtempSync(join(tmpdir(), 'provision-'));
}

function buildExecFileMock(calls: string[][]): typeof execFileSync {
  return ((cmd: string, args: readonly string[], opts?: { env?: NodeJS.ProcessEnv }) => {
    calls.push([cmd, ...args, opts?.env?.GIT_SSH_COMMAND ?? '']);
    if (cmd !== 'git') throw new Error(`unexpected cmd ${cmd}`);

    if (args[2] === 'rev-parse' && args.includes('--is-inside-work-tree')) {
      return Buffer.from('true\n');
    }
    if (args[0] === 'clone') {
      const projectPath = args[args.length - 1];
      mkdirSync(projectPath, { recursive: true });
      mkdirSync(join(projectPath, '.git'));
      return Buffer.from('');
    }
    if (args[2] === 'pull') {
      return Buffer.from('Already up to date.\n');
    }
    if (args.includes('--abbrev-ref')) {
      return Buffer.from('main\n');
    }
    if (args.includes('HEAD')) {
      return Buffer.from(`${'a'.repeat(40)}\n`);
    }
    throw new Error(`unexpected args ${args.join(' ')}`);
  }) as never;
}

describe('provisionProject', () => {
  it('clona repo novo (default depth=0, full clone) e retorna branch/head', () => {
    const baseDir = tempBase();
    const calls: string[][] = [];

    const result = provisionProject('my-project', 'git@github.com:org/repo.git', {
      baseDir,
      allowedBaseDirs: [baseDir],
      useSshKey: true,
      execFile: buildExecFileMock(calls),
    });

    expect(result).toEqual({
      projectPath: join(realpathSync(baseDir), 'my-project'),
      alreadyExisted: false,
      currentBranch: 'main',
      headCommitSha: 'a'.repeat(40),
      usedSshKey: true,
    });
    // ADR-V2-044: default e full clone (sem --depth) para suportar push
    expect(calls[0]).toEqual(
      expect.arrayContaining(['git', 'clone', 'git@github.com:org/repo.git']),
    );
    expect(calls[0]).not.toContain('--depth');
    expect(calls[0].join(' ')).toContain('ssh -i');
  });

  it('pasta existente com .git executa pull --ff-only', () => {
    const baseDir = tempBase();
    const projectPath = join(baseDir, 'existing');
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(join(projectPath, '.git'), 'gitdir: /tmp/external.git');
    const calls: string[][] = [];

    const result = provisionProject('existing', 'https://github.com/org/repo.git', {
      baseDir,
      allowedBaseDirs: [baseDir],
      useSshKey: false,
      execFile: buildExecFileMock(calls),
    });

    expect(result.alreadyExisted).toBe(true);
    expect(calls.some((call) => call.includes('pull') && call.includes('--ff-only'))).toBe(true);
  });

  it('pasta existente com .git como arquivo continua sendo aceita', () => {
    const baseDir = tempBase();
    const projectPath = join(baseDir, 'worktree');
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(join(projectPath, '.git'), 'gitdir: /tmp/external.git');
    const calls: string[][] = [];

    const result = provisionProject('worktree', 'https://github.com/org/repo.git', {
      baseDir,
      allowedBaseDirs: [baseDir],
      useSshKey: false,
      execFile: buildExecFileMock(calls),
    });

    expect(result.alreadyExisted).toBe(true);
    expect(calls.some((call) => call.includes('--is-inside-work-tree'))).toBe(true);
  });

  it('rejeita repoUrl fora da whitelist antes de chamar git', () => {
    const baseDir = tempBase();
    const calls: string[][] = [];

    expect(() =>
      provisionProject('proj', 'https://evil.example.com/org/repo', {
        baseDir,
        execFile: buildExecFileMock(calls),
      }),
    ).toThrow(ProvisionProjectError);
    expect(calls).toHaveLength(0);
  });

  it('pasta existente sem .git retorna PROJECT_DIR_EXISTS_NOT_GIT', () => {
    const baseDir = tempBase();
    mkdirSync(join(baseDir, 'proj'));

    try {
      provisionProject('proj', 'https://github.com/org/repo', { baseDir });
      throw new Error('expected failure');
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisionProjectError);
      expect((err as ProvisionProjectError).code).toBe('PROJECT_DIR_EXISTS_NOT_GIT');
    }
  });

  it('baseDir fora de allowedBaseDirs retorna BASE_DIR_INVALID', () => {
    const baseDir = tempBase();
    const other = tempBase();

    try {
      provisionProject('proj', 'https://github.com/org/repo', {
        baseDir,
        allowedBaseDirs: [other],
      });
      throw new Error('expected failure');
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisionProjectError);
      expect((err as ProvisionProjectError).code).toBe('BASE_DIR_INVALID');
    }
  });

  it('git ausente retorna GIT_MISSING', () => {
    const baseDir = tempBase();
    const exec = (() => {
      const err = new Error('spawn git ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }) as never;

    try {
      provisionProject('proj', 'https://github.com/org/repo', { baseDir, execFile: exec });
      throw new Error('expected failure');
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisionProjectError);
      expect((err as ProvisionProjectError).code).toBe('GIT_MISSING');
    }
  });

  it('clone falho remove diretorio parcial sob baseDir', () => {
    const baseDir = tempBase();
    const exec = ((_cmd: string, args: readonly string[]) => {
      if (args[0] === 'clone') {
        const projectPath = args[args.length - 1];
        mkdirSync(projectPath, { recursive: true });
        writeFileSync(join(projectPath, 'partial'), 'x');
        throw new Error('clone failed');
      }
      return Buffer.from('');
    }) as never;

    expect(() =>
      provisionProject('proj', 'https://github.com/org/repo', { baseDir, execFile: exec }),
    ).toThrow(ProvisionProjectError);
    expect(existsSync(join(baseDir, 'proj'))).toBe(false);
    expect(statSync(baseDir).isDirectory()).toBe(true);
  });

  /**
   * C10#1 INVALID_SLUG: slug com chars fora de [a-z0-9-]{1,64} falha
   * antes de qualquer chamada a git (defesa em profundidade — slug e
   * convertido em path filho de baseDir).
   */
  it('rejeita projectSlug fora do PROJECT_SLUG_REGEX (INVALID_SLUG)', () => {
    const baseDir = tempBase();
    const calls: string[][] = [];

    try {
      provisionProject('../etc', 'https://github.com/org/repo.git', {
        baseDir,
        execFile: buildExecFileMock(calls),
      });
      throw new Error('expected failure');
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisionProjectError);
      expect((err as ProvisionProjectError).code).toBe('INVALID_SLUG');
    }
    // Garante que nao chamou git antes do reject
    expect(calls).toHaveLength(0);
  });

  /**
   * C10#2 PULL_FAILED: pasta existe com .git valido, mas `git pull
   * --ff-only` falha (ex: diverging history). Mapeia para PULL_FAILED.
   */
  it('git pull falhando em repo existente retorna PULL_FAILED', () => {
    const baseDir = tempBase();
    const projectPath = join(baseDir, 'diverged');
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(join(projectPath, '.git'), 'gitdir: /tmp/external.git');

    const exec = ((_cmd: string, args: readonly string[]) => {
      // assertExistingProjectDir → rev-parse --is-inside-work-tree
      if (args.includes('--is-inside-work-tree')) {
        return Buffer.from('true\n');
      }
      // git pull falha com diverging history
      if (args[2] === 'pull') {
        const err = new Error(
          'hint: You have divergent branches and need to specify how to reconcile them.',
        ) as NodeJS.ErrnoException;
        throw err;
      }
      return Buffer.from('');
    }) as never;

    try {
      provisionProject('diverged', 'https://github.com/org/repo.git', {
        baseDir,
        execFile: exec,
      });
      throw new Error('expected failure');
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisionProjectError);
      expect((err as ProvisionProjectError).code).toBe('PULL_FAILED');
    }
  });

  /**
   * C10#3 CLONE_TIMEOUT (depende de C3): execFileSync com option
   * `timeout` mata o processo com SIGTERM. Em outros ambientes vem
   * `code: 'ETIMEDOUT'`. Mapeamos AMBOS para CLONE_TIMEOUT (bucket
   * unico) tanto no clone quanto no pull.
   */
  it('timeout no git clone (SIGTERM) retorna CLONE_TIMEOUT', () => {
    const baseDir = tempBase();
    const exec = ((_cmd: string, args: readonly string[]) => {
      if (args[0] === 'clone') {
        const err = new Error('Command failed: git clone ...') as NodeJS.ErrnoException & {
          signal?: string;
          killed?: boolean;
        };
        err.signal = 'SIGTERM';
        err.killed = true;
        throw err;
      }
      return Buffer.from('');
    }) as never;

    try {
      provisionProject('proj', 'https://github.com/org/repo.git', {
        baseDir,
        execFile: exec,
      });
      throw new Error('expected failure');
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisionProjectError);
      expect((err as ProvisionProjectError).code).toBe('CLONE_TIMEOUT');
    }
  });

  it('timeout no git pull (ETIMEDOUT) tambem retorna CLONE_TIMEOUT', () => {
    const baseDir = tempBase();
    const projectPath = join(baseDir, 'existing');
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(join(projectPath, '.git'), 'gitdir: /tmp/external.git');

    const exec = ((_cmd: string, args: readonly string[]) => {
      if (args.includes('--is-inside-work-tree')) {
        return Buffer.from('true\n');
      }
      if (args[2] === 'pull') {
        const err = new Error('git pull excedeu timeout') as NodeJS.ErrnoException;
        err.code = 'ETIMEDOUT';
        throw err;
      }
      return Buffer.from('');
    }) as never;

    try {
      provisionProject('existing', 'https://github.com/org/repo.git', {
        baseDir,
        execFile: exec,
      });
      throw new Error('expected failure');
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisionProjectError);
      expect((err as ProvisionProjectError).code).toBe('CLONE_TIMEOUT');
    }
  });

  /**
   * C10#4 useSshKey=false explicito: NAO seta GIT_SSH_COMMAND no env
   * do execFile (verificavel via spy nos opts).
   */
  it('useSshKey=false NAO seta GIT_SSH_COMMAND no env do execFile', () => {
    const baseDir = tempBase();
    const opts: Array<{ env?: NodeJS.ProcessEnv }> = [];
    const exec = ((cmd: string, args: readonly string[], options?: { env?: NodeJS.ProcessEnv }) => {
      opts.push({ env: options?.env });
      if (cmd !== 'git') throw new Error(`unexpected cmd ${cmd}`);
      if (args[0] === 'clone') {
        const projectPath = args[args.length - 1];
        mkdirSync(projectPath, { recursive: true });
        mkdirSync(join(projectPath, '.git'));
        return Buffer.from('');
      }
      if (args.includes('--abbrev-ref')) return Buffer.from('main\n');
      if (args.includes('HEAD')) return Buffer.from(`${'a'.repeat(40)}\n`);
      return Buffer.from('');
    }) as never;

    provisionProject('proj-no-ssh', 'https://github.com/org/repo.git', {
      baseDir,
      allowedBaseDirs: [baseDir],
      useSshKey: false,
      execFile: exec,
    });

    // O primeiro call (clone) leva env explicito; GIT_SSH_COMMAND deve
    // estar UNDEFINED (nao foi setado pelo buildGitEnv).
    expect(opts[0]?.env).toBeDefined();
    expect(opts[0]?.env?.GIT_SSH_COMMAND).toBeUndefined();
  });

  /**
   * C10#5 useSshKey=true: GIT_SSH_COMMAND aponta para
   * /etc/scrumban-agent/ssh-keys/<slug> (path absoluto, IdentitiesOnly).
   */
  it('useSshKey=true seta GIT_SSH_COMMAND apontando para ssh-keys/<slug>', () => {
    const baseDir = tempBase();
    const opts: Array<{ env?: NodeJS.ProcessEnv }> = [];
    const exec = ((cmd: string, args: readonly string[], options?: { env?: NodeJS.ProcessEnv }) => {
      opts.push({ env: options?.env });
      if (cmd !== 'git') throw new Error(`unexpected cmd ${cmd}`);
      if (args[0] === 'clone') {
        const projectPath = args[args.length - 1];
        mkdirSync(projectPath, { recursive: true });
        mkdirSync(join(projectPath, '.git'));
        return Buffer.from('');
      }
      if (args.includes('--abbrev-ref')) return Buffer.from('main\n');
      if (args.includes('HEAD')) return Buffer.from(`${'a'.repeat(40)}\n`);
      return Buffer.from('');
    }) as never;

    provisionProject('proj-with-ssh', 'git@github.com:org/repo.git', {
      baseDir,
      allowedBaseDirs: [baseDir],
      useSshKey: true,
      execFile: exec,
    });

    const cmd = opts[0]?.env?.GIT_SSH_COMMAND;
    expect(cmd).toBeDefined();
    expect(cmd).toContain('/etc/scrumban-agent/ssh-keys/proj-with-ssh');
    expect(cmd).toContain('IdentitiesOnly=yes');
    expect(cmd).toContain('StrictHostKeyChecking=accept-new');
  });

  /**
   * C10#6 branch correta detectada: provisionProject le a branch REAL
   * via `git rev-parse --abbrev-ref HEAD` (nao hardcoda 'main'). Repos
   * com default branch 'develop' devolvem currentBranch='develop'.
   */
  it('detecta currentBranch a partir de git rev-parse --abbrev-ref HEAD', () => {
    const baseDir = tempBase();
    const exec = ((cmd: string, args: readonly string[]) => {
      if (cmd !== 'git') throw new Error(`unexpected cmd ${cmd}`);
      if (args[0] === 'clone') {
        const projectPath = args[args.length - 1];
        mkdirSync(projectPath, { recursive: true });
        mkdirSync(join(projectPath, '.git'));
        return Buffer.from('');
      }
      if (args.includes('--abbrev-ref')) {
        return Buffer.from('develop\n');
      }
      // `args` deve conter 'HEAD' e nao '--abbrev-ref' aqui (sha do HEAD)
      if (args.includes('HEAD')) {
        return Buffer.from(`${'b'.repeat(40)}\n`);
      }
      return Buffer.from('');
    }) as never;

    const result = provisionProject('proj-dev', 'https://github.com/org/repo.git', {
      baseDir,
      allowedBaseDirs: [baseDir],
      useSshKey: false,
      execFile: exec,
    });

    expect(result.currentBranch).toBe('develop');
    expect(result.headCommitSha).toBe('b'.repeat(40));
  });
});
