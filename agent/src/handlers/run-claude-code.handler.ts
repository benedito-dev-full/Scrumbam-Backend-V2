/**
 * Handler do comando `RUN_CLAUDE_CODE` em `POST /v1/execute`.
 *
 * Orquestra (Sub-tarefa 4):
 *  1. Mutex local por `projectSlug` — 2ª request enquanto a 1ª roda → 409.
 *  2. `identity-resolver`: slug → path via `~/.claude/CLAUDE.md`.
 *  3. `allowlist`: realpath + prefix check contra `allowedProjectRoots`.
 *  4. Snapshot do diretório `~/.claude/projects/<encoded-cwd>/` ANTES.
 *  5. `runner`: spawn `claude -p ... --output-format json [--resume <id>]`.
 *  6. `session-parser`: extrai `session_id` do JSON (snake_case!) ou faz
 *     fallback de filesystem se output estiver corrompido.
 *  7. ACK síncrono `200 { accepted: true, executionId }` ao backend.
 *  8. **Em paralelo (async, não bloqueia ACK):** `backendClient.sendExecutionResult`
 *     com `{ claudeSessionId, claudeSessionPath, resumedFrom, success, ... }`.
 *
 * **Decisão arquitetural:** o backend espera ACK rápido e recebe o resultado
 * via `execution-result` outbound. Isso evita request HTTP de longa duração
 * (que estoura timeouts no tunnel SSH) e desacopla scale-up.
 *
 * Mapeamento de status HTTP:
 *  - 200 → executionId aceito (resultado virá via outbound)
 *  - 400 → payload inválido (missing fields)
 *  - 403 → path fora de allowlist (`WORKSPACE_OUTSIDE_ALLOWED_ROOT`)
 *  - 409 → mutex (`PROJECT_BUSY`)
 *  - 422 → slug desconhecido / entry inválida (`UNKNOWN_PROJECT_SLUG`)
 *  - 500 → CLAUDE.md ausente / erro interno
 *
 * Stdout/stderr são truncados a 64KB antes do envio (limite ADR-V2-032).
 *
 * **ADR-V2-083 — dois modos:**
 *  - **Esteira** (payload com `pipeline.required` + `git.branch`): preflight
 *    SÍNCRONO antes do ACK (repo sem `.claude/commands/scrumban-executar.md` ⇒
 *    422 `PIPELINE_NOT_INSTALLED`, decisão CEO P1); depois do ACK,
 *    `runPipelineFlow` (gh/token, base, branch, `claude -p /scrumban-executar`
 *    com `--append-system-prompt` + `--json-schema`, verificação independente,
 *    rede de segurança de PR) e callback com bloco `pipeline`.
 *  - **Simples** (payload sem `pipeline` — modo COMMAND/HÍBRIDO ou backend
 *    antigo): comportamento legado, SEM `--system-prompt` (o CLI já carrega o
 *    CLAUDE.md do repo) e com a base = default do repo (fim do `main` fixo).
 *
 * Status extra: 400 `INVALID_GIT_BRANCH`/`MISSING_GIT_BRANCH`, 422 `PIPELINE_NOT_INSTALLED`.
 *
 * @see ADR-V2-032, ADR-V2-083
 */
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import type { AgentConfig } from '../config/schema';
import { AllowlistError, validateWorkspace } from '../claude-code/allowlist';
import { IdentityResolverError, resolveProjectPath } from '../claude-code/identity-resolver';
import { runClaudeCode, type RunnerResult } from '../claude-code/runner';
import { runPipelineFlow, type GitRequest, type PipelineRequest } from '../claude-code/pipeline-flow';
import { isPipelineInstalled, PIPELINE_COMMAND_RELATIVE_PATH } from '../claude-code/pipeline-preflight';
import { defaultGitExec, isSafeRef, type GitExec } from '../git/pipeline-git';
import { buildRedactor, redactDeep, type Redactor } from '../security/redact';
import {
  computeSessionJsonlPath,
  findNewSessionIdFromFilesystem,
  parseClaudeOutput,
  SessionParseError,
  snapshotSessionDir,
} from '../claude-code/session-parser';
import type { BackendClient, ExecutionResultPayload } from '../outbound/backend-client';

