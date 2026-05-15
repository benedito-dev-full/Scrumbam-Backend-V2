/**
 * Provisionamento git idempotente por `projectSlug`.
 *
 * O agente recebe apenas slug e repoUrl. Caminho absoluto e resolvido aqui
 * como `<baseDir>/<projectSlug>`, com realpath check para impedir escape.
 * Comandos git usam `execFileSync` com args em array: nenhum shell envolvido.
 */
import { execFileSync } from 'child_process';
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';
import { PROJECT_SLUG_REGEX } from '../ssh/deploy-key-generator';

export const REPO_URL_REGEX =
  /^(git@(github\.com|gitlab\.com|bitbucket\.org):[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+(\.git)?|https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+(\.git)?)$/;

export type ProvisionProjectErrorCode =
  | 'INVALID_SLUG'
  | 'REPO_URL_INVALID'
  | 'REPO_URL_MISSING'
  | 'BASE_DIR_INVALID'
  | 'PATH_ESCAPE'
  | 'PROJECT_DIR_EXISTS_NOT_GIT'
  | 'GIT_MISSING'
  | 'CLONE_FAILED'
  | 'PULL_FAILED'
  | 'IO_ERROR';

export class ProvisionProjectError extends Error {
  constructor(
    public readonly code: ProvisionProjectErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProvisionProjectError';
  }
}

export interface ProvisionProjectOptions {
  baseDir?: string;
  allowedBaseDirs?: readonly string[];
  useSshKey?: boolean;
  depth?: number;
  timeoutSec?: number;
  sshKeyDir?: string;
  execFile?: typeof execFileSync;
}

export interface ProvisionProjectResult {
  projectPath: string;
  alreadyExisted: boolean;
  currentBranch: string;
  headCommitSha: string;
  usedSshKey: boolean;
}

/**
 * Clona o repositorio do projeto ou executa `git pull --ff-only` se a pasta
 * ja existir como repo git.
 */
export function provisionProject(
  projectSlug: string,
  repoUrl: string,
  options: ProvisionProjectOptions = {},
): ProvisionProjectResult {
  if (!PROJECT_SLUG_REGEX.test(projectSlug)) {
    throw new ProvisionProjectError(
      'INVALID_SLUG',
      `projectSlug invalido: deve bater ${PROJECT_SLUG_REGEX}`,
    );
  }
  if (typeof repoUrl !== 'string' || repoUrl.length === 0) {
    throw new ProvisionProjectError('REPO_URL_MISSING', 'repoUrl obrigatorio');
  }
  if (repoUrl.length > 512 || !REPO_URL_REGEX.test(repoUrl)) {
    throw new ProvisionProjectError('REPO_URL_INVALID', 'repoUrl fora da whitelist');
  }

  const baseDir = options.baseDir ?? '/home/dev-benedito/projetos';
  ensureAllowedBaseDir(baseDir, options.allowedBaseDirs);

  try {
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true, mode: 0o755 });
    }
  } catch (err) {
    throw new ProvisionProjectError(
      'IO_ERROR',
      `nao consegui criar baseDir ${baseDir}: ${(err as Error).message}`,
      err,
    );
  }

  const baseReal = realpathSync(baseDir);
  const projectPath = resolvePath(baseReal, projectSlug);
  if (dirname(projectPath) !== baseReal) {
    throw new ProvisionProjectError(
      'PATH_ESCAPE',
      `path resolvido (${projectPath}) escapa de baseDir (${baseReal})`,
    );
  }

  const execFile = options.execFile ?? execFileSync;
  const timeout = (options.timeoutSec ?? 60) * 1000;
  const env = buildGitEnv(projectSlug, options);
  const alreadyExisted = existsSync(projectPath);

  if (alreadyExisted) {
    assertExistingProjectDir(projectPath, baseReal, execFile);
    try {
      execFile('git', ['-C', projectPath, 'pull', '--ff-only'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
        env,
      });
    } catch (err) {
      throw mapGitError(err, 'PULL_FAILED', 'git pull falhou');
    }
  } else {
    const depth = options.depth ?? 1;
    const cloneArgs =
      depth > 0
        ? ['clone', '--depth', String(depth), repoUrl, projectPath]
        : ['clone', repoUrl, projectPath];
    try {
      execFile('git', cloneArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
        env,
      });
    } catch (err) {
      // `git clone` pode criar diretorio parcial antes de falhar. Remover
      // apenas o path recém-calculado sob baseReal para manter idempotencia.
      cleanupPartialClone(projectPath, baseReal);
      throw mapGitError(err, 'CLONE_FAILED', 'git clone falhou');
    }
  }

  return {
    projectPath,
    alreadyExisted,
    currentBranch: runGitOutput(
      execFile,
      projectPath,
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      timeout,
    ),
    headCommitSha: runGitOutput(execFile, projectPath, ['rev-parse', 'HEAD'], timeout),
    usedSshKey: options.useSshKey === true,
  };
}

