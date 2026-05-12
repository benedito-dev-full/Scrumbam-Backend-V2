/**
 * Parser do output JSON do `claude -p --output-format json` e fallback
 * de filesystem (`~/.claude/projects/<encoded-cwd>/*.jsonl`).
 *
 * **Shape do output (spike CEO em 2026-05-12, CLI v2.1.139):**
 * ```json
 * {
 *   "type": "result",
 *   "subtype": "success",
 *   "is_error": false,
 *   "session_id": "22df17ba-7d3d-4c0c-ad5d-234a9ad4b03d",
 *   "result": "ok",
 *   "duration_ms": 2514,
 *   "uuid": "f41c43f8-..." ← NÃO USAR (id da execução, não da sessão)
 *   ...
 * }
 * ```
 *
 * **ATENÇÃO CRÍTICA:** existem 2 UUIDs no payload do Claude Code:
 *  - `session_id` → canônico para `--resume <id>` (este é o que extraímos)
 *  - `uuid` → id da execução individual (NÃO reaproveitável)
 *
 * Snake_case (`session_id`) é confirmado pelo spike — NUNCA `sessionId`.
 *
 * **Fallback de filesystem** (defesa em profundidade caso CLI mude formato):
 * antes da execução, listamos `~/.claude/projects/<encoded-cwd>/` (encoded
 * substituindo `/` por `-`). Após exec, listamos de novo e identificamos o
 * `.jsonl` recém-criado. Nome do arquivo é `<session-id>.jsonl`.
 *
 * @see ADR-V2-032 (contrato sessão Claude Code)
 */
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resultado de uma extração bem-sucedida do output JSON do Claude Code. */
export interface ParsedClaudeOutput {
  sessionId: string;
  isError: boolean;
  /** Texto livre que o Claude Code devolveu como resposta principal. */
  result: string | null;
  durationMs: number | null;
  totalCostUsd: number | null;
  terminalReason: string | null;
  stopReason: string | null;
  /** Mantemos o JSON inteiro para debug — caller pode logar em verbose. */
  raw: Record<string, unknown>;
}

export class SessionParseError extends Error {
  public readonly code:
    | 'CLAUDE_OUTPUT_NOT_JSON'
    | 'CLAUDE_OUTPUT_UNEXPECTED_TYPE'
    | 'CLAUDE_OUTPUT_MISSING_SESSION_ID'
    | 'CLAUDE_OUTPUT_INVALID_SESSION_ID';

  constructor(code: SessionParseError['code'], message: string) {
    super(message);
    this.name = 'SessionParseError';
    this.code = code;
  }
}

/**
 * Tenta parsear stdout como o JSON do Claude Code e extrair `session_id`.
 *
 * @throws SessionParseError se shape não corresponder.
 */
export function parseClaudeOutput(stdout: string): ParsedClaudeOutput {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SessionParseError('CLAUDE_OUTPUT_NOT_JSON', `stdout nao e JSON valido: ${message}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SessionParseError('CLAUDE_OUTPUT_UNEXPECTED_TYPE', 'stdout JSON nao e objeto');
  }

  if (parsed.type !== 'result') {
    throw new SessionParseError(
      'CLAUDE_OUTPUT_UNEXPECTED_TYPE',
      `output.type esperado "result", recebido ${JSON.stringify(parsed.type)}`,
    );
  }

  const sessionIdRaw = parsed.session_id;
  if (typeof sessionIdRaw !== 'string' || sessionIdRaw.length === 0) {
    throw new SessionParseError(
      'CLAUDE_OUTPUT_MISSING_SESSION_ID',
      'campo session_id ausente ou vazio',
    );
  }

  if (!UUID_REGEX.test(sessionIdRaw)) {
    throw new SessionParseError(
      'CLAUDE_OUTPUT_INVALID_SESSION_ID',
      `session_id "${sessionIdRaw}" nao e UUID valido`,
    );
  }

  return {
    sessionId: sessionIdRaw,
    isError: parsed.is_error === true,
    result: typeof parsed.result === 'string' ? parsed.result : null,
    durationMs: typeof parsed.duration_ms === 'number' ? parsed.duration_ms : null,
    totalCostUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null,
    terminalReason: typeof parsed.terminal_reason === 'string' ? parsed.terminal_reason : null,
    stopReason: typeof parsed.stop_reason === 'string' ? parsed.stop_reason : null,
    raw: parsed,
  };
}

/**
 * Converte `cwd` no formato que Claude Code usa para nomear o diretório
 * dentro de `~/.claude/projects/`. A convenção é substituir todos os `/`
 * por `-`. Exemplo: `/home/dev/projetos/Scrumban-Backend-V2` →
 * `-home-dev-projetos-Scrumban-Backend-V2`.
 */
export function encodeCwdForClaudeProjects(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

/**
 * Path do `.jsonl` da sessão dado o cwd e o session_id.
 * `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.
 */
export function computeSessionJsonlPath(cwd: string, sessionId: string): string {
  const encoded = encodeCwdForClaudeProjects(cwd);
  return join(homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`);
}

/** Opções para o fallback filesystem — injetáveis em testes. */
export interface FallbackOptions {
  /** Override do readdirSync (testes). */
  readdir?: (path: string) => string[];
  /** Override do homedir (testes). */
  homeDir?: () => string;
}

/**
 * Fallback: lê `~/.claude/projects/<encoded-cwd>/` e retorna o session_id
 * de um arquivo `.jsonl` que apareceu após a execução.
 *
 * Estratégia:
 *  - Recebe `beforeFiles` (lista capturada ANTES do spawn).
 *  - Lista o diretório AGORA.
 *  - Diff: arquivo `.jsonl` que existe agora mas não em `beforeFiles`.
 *  - Extrai o UUID do nome do arquivo (`<uuid>.jsonl`).
 *
 * Se múltiplos arquivos novos: pega o primeiro com nome UUID válido. Em
 * teoria não deveria acontecer (mutex por slug impede execuções
 * concorrentes no mesmo cwd), mas log de warn no caller.
 *
 * Retorna `null` se nenhum candidato encontrado.
 */
export function findNewSessionIdFromFilesystem(
  cwd: string,
  beforeFiles: readonly string[],
  options: FallbackOptions = {},
): string | null {
  const readdir = options.readdir ?? ((p: string) => readdirSync(p));
  const home = options.homeDir ? options.homeDir() : homedir();

  const encoded = encodeCwdForClaudeProjects(cwd);
  const dir = join(home, '.claude', 'projects', encoded);

  let nowFiles: string[];
  try {
    nowFiles = readdir(dir);
  } catch {
    // Diretório pode não existir ainda (primeira execução nunca aconteceu).
    return null;
  }

  const before = new Set(beforeFiles);
  const candidates = nowFiles.filter((f) => !before.has(f) && f.endsWith('.jsonl'));

  for (const candidate of candidates) {
    const uuid = candidate.slice(0, -'.jsonl'.length);
    if (UUID_REGEX.test(uuid)) {
      return uuid;
    }
  }

  return null;
}

/**
 * Snapshot de arquivos `.jsonl` no diretório da sessão. Caller chama ANTES
 * do spawn e passa o resultado para `findNewSessionIdFromFilesystem` depois.
 * Retorna [] se o diretório não existir.
 */
export function snapshotSessionDir(cwd: string, options: FallbackOptions = {}): string[] {
  const readdir = options.readdir ?? ((p: string) => readdirSync(p));
  const home = options.homeDir ? options.homeDir() : homedir();
  const encoded = encodeCwdForClaudeProjects(cwd);
  const dir = join(home, '.claude', 'projects', encoded);

  try {
    return readdir(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
}