const STDOUT_TRUNCATE_BYTES = 64 * 1024; // 64KB
const TRUNCATE_SUFFIX = '…[trunc]';

/** Mutex local — Set de slugs em execução. Não precisa de fairness. */
export type ProjectMutex = Set<string>;

export function createProjectMutex(): ProjectMutex {
  return new Set<string>();
}

/** Dependências injetadas no handler (testes mockam tudo). */
export interface RunClaudeCodeDeps {
  config: AgentConfig;
  logger: Logger;
  backendClient: BackendClient;
  mutex: ProjectMutex;
  /** Override do runner (testes). Default: `runClaudeCode`. */
  runImpl?: typeof runClaudeCode;
  /** Override do resolver (testes). */
  resolveImpl?: typeof resolveProjectPath;
  /** Override do allowlist (testes). */
  validateImpl?: typeof validateWorkspace;
  /** Override do snapshot (testes). */
  snapshotImpl?: typeof snapshotSessionDir;
  /** Override do fallback FS (testes). */
  fallbackImpl?: typeof findNewSessionIdFromFilesystem;
  /** Override do executor git/gh (testes). Default: `execFile` sem shell. */
  gitExecImpl?: GitExec;
  /** Override de `fs.existsSync` do preflight síncrono (testes). */
  existsImpl?: (p: string) => boolean;
  /** Ambiente lido pelo preflight (`GITHUB_TOKEN`). Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
}

interface ValidatedPayload {
  executionId: string;
  projectSlug: string;
  prompt: string;
  resumeSessionId: string | null;
  timeoutSec: number | undefined;
  /** ADR-V2-083 — presente ⇒ modo esteira. */
  git: GitRequest | null;
  pipeline: PipelineRequest | null;
}

/**
 * Constrói o handler Express. Não bloqueia o response no `sendExecutionResult`
 * — o backend recebe ACK imediato e o resultado vem por outro request.
 *
 * @example
 *   const handler = createRunClaudeCodeHandler({ config, logger, backendClient, mutex });
 *   dispatcher.register('RUN_CLAUDE_CODE', handler);
 */