function ensureAllowedBaseDir(baseDir: string, allowedBaseDirs?: readonly string[]): void {
  if (!allowedBaseDirs || allowedBaseDirs.length === 0) {
    return;
  }
  const candidate = resolvePath(baseDir);
  const allowed = allowedBaseDirs.map((dir) => resolvePath(dir));
  if (!allowed.includes(candidate)) {
    throw new ProvisionProjectError(
      'BASE_DIR_INVALID',
      `baseDir ${baseDir} nao esta em allowedProjectRoots`,
    );
  }
}

function assertExistingProjectDir(
  projectPath: string,
  baseReal: string,
  execFile: typeof execFileSync,
): void {
  const stat = lstatSync(projectPath);
  if (!stat.isDirectory()) {
    throw new ProvisionProjectError(
      'PROJECT_DIR_EXISTS_NOT_GIT',
      `path ${projectPath} existe mas nao e diretorio`,
    );
  }
  const projectReal = realpathSync(projectPath);
  if (dirname(projectReal) !== baseReal) {
    throw new ProvisionProjectError(
      'PATH_ESCAPE',
      `path existente (${projectReal}) escapa de baseDir (${baseReal})`,
    );
  }
  try {
    execFile('git', ['-C', projectReal, 'rev-parse', '--is-inside-work-tree'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw mapGitError(
      err,
      'PROJECT_DIR_EXISTS_NOT_GIT',
      `pasta ${projectPath} nao e repositorio git`,
    );
  }
}

function buildGitEnv(projectSlug: string, options: ProvisionProjectOptions): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (options.useSshKey === true) {
    const keyDir = options.sshKeyDir ?? '/etc/scrumban-agent/ssh-keys';
    const keyPath = resolvePath(keyDir, projectSlug);
    env.GIT_SSH_COMMAND = `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
  }
  return env;
}

function runGitOutput(
  execFile: typeof execFileSync,
  projectPath: string,
  args: string[],
  timeout: number,
): string {
  try {
    const out = execFile('git', ['-C', projectPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    }) as Buffer;
    return out.toString('utf8').trim();
  } catch (err) {
    throw mapGitError(err, 'IO_ERROR', `git ${args.join(' ')} falhou`);
  }
}

function cleanupPartialClone(projectPath: string, baseReal: string): void {
  try {
    if (!existsSync(projectPath)) return;
    if (dirname(realpathSync(projectPath)) !== baseReal) return;
    rmSync(projectPath, { recursive: true, force: true });
  } catch {
    // Melhor esforço: o erro original do clone é mais importante.
  }
}

function mapGitError(
  err: unknown,
  fallbackCode: ProvisionProjectErrorCode,
  prefix: string,
): ProvisionProjectError {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') {
    return new ProvisionProjectError(
      'GIT_MISSING',
      'comando git nao encontrado no PATH (install.sh deve garantir git)',
      err,
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return new ProvisionProjectError(fallbackCode, `${prefix}: ${message}`, err);
}
