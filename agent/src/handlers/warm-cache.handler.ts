/**
 * Handler interno (NÃO-HTTP) do Cache Warmer.
 *
 * Chamado pelo loop `cache-warmer-loop.ts` a cada `intervalMinutes`.
 * Pipeline ENXUTO em comparação com `run-claude-code.handler.ts`:
 *
 *  - resolveProjectPath (slug → cwd via CLAUDE.md global) — IGUAL
 *  - validateWorkspace (allowlist + realpath) — IGUAL
 *  - leitura do CLAUDE.md global → systemPrompt — IGUAL
 *  - buildClaudeArgs — IGUAL (paridade do prefixo cacheado)
 *  - execFile direto — sem wrapper `runClaudeCode` (timeout próprio)
 *  - SEM mutex por slug — warms de projetos diferentes não conflitam
 *  - SEM git pull --rebase — warm não toca repo (não precisa código fresco)
 *  - SEM ACK 200 / sendExecutionResult — warm NÃO é DPedido; telemetria
 *    é log pino no loop (observabilidade via SSH + journalctl)
 *
 * Mensagem fixa: `cacheWarmer.warmupPrompt` do config (default
 * `"responda apenas ok. nao use ferramentas."`).
 * Flags extras: `cacheWarmer.claudeFlags` (default
 * `--permission-mode=plan --max-turns=1`).
 *
 * **Função pura no externo (entrada/saída), com side-effects controlados
 * via dependency injection (execFile + readFile).**
 */
import { execFile, type ExecFileException } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { Logger } from 'pino';
import { AllowlistError, validateWorkspace } from '../claude-code/allowlist';
import { buildClaudeArgs } from '../claude-code/command-builder';
import { IdentityResolverError, resolveProjectPath } from '../claude-code/identity-resolver';
import type { AgentConfig, CacheWarmerConfig } from '../config/schema';

const CLAUDE_BINARY = 'claude';
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB

/** Códigos de erro reportados ao backend via `cache-warmer-report`. */
export type WarmCacheErrorCode =
  | 'UNKNOWN_PROJECT_SLUG'
  | 'INVALID_CLAUDE_MD_ENTRY'
  | 'WORKSPACE_OUTSIDE_ALLOWED_ROOT'
  | 'CLAUDE_BINARY_MISSING'
  | 'WARM_TIMEOUT'
  | 'CLAUDE_OUTPUT_PARSE_FAILED'
  | 'CLAUDE_IS_ERROR'
  | 'UNEXPECTED_ERROR';

export interface WarmCacheInput {
  /** Slug do projeto (NÃO path) — resolvido via CLAUDE.md global. */
  projectSlug: string;
}

export interface WarmCacheResult {
  projectSlug: string;
  /** ISO string capturada no início (antes do execFile). */
  startedAt: string;
  /** Duração total medida no agente (ms). */
  durationMs: number;
  /**
   * Exit code do `claude`. `0` em sucesso, `null` em sinal sem código
   * (raro), número >0 em erro.
   */
  exitCode: number | null;
  /**
   * True se warm completou (`exitCode=0` E não houve `is_error=true`
   * no payload). False indica que algo deu errado — `errorCode` carrega
   * o detalhe.
   */
  success: boolean;
  /** SessionId do payload do claude (UUID), null se parse falhou. */
  claudeSessionId: string | null;
  /** Tokens cobrados como criação de cache (Anthropic API). */
  cacheCreationTokens: number;
  /** Tokens lidos do cache existente (a métrica que o warmer quer maximizar). */
  cacheReadTokens: number;
  /** Tokens de input não-cacheados. */
  inputTokens: number;
  /** Tokens de output gerados. */
  outputTokens: number;
  /** Custo reportado pelo CLI (já calculado pela Anthropic com pricing atual). */
  costUsd: number;
  /** Código semântico se algo falhou. undefined em success=true. */
  errorCode?: WarmCacheErrorCode;
  /** Mensagem opcional para logs/debugging (truncada). */
  errorMessage?: string;
}

export interface WarmCacheDeps {
  config: AgentConfig;
  /** Bloco já validado — caller garante existência. */
  cacheWarmerConfig: CacheWarmerConfig;
  logger: Logger;
  /** Override do execFile (testes). Default: `child_process.execFile`. */
  execFileImpl?: typeof execFile;
  /** Override do resolver (testes). Default: resolveProjectPath. */
  resolveImpl?: typeof resolveProjectPath;
  /** Override do allowlist (testes). Default: validateWorkspace. */
  validateImpl?: typeof validateWorkspace;
  /** Override de readFile (testes). Default: `fs/promises.readFile`. */
  readFileImpl?: (path: string, enc: BufferEncoding) => Promise<string>;
  /** Override de Date.now (testes). Default: `Date.now`. */
  clockImpl?: () => number;
}