export function createRunClaudeCodeHandler(deps: RunClaudeCodeDeps) {
  const {
    config,
    logger,
    backendClient,
    mutex,
    runImpl = runClaudeCode,
    resolveImpl = resolveProjectPath,
    validateImpl = validateWorkspace,
    snapshotImpl = snapshotSessionDir,
    fallbackImpl = findNewSessionIdFromFilesystem,
    gitExecImpl = defaultGitExec,
    existsImpl,
    env = process.env,
  } = deps;

  return function handle(req: Request, res: Response): void {
    const body = (req.body ?? {}) as Record<string, unknown>;

    // ─── Validação de payload ────────────────────────────────────────────
    const validated = validatePayload(body);
    if ('error' in validated) {
      logger.warn(
        { stage: 'run-claude-code', error: validated.error.errorCode },
        validated.error.message,
      );
      res.status(validated.error.status).json({
        accepted: false,
        errorCode: validated.error.errorCode,
        message: validated.error.message,
        executionId: validated.error.executionId,
      });
      return;
    }

    const payload = validated.value;
    const log = logger.child({
      stage: 'run-claude-code',
      executionId: payload.executionId,
      projectSlug: payload.projectSlug,
    });

    // ─── Mutex por slug ─────────────────────────────────────────────────
    if (mutex.has(payload.projectSlug)) {
      log.warn('projectSlug ja em execucao — recusando 409');
      res.status(409).json({
        accepted: false,
        errorCode: 'PROJECT_BUSY',
        message: `projectSlug "${payload.projectSlug}" ja tem execucao em andamento`,
        executionId: payload.executionId,
      });
      return;
    }

    // ─── Identity resolver (CLAUDE.md → path) ───────────────────────────
    let resolvedPath: string;
    try {
      resolvedPath = resolveImpl(payload.projectSlug, config.claudeMdPath);
    } catch (err) {
      if (err instanceof IdentityResolverError) {
        const httpStatus =
          err.code === 'CLAUDE_MD_NOT_FOUND' || err.code === 'CLAUDE_MD_READ_ERROR' ? 500 : 422;
        log.warn({ errorCode: err.code }, err.message);
        res.status(httpStatus).json({
          accepted: false,
          errorCode: err.code,
          message: err.message,
          executionId: payload.executionId,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err: message }, 'erro inesperado no resolver');
      res.status(500).json({
        accepted: false,
        errorCode: 'INTERNAL_ERROR',
        message: 'erro interno ao resolver projectSlug',
        executionId: payload.executionId,
      });
      return;
    }

    // ─── Allowlist (realpath + prefix) ──────────────────────────────────
    let canonicalCwd: string;
    try {
      canonicalCwd = validateImpl(resolvedPath, config.allowedProjectRoots);
    } catch (err) {
      if (err instanceof AllowlistError) {
        log.warn({ errorCode: err.code, resolvedPath }, err.message);
        res.status(403).json({
          accepted: false,
          errorCode: err.code,
          message: err.message,
          executionId: payload.executionId,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err: message }, 'erro inesperado no allowlist');
      res.status(500).json({
        accepted: false,
        errorCode: 'INTERNAL_ERROR',
        message: 'erro interno na validacao de workspace',
        executionId: payload.executionId,
      });
      return;
    }

    // ─── Preflight SÍNCRONO da esteira (ADR-V2-083, decisão CEO P1) ──────
    // Repo sem o comando headless ⇒ PARAR E AVISAR (todos os tipos), sem
    // fallback de execução simples. Mutex não é adquirido.
    if (payload.pipeline?.required === true && !isPipelineInstalled(canonicalCwd, existsImpl)) {
      log.warn('repo sem a esteira headless — recusando 422 PIPELINE_NOT_INSTALLED');
      res.status(422).json({
        accepted: false,
        errorCode: 'PIPELINE_NOT_INSTALLED',
        message: `Repositório do projeto "${payload.projectSlug}" sem a esteira: instale ${PIPELINE_COMMAND_RELATIVE_PATH} (template Devari-Core) na branch base`,
        executionId: payload.executionId,
      });
      return;
    }

    // ─── Mutex acquire + dispatch async ─────────────────────────────────
    mutex.add(payload.projectSlug);
    log.info(
      {
        cwd: canonicalCwd,
        hasResume: payload.resumeSessionId !== null,
        mode: payload.pipeline ? 'pipeline' : 'simple',
      },
      'aceito',
    );

    // ACK imediato — resultado vai chegar via execution-result outbound.
    res.status(200).json({
      accepted: true,
      executionId: payload.executionId,
    });

    // Fire-and-forget. Erro é logado, nunca propaga (Express já respondeu).
    void runAndReport({
      payload,
      cwd: canonicalCwd,
      logger: log,
      backendClient,
      mutex,
      runImpl,
      snapshotImpl,
      fallbackImpl,
      gitExec: gitExecImpl,
      env,
      config,
    });
  };
}

/** Validação síncrona do body do payload. Retorna `{value}` ou `{error}`. */
function validatePayload(
  body: Record<string, unknown>,
):
  | { value: ValidatedPayload }
  | { error: { status: number; errorCode: string; message: string; executionId: string | null } } {
  const executionId =
    typeof body.executionId === 'string' && body.executionId.length > 0 ? body.executionId : null;

  if (executionId === null) {
    return {
      error: {
        status: 400,
        errorCode: 'MISSING_EXECUTION_ID',
        message: 'executionId obrigatorio',
        executionId: null,
      },
    };
  }

  const projectSlug =
    typeof body.projectSlug === 'string' && body.projectSlug.length > 0 ? body.projectSlug : null;
  if (projectSlug === null) {
    return {
      error: {
        status: 400,
        errorCode: 'MISSING_PROJECT_SLUG',
        message: 'projectSlug obrigatorio',
        executionId,
      },
    };
  }

  // Sanitização defensiva: slug não pode ter `/`, `..`, espaços ou nulls.
  // Defesa contra injection no parser do CLAUDE.md.
  if (!/^[a-zA-Z0-9._-]+$/.test(projectSlug)) {
    return {
      error: {
        status: 400,
        errorCode: 'INVALID_PROJECT_SLUG',
        message: `projectSlug "${projectSlug}" contem caracteres invalidos`,
        executionId,
      },
    };
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt : null;
  if (prompt === null || prompt.length === 0) {
    return {
      error: {
        status: 400,
        errorCode: 'MISSING_PROMPT',
        message: 'prompt obrigatorio',
        executionId,
      },
    };
  }

  const resumeSessionId =
    typeof body.resumeSessionId === 'string' && body.resumeSessionId.length > 0
      ? body.resumeSessionId
      : null;

  // Validação leve: se vier resumeSessionId, exigimos UUID.
  if (
    resumeSessionId !== null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resumeSessionId)
  ) {
    return {
      error: {
        status: 400,
        errorCode: 'INVALID_RESUME_SESSION_ID',
        message: `resumeSessionId "${resumeSessionId}" nao e UUID`,
        executionId,
      },
    };
  }

  const timeoutSec =
    typeof body.timeoutSec === 'number' && body.timeoutSec > 0 ? body.timeoutSec : undefined;

  // ─── ADR-V2-083: git + pipeline (opcionais; ausentes ⇒ modo simples) ───
  let pipeline: PipelineRequest | null = null;
  if (body.pipeline !== undefined && body.pipeline !== null) {
    const p = body.pipeline as Record<string, unknown>;
    if (typeof p !== 'object' || p.required !== true) {
      pipeline = null; // required=false ⇒ modo simples
    } else {
      pipeline = {
        required: true,
        prRequired: p.prRequired === true,
        taskType: typeof p.taskType === 'string' ? p.taskType.slice(0, 40) : 'other',
      };
    }
  }
  let git: GitRequest | null = null;
  if (body.git !== undefined && body.git !== null) {
    const g = body.git as Record<string, unknown>;
    const branch = typeof g.branch === 'string' ? g.branch : null;
    const baseBranch = typeof g.baseBranch === 'string' ? g.baseBranch : null;
    if (!isSafeRef(branch) || (baseBranch !== null && !isSafeRef(baseBranch))) {
      return {
        error: {
          status: 400,
          errorCode: 'INVALID_GIT_BRANCH',
          message: 'git.branch/git.baseBranch invalidos',
          executionId,
        },
      };
    }
    git = { branch, baseBranch };
  }
  if (pipeline !== null && git === null) {
    return {
      error: {
        status: 400,
        errorCode: 'MISSING_GIT_BRANCH',
        message: 'modo esteira exige git.branch',
        executionId,
      },
    };
  }

  return {
    value: { executionId, projectSlug, prompt, resumeSessionId, timeoutSec, git, pipeline },
  };
}

/** Roda Claude Code e envia resultado outbound. Sempre libera o mutex no final. */
async function runAndReport(args: {
  payload: ValidatedPayload;
  cwd: string;
  logger: Logger;
  backendClient: BackendClient;
  mutex: ProjectMutex;
  runImpl: typeof runClaudeCode;
  snapshotImpl: typeof snapshotSessionDir;
  fallbackImpl: typeof findNewSessionIdFromFilesystem;
  gitExec: GitExec;
  env: NodeJS.ProcessEnv;
  config: AgentConfig;
}): Promise<void> {
  const { payload, logger, backendClient, mutex } = args;
  // Ciclo 2 / M3: nenhum segredo do ambiente/config sai do agente.
  const redact = buildRedactor(args.env, [
    args.config.agentApiKey,
    args.config.agentCommandSecret,
  ]);
  try {
    const resultPayload =
      payload.pipeline !== null && payload.git !== null
        ? await runPipelineFlow(
            {
              executionId: payload.executionId,
              prompt: payload.prompt,
              resumeSessionId: payload.resumeSessionId,
              // P2: default 4h vem do backend; teto local (6h) por config.
              timeoutSec: Math.min(
                payload.timeoutSec ?? args.config.pipelineTimeoutMaxSec,
                args.config.pipelineTimeoutMaxSec,
              ),
              git: payload.git,
              pipeline: payload.pipeline,
              cwd: args.cwd,
              maxBudgetUsd: args.config.maxBudgetUsd,
              prFallback: args.config.prFallback,
            },
            {
              logger,
              exec: args.gitExec,
              env: args.env,
              runImpl: args.runImpl,
              snapshotImpl: args.snapshotImpl,
              fallbackImpl: args.fallbackImpl,
              truncate: (s: string) => truncate(s, STDOUT_TRUNCATE_BYTES),
              redact,
            },
          )
        : await runSimpleMode({ ...args, redact });

    // M3: passada final em TODAS as strings (summary do modelo, contractError, …).
    const safePayload = redactDeep(resultPayload, redact);

    // sendExecutionResult retorna Promise; capturamos erro de transporte
    // para nunca subir como unhandled rejection.
    await backendClient.sendExecutionResult(safePayload).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { err: message, executionId: payload.executionId },
        'falha ao enviar execution-result (esgotou retries)',
      );
    });
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : String(err));
    logger.error({ err: message }, 'falha inesperada no run-claude-code');
  } finally {
    mutex.delete(payload.projectSlug);
  }
}

