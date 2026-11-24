/**
 * Git/GitHub da esteira headless (ADR-V2-083).
 *
 * O BACKEND decide a branch (`scrumban/exec-<id>`) e a base (config do projeto
 * ou `null` ⇒ default do repo via `origin/HEAD` — fim do `main` fixo). O
 * agente:
 *  - prepara: `fetch`, guarda sobras num stash nomeado (NUNCA `reset --hard`),
 *    `checkout -B <branch> origin/<base>` (resume: reusa a branch existente);
 *  - verifica de forma INDEPENDENTE do modelo: HEAD da branch, commits à frente
 *    da base, push (`ls-remote`) e PR (`gh pr list --head`);
 *  - rede de segurança (P3): commits sem PR ⇒ push + `gh pr create --draft`;
 *    PR não aprovado pela esteira ⇒ `gh pr ready --undo` (rascunho).
 *
 * Todos os comandos via `execFile` (sem shell). Nomes de ref validados contra
 * {@link SAFE_REF_RE} (sem `..`, sem começar com `-` ⇒ sem injeção de argumento).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Executor de comando (injetável em testes). Lança em exit≠0. */
export type GitExec = (
  file: string,
  args: string[],
  opts: { cwd: string; timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);

/**
 * Executor default: `execFile` sem shell, stdin fechado, prompts interativos
 * desligados (git/gh nunca podem esperar input — rodam headless).
 */
export const defaultGitExec: GitExec = async (file, args, opts) => {
  const r = await execFileAsync(file, args, {
    cwd: opts.cwd,
    timeout: opts.timeoutMs ?? 60_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
  });
  return { stdout: String(r.stdout), stderr: String(r.stderr) };
};

/** Nome de ref seguro. */
export const SAFE_REF_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;

/** Erro com código canônico para o callback. */
export class PipelineGitError extends Error {
  constructor(
    public readonly code: 'BASE_BRANCH_NOT_FOUND' | 'PIPELINE_PRECONDITION_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'PipelineGitError';
  }
}

/** PR como devolvido por `gh pr list --json`. */
export interface VerifiedPr {
  url: string;
  number: number;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  baseRefName: string;
  headRefOid: string;
}

/**
 * true se o nome é uma ref segura para passar ao git/gh.
 *
 * @param name - Nome da branch
 */
export function isSafeRef(name: string | null | undefined): name is string {
  return typeof name === 'string' && SAFE_REF_RE.test(name);
}

/**
 * Mensagem do erro do git/gh SEM corte (Ciclo 3 / N2): o stderr pode conter a
 * URL autenticada do remoto. Cortar aqui, antes da redação feita pelo
 * consumidor (`pipeline-flow`), vazaria o prefixo do token — quem trunca é o
 * consumidor, SEMPRE depois de redigir.
 */
function errMsg(err: unknown): string {
  const e = err as { stderr?: unknown; message?: unknown };
  const raw = typeof e?.stderr === 'string' && e.stderr.trim() !== '' ? e.stderr : String(e?.message ?? err);
  return raw.trim();
}

/**
 * Resolve a branch base do PR.
 *
 * @param exec - Executor
 * @param cwd - Repo
 * @param explicit - Base vinda do backend (`DProject.dados.automation.remoteBranch`) ou null
 * @returns Nome da base (sem `origin/`)
 * @throws {PipelineGitError} `BASE_BRANCH_NOT_FOUND`
 */
export async function resolveBaseBranch(
  exec: GitExec,
  cwd: string,
  explicit: string | null,
): Promise<string> {
  if (explicit !== null) {
    if (!isSafeRef(explicit)) {
      throw new PipelineGitError('BASE_BRANCH_NOT_FOUND', `base inválida: ${explicit}`);
    }
    try {
      await exec('git', ['ls-remote', '--exit-code', '--heads', 'origin', explicit], {
        cwd,
        timeoutMs: 60_000,
      });
      return explicit;
    } catch {
      throw new PipelineGitError('BASE_BRANCH_NOT_FOUND', `branch base "${explicit}" não existe em origin`);
    }
  }
  const readHead = async (): Promise<string | null> => {
    try {
      const { stdout } = await exec('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
        cwd,
        timeoutMs: 15_000,
      });
      const name = stdout.trim().replace(/^origin\//, '');
      return isSafeRef(name) ? name : null;
    } catch {
      return null;
    }
  };
  const first = await readHead();
  if (first) return first;
  // R7: clone sem origin/HEAD — pede ao remoto o default e tenta de novo.
  try {
    await exec('git', ['remote', 'set-head', 'origin', '--auto'], { cwd, timeoutMs: 60_000 });
  } catch {
    /* segue para o erro canônico */
  }
  const second = await readHead();
  if (second) return second;
  throw new PipelineGitError('BASE_BRANCH_NOT_FOUND', 'não foi possível descobrir a branch default de origin');
}

/**
 * Prepara a branch da execução.
 *
 * @param exec - Executor
 * @param input.cwd - Repo
 * @param input.branch - Branch decidida pelo backend
 * @param input.base - Base resolvida
 * @param input.executionId - Para nomear o stash de sobras
 * @param input.resume - true em `--resume`: reusa a branch se ela já existir
 * @returns `{ stashed }` — se havia sobras guardadas no stash
 * @throws {PipelineGitError} `PIPELINE_PRECONDITION_FAILED`
 */
export async function prepareBranch(
  exec: GitExec,
  input: { cwd: string; branch: string; base: string; executionId: string; resume: boolean },
): Promise<{ stashed: boolean }> {
  const { cwd, branch, base } = input;
  if (!isSafeRef(branch) || !isSafeRef(base)) {
    throw new PipelineGitError('PIPELINE_PRECONDITION_FAILED', 'branch/base inválida');
  }
  try {
    await exec('git', ['fetch', 'origin', '--prune'], { cwd, timeoutMs: 180_000 });

    // R9: sobras de execução abortada ⇒ stash nomeado (recuperável), nunca reset --hard.
    const { stdout: status } = await exec('git', ['status', '--porcelain'], { cwd, timeoutMs: 30_000 });
    let stashed = false;
    if (status.trim() !== '') {
      const stashId = `scrumban-leftover-${input.executionId.replace(/[^A-Za-z0-9._-]/g, '')}`;
      await exec('git', ['stash', 'push', '-u', '-m', stashId], { cwd, timeoutMs: 60_000 });
      stashed = true;
    }

    if (input.resume) {
      const remoteHas = await exec('git', ['ls-remote', '--exit-code', '--heads', 'origin', branch], {
        cwd,
        timeoutMs: 60_000,
      }).then(
        () => true,
        () => false,
      );
      if (remoteHas) {
        await exec('git', ['checkout', '-B', branch, `origin/${branch}`], { cwd, timeoutMs: 60_000 });
        return { stashed };
      }
      const localHas = await exec('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
        cwd,
        timeoutMs: 15_000,
      }).then(
        () => true,
        () => false,
      );
      if (localHas) {
        await exec('git', ['checkout', branch], { cwd, timeoutMs: 60_000 });
        return { stashed };
      }
    }

    await exec('git', ['checkout', '-B', branch, `origin/${base}`], { cwd, timeoutMs: 60_000 });
    return { stashed };
  } catch (err) {
    if (err instanceof PipelineGitError) throw err;
    throw new PipelineGitError('PIPELINE_PRECONDITION_FAILED', `preparo do git falhou: ${errMsg(err)}`);
  }
}