/**
 * Aquece o prompt cache de UM projeto. Nunca lança — todos os erros são
 * mapeados em `WarmCacheResult` com `success=false` + `errorCode`.
 * O caller (`cache-warmer-loop.ts`) reporta cada resultado individualmente
 * ao backend, não importa se sucesso ou falha — telemetria completa.
 */
export async function warmCache(
  input: WarmCacheInput,
  deps: WarmCacheDeps,
): Promise<WarmCacheResult> {
  const {
    config,
    cacheWarmerConfig,
    logger,
    execFileImpl = execFile,
    resolveImpl = resolveProjectPath,
    validateImpl = validateWorkspace,
    readFileImpl = (p, e) => readFile(p, e),
    clockImpl = Date.now,
  } = deps;

  const log = logger.child({
    component: 'warm-cache',
    projectSlug: input.projectSlug,
  });

  const startedAtMs = clockImpl();
  const startedAt = new Date(startedAtMs).toISOString();

  // ─── 1. resolveProjectPath (slug → cwd via CLAUDE.md global) ─────────────
  let rawCwd: string;
  try {
    rawCwd = resolveImpl(input.projectSlug, config.claudeMdPath);
  } catch (err) {
    const code = err instanceof IdentityResolverError ? err.code : 'UNKNOWN_PROJECT_SLUG';
    const errorCode: WarmCacheErrorCode =
      code === 'INVALID_CLAUDE_MD_ENTRY' ? 'INVALID_CLAUDE_MD_ENTRY' : 'UNKNOWN_PROJECT_SLUG';
    return failed(input.projectSlug, startedAt, clockImpl() - startedAtMs, errorCode, err, log);
  }

  // ─── 2. validateWorkspace (allowlist + realpath) ─────────────────────────
  let canonicalCwd: string;
  try {
    canonicalCwd = validateImpl(rawCwd, config.allowedProjectRoots);
  } catch (err) {
    if (err instanceof AllowlistError) {
      return failed(
        input.projectSlug,
        startedAt,
        clockImpl() - startedAtMs,
        'WORKSPACE_OUTSIDE_ALLOWED_ROOT',
        err,
        log,
      );
    }
    return failed(
      input.projectSlug,
      startedAt,
      clockImpl() - startedAtMs,
      'UNEXPECTED_ERROR',
      err,
      log,
    );
  }

  // ─── 3. Lê CLAUDE.md → systemPrompt ──────────────────────────────────────
  // Mesmo padrão do handler real: ausência NÃO impede o warm (apenas warn).
  // Mas se ausente, o warmer aquece um cache DIFERENTE do que tasks reais
  // usam (que SEMPRE têm CLAUDE.md). Por isso a ausência é um alerta sério.
  let systemPrompt: string | undefined;
  try {
    const content = await readFileImpl(config.claudeMdPath, 'utf-8');
    if (content.trim() !== '') {
      systemPrompt = content;
    }
  } catch {
    log.warn(
      { path: config.claudeMdPath },
      'CLAUDE.md global ausente — warm sem --system-prompt (paridade comprometida)',
    );
  }

  // ─── 4. buildClaudeArgs — paridade byte-a-byte com runner real ───────────
  const { args } = buildClaudeArgs({
    prompt: cacheWarmerConfig.warmupPrompt,
    systemPrompt,
    extraFlags: cacheWarmerConfig.claudeFlags,
  });

  // ─── 5. execFile (próprio timeout — não usa runClaudeCode wrapper) ──────
  // Por que não usa `runClaudeCode`: o wrapper carrega timeout default de
  // 30min (handler real). Warmer quer 30s. Além disso, não queremos arrastar
  // semântica de "task real" para um warm (logs, errorCodes, etc).
  const timeoutMs = cacheWarmerConfig.timeoutSeconds * 1000;

  const runResult = await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    spawnErr: ExecFileException | null;
  }>((resolve) => {
    const child = execFileImpl(
      CLAUDE_BINARY,
      args,
      {
        cwd: canonicalCwd,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const e = err as (ExecFileException & { stdout?: string; stderr?: string }) | null;
        if (e === null) {
          resolve({
            stdout: toStr(stdout),
            stderr: toStr(stderr),
            exitCode: 0,
            timedOut: false,
            spawnErr: null,
          });
          return;
        }
        const timedOut = e.killed === true || e.signal === 'SIGTERM';
        const exitCode = typeof e.code === 'number' ? e.code : timedOut ? null : 1;
        resolve({
          stdout: toStr(e.stdout ?? stdout),
          stderr: toStr(e.stderr ?? stderr),
          exitCode,
          timedOut,
          spawnErr: e,
        });
      },
    );
    child.on('error', () => {
      /* engolido — callback do execFile já trata. */
    });
  });

  const durationMs = clockImpl() - startedAtMs;

  // ─── 6. Categoriza erros pre-parse ───────────────────────────────────────
  if (runResult.timedOut) {
    log.warn({ timeoutMs }, 'warm timeout');
    return {
      projectSlug: input.projectSlug,
      startedAt,
      durationMs,
      exitCode: runResult.exitCode,
      success: false,
      claudeSessionId: null,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      errorCode: 'WARM_TIMEOUT',
      errorMessage: `excedeu ${cacheWarmerConfig.timeoutSeconds}s`,
    };
  }

  if (
    runResult.spawnErr &&
    (runResult.spawnErr.code === 'ENOENT' || /not found/i.test(runResult.stderr))
  ) {
    log.error({ stderr: runResult.stderr }, 'binario claude ausente');
    return {
      projectSlug: input.projectSlug,
      startedAt,
      durationMs,
      exitCode: runResult.exitCode,
      success: false,
      claudeSessionId: null,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      errorCode: 'CLAUDE_BINARY_MISSING',
      errorMessage: truncate(runResult.stderr, 500),
    };
  }

  // ─── 7. Parse do JSON (extrai sessionId + tokens + custo) ───────────────
  const parsed = parseWarmOutput(runResult.stdout);
  if (parsed === null) {
    log.warn(
      { exitCode: runResult.exitCode, stdoutPreview: runResult.stdout.slice(0, 300) },
      'output JSON malformado',
    );
    return {
      projectSlug: input.projectSlug,
      startedAt,
      durationMs,
      exitCode: runResult.exitCode,
      success: false,
      claudeSessionId: null,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      errorCode: 'CLAUDE_OUTPUT_PARSE_FAILED',
      errorMessage: truncate(runResult.stderr, 500),
    };
  }

  const isError = parsed.isError === true;
  const exitOk = runResult.exitCode === 0;
  const success = exitOk && !isError;

  if (!success) {
    log.warn({ exitCode: runResult.exitCode, isError }, 'warm reportou erro');
  } else {
    log.info(
      {
        cacheReadTokens: parsed.cacheReadTokens,
        cacheCreationTokens: parsed.cacheCreationTokens,
        costUsd: parsed.costUsd,
        durationMs,
      },
      'warm ok',
    );
  }

  return {
    projectSlug: input.projectSlug,
    startedAt,
    durationMs,
    exitCode: runResult.exitCode,
    success,
    claudeSessionId: parsed.sessionId,
    cacheCreationTokens: parsed.cacheCreationTokens,
    cacheReadTokens: parsed.cacheReadTokens,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    costUsd: parsed.costUsd,
    ...(success
      ? {}
      : { errorCode: 'CLAUDE_IS_ERROR' as const, errorMessage: 'is_error=true ou exitCode!=0' }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

interface ParsedWarmOutput {
  sessionId: string | null;
  isError: boolean;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Parser tolerante (warm não precisa do shape estrito que `parseClaudeOutput`
 * exige — aceitamos JSON quebrado com fallback de métricas zero). Extrai
 * tokens do `usage` que é onde o Anthropic API reporta cache_creation /
 * cache_read.
 */
function parseWarmOutput(stdout: string): ParsedWarmOutput | null {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    if (parsed.type !== 'result') return null;

    const sessionId = typeof parsed.session_id === 'string' ? parsed.session_id : null;
    const isError = parsed.is_error === true;
    const costUsd = typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : 0;

    const usage = (parsed.usage as Record<string, unknown> | undefined) ?? {};
    const cacheCreationTokens = readNumber(usage.cache_creation_input_tokens);
    const cacheReadTokens = readNumber(usage.cache_read_input_tokens);
    const inputTokens = readNumber(usage.input_tokens);
    const outputTokens = readNumber(usage.output_tokens);

    return {
      sessionId,
      isError,
      cacheCreationTokens,
      cacheReadTokens,
      inputTokens,
      outputTokens,
      costUsd,
    };
  } catch {
    return null;
  }
}

function readNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function failed(
  projectSlug: string,
  startedAt: string,
  durationMs: number,
  errorCode: WarmCacheErrorCode,
  err: unknown,
  logger: Logger,
): WarmCacheResult {
  const message = err instanceof Error ? err.message : String(err);
  logger.warn({ errorCode, err: message }, 'warm falhou pre-execFile');
  return {
    projectSlug,
    startedAt,
    durationMs,
    exitCode: null,
    success: false,
    claudeSessionId: null,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    errorCode,
    errorMessage: truncate(message, 500),
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function toStr(v: string | Buffer | undefined | null): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  return v.toString('utf8');
}