/**
 * MODO SIMPLES (legado: COMMAND/HÍBRIDO ou backend sem `pipeline`).
 * ADR-V2-083: sem `--system-prompt` (o CLI carrega o CLAUDE.md do repo) e com
 * a base = default do repo (`origin/HEAD`), não mais `main` fixo.
 */
async function runSimpleMode(args: {
  payload: ValidatedPayload;
  cwd: string;
  logger: Logger;
  runImpl: typeof runClaudeCode;
  snapshotImpl: typeof snapshotSessionDir;
  fallbackImpl: typeof findNewSessionIdFromFilesystem;
  gitExec: GitExec;
  redact: Redactor;
}): Promise<ExecutionResultPayload> {
  const { payload, cwd, logger, runImpl, snapshotImpl, fallbackImpl, redact } = args;

  let claudeSessionId: string | null = null;
  let claudeSessionPath: string | null = null;
  let errorCode: string | undefined;
  let runResult: RunnerResult;

  // Snapshot ANTES — base do diff para o fallback FS.
  const beforeFiles = snapshotImpl(cwd);

  // Volta para a base (default do repo) e atualiza. Falha ⇒ GIT_PULL_FAILED.
  let base = 'main';
  try {
    base = await gitPullRebase(cwd, logger, args.gitExec);
  } catch (pullErr) {
    const msg = redact(pullErr instanceof Error ? pullErr.message : String(pullErr));
    logger.error({ err: msg }, 'git pull --rebase falhou — execucao abortada');
    return {
      executionId: payload.executionId,
      exitCode: -1,
      success: false,
      durationMs: 0,
      claudeSessionId: null,
      claudeSessionPath: null,
      resumedFrom: payload.resumeSessionId,
      stdoutTruncated: '',
      stderrTruncated: msg,
      errorCode: 'GIT_PULL_FAILED',
    };
  }

  const promptWithGitRules = `${payload.prompt}

---
OBRIGATÓRIO após concluir a tarefa:
1. Se arquivos foram alterados:
   a. git checkout -b scrumban/auto-<slug-curto-da-tarefa>  (se ainda não estiver numa branch scrumban/)
   b. git add -A && git commit -m "<tipo>: <descrição curta>"
   c. git push origin <branch>
2. Sempre que houver uma branch scrumban/ com commits não mergeados, abra o PR se ainda não existir:
   gh pr create --title "<tipo>: <descrição curta>" --body "Criado automaticamente pelo agente Scrumban." --base ${base}
   (Se o PR já existir, apenas informe a URL — não tente criar novamente.)
3. Se nenhum arquivo foi alterado e não há branch pendente, não crie branch nem commit nem PR.`;

  try {
    runResult = await runImpl({
      prompt: promptWithGitRules,
      cwd,
      resumeSessionId: payload.resumeSessionId,
      timeoutSec: payload.timeoutSec,
    });
  } catch (err) {
    // runClaudeCode é projetado para nunca lançar, mas defensivo.
    const message = redact(err instanceof Error ? err.message : String(err));
    logger.error({ err: message }, 'runner lancou (inesperado)');
    runResult = {
      stdout: '',
      stderr: message,
      exitCode: -1,
      signal: null,
      timedOut: false,
      durationMs: 0,
    };
  }

  // Tenta parse do JSON do stdout.
  try {
    const parsed = parseClaudeOutput(runResult.stdout);
    claudeSessionId = parsed.sessionId;
    claudeSessionPath = computeSessionJsonlPath(cwd, parsed.sessionId);
    if (parsed.isError) {
      logger.warn(
        { sessionId: parsed.sessionId, terminalReason: parsed.terminalReason },
        'claude reportou is_error=true',
      );
    }
  } catch (err) {
    if (err instanceof SessionParseError) {
      logger.warn(
        { errorCode: err.code, message: err.message },
        'parse do stdout falhou — tentando fallback filesystem',
      );
    }
    const fallbackId = fallbackImpl(cwd, beforeFiles);
    if (fallbackId !== null) {
      claudeSessionId = fallbackId;
      claudeSessionPath = computeSessionJsonlPath(cwd, fallbackId);
      logger.info({ sessionId: fallbackId }, 'session_id obtido via fallback FS');
    } else {
      errorCode = 'SESSION_ID_EXTRACTION_FAILED';
      logger.error('falha ao extrair session_id (JSON + fallback ambos falharam)');
    }
  }

  // Sucesso global: exit 0 + JSON parseado SEM is_error.
  const parsedSuccess = errorCode === undefined && claudeSessionId !== null;
  const success = runResult.exitCode === 0 && parsedSuccess && !runResult.timedOut;

  return {
    executionId: payload.executionId,
    exitCode: runResult.exitCode ?? -1,
    success,
    durationMs: runResult.durationMs,
    claudeSessionId,
    claudeSessionPath,
    resumedFrom: payload.resumeSessionId,
    // M3: redige ANTES de truncar (um token cortado no limite não vaza pela metade).
    stdoutTruncated: truncate(redact(runResult.stdout), STDOUT_TRUNCATE_BYTES),
    stderrTruncated: truncate(redact(runResult.stderr), STDOUT_TRUNCATE_BYTES),
    ...(errorCode !== undefined ? { errorCode } : {}),
  };
}