/**
 * Verificação independente da branch (não confia no que o modelo declarou).
 *
 * @param exec - Executor
 * @param input.cwd - Repo
 * @param input.branch - Branch da execução
 * @param input.base - Base
 * @returns `{ branchExists, headSha, commitsAhead, pushed }`
 */
export async function verifyBranch(
  exec: GitExec,
  input: { cwd: string; branch: string; base: string },
): Promise<{ branchExists: boolean; headSha: string | null; commitsAhead: number | null; pushed: boolean }> {
  const { cwd, branch, base } = input;
  let headSha: string | null = null;
  try {
    const { stdout } = await exec('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
      cwd,
      timeoutMs: 15_000,
    });
    const sha = stdout.trim();
    headSha = /^[0-9a-f]{7,64}$/i.test(sha) ? sha : null;
  } catch {
    headSha = null;
  }
  if (!headSha) return { branchExists: false, headSha: null, commitsAhead: null, pushed: false };

  let commitsAhead: number | null = null;
  try {
    const { stdout } = await exec('git', ['rev-list', '--count', `origin/${base}..refs/heads/${branch}`], {
      cwd,
      timeoutMs: 30_000,
    });
    const n = Number.parseInt(stdout.trim(), 10);
    commitsAhead = Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    commitsAhead = null;
  }

  let pushed = false;
  try {
    const { stdout } = await exec('git', ['ls-remote', 'origin', `refs/heads/${branch}`], {
      cwd,
      timeoutMs: 60_000,
    });
    const remoteSha = stdout.trim().split(/\s+/)[0] ?? '';
    pushed = remoteSha.toLowerCase() === headSha.toLowerCase();
  } catch {
    pushed = false;
  }
  return { branchExists: true, headSha, commitsAhead, pushed };
}

