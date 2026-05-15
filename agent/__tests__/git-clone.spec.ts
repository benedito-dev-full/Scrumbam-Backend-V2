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
  it('clona repo novo com git clone --depth 1 e retorna branch/head', () => {
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
    expect(calls[0]).toEqual(
      expect.arrayContaining(['git', 'clone', '--depth', '1', 'git@github.com:org/repo.git']),
    );
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
});