/**
 * Modo simples: volta para a branch DEFAULT do repo (`origin/HEAD`, fallback
 * `main`) e atualiza via pull --rebase antes de cada execução.
 * Lança se checkout/pull falharem (⇒ GIT_PULL_FAILED). Não lança se o
 * diretório não for repo git (projeto sem versionamento).
 *
 * @returns Nome da base usada
 */
async function gitPullRebase(
  cwd: string,
  log: { info: (msg: string) => void; warn: (msg: string) => void },
  exec: GitExec,
): Promise<string> {
  // Se não for repo git, ignora silenciosamente.
  try {
    await exec('git', ['rev-parse', '--git-dir'], { cwd, timeoutMs: 15_000 });
  } catch {
    log.warn('diretorio nao e um repositorio git — pulando git pull');
    return 'main';
  }

  let base = 'main';
  try {
    const { stdout } = await exec('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
      cwd,
      timeoutMs: 15_000,
    });
    const name = stdout.trim().replace(/^origin\//, '');
    if (isSafeRef(name)) base = name;
  } catch {
    /* sem origin/HEAD — mantém main (comportamento anterior) */
  }

  const co = await exec('git', ['checkout', base], { cwd, timeoutMs: 30_000 });
  log.info(`git checkout ${base}: ${(co.stdout || co.stderr || 'ok').trim()}`);

  const pull = await exec('git', ['pull', '--rebase', '--autostash'], { cwd, timeoutMs: 60_000 });
  log.info(`git pull --rebase: ${(pull.stdout || pull.stderr || 'ok').trim()}`);
  return base;
}

/** Trunca string respeitando bytes UTF-8 (aproximação por chars; OK pra logs). */
function truncate(s: string, maxBytes: number): string {
  if (s.length <= maxBytes) return s;
  return s.slice(0, maxBytes - TRUNCATE_SUFFIX.length) + TRUNCATE_SUFFIX;
}