/**
 * Busca o PR da branch no GitHub (qualquer estado).
 *
 * @param exec - Executor
 * @param input.cwd - Repo
 * @param input.branch - Branch head do PR
 * @returns PR ou null
 */
export async function findPr(
  exec: GitExec,
  input: { cwd: string; branch: string },
): Promise<VerifiedPr | null> {
  const { stdout } = await exec(
    'gh',
    [
      'pr',
      'list',
      '--head',
      input.branch,
      '--state',
      'all',
      '--json',
      'url,number,state,isDraft,baseRefName,headRefOid',
      '--limit',
      '1',
    ],
    { cwd: input.cwd, timeoutMs: 60_000 },
  );
  let list: unknown;
  try {
    list = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(list) || list.length === 0) return null;
  const p = list[0] as Record<string, unknown>;
  const state = typeof p.state === 'string' ? p.state.toUpperCase() : '';
  if (
    typeof p.url !== 'string' ||
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/pull\/\d{1,9}$/.test(p.url) ||
    typeof p.number !== 'number' ||
    !['OPEN', 'CLOSED', 'MERGED'].includes(state) ||
    typeof p.baseRefName !== 'string' ||
    !isSafeRef(p.baseRefName) ||
    typeof p.headRefOid !== 'string' ||
    !/^[0-9a-f]{7,64}$/i.test(p.headRefOid)
  ) {
    return null;
  }
  return {
    url: p.url,
    number: p.number,
    state: state as VerifiedPr['state'],
    isDraft: p.isDraft === true,
    baseRefName: p.baseRefName,
    headRefOid: p.headRefOid,
  };
}

/**
 * Rede de segurança (P3): publica a branch (se preciso) e abre PR em RASCUNHO.
 *
 * @param exec - Executor
 * @param input - cwd, branch, base, pushed, title, body
 */
export async function openDraftPr(
  exec: GitExec,
  input: { cwd: string; branch: string; base: string; pushed: boolean; title: string; body: string },
): Promise<void> {
  if (!input.pushed) {
    await exec('git', ['push', '-u', 'origin', input.branch], { cwd: input.cwd, timeoutMs: 180_000 });
  }
  await exec(
    'gh',
    [
      'pr',
      'create',
      '--draft',
      '--base',
      input.base,
      '--head',
      input.branch,
      '--title',
      input.title.slice(0, 200),
      '--body',
      input.body.slice(0, 4000),
    ],
    { cwd: input.cwd, timeoutMs: 120_000 },
  );
}

/**
 * Converte um PR aberto em rascunho (`gh pr ready --undo`) — nada mergeável por engano (P3).
 *
 * @param exec - Executor
 * @param input.cwd - Repo
 * @param input.number - Número do PR
 */
export async function markPrAsDraft(
  exec: GitExec,
  input: { cwd: string; number: number },
): Promise<void> {
  await exec('gh', ['pr', 'ready', String(input.number), '--undo'], {
    cwd: input.cwd,
    timeoutMs: 60_000,
  });
}
