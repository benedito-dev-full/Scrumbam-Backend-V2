/**
 * Spawn de `claude -p "<prompt>" --output-format json [--resume <id>]`.
 *
 * **Por que `execFile` (não `exec` nem `spawn` shell):**
 *  - `exec` invoca shell → vulnerável a shell injection se o prompt
 *    contiver `$()`, backticks, redirects, etc. Mesmo "confiável", evitamos.
 *  - `execFile` passa argumentos diretamente ao processo, sem shell. O
 *    prompt vai como argv[N] — não é interpretado.
 *
 * O CLI `claude` aceita `-p "<prompt>"` como argumento. Em versões recentes
 * (≥2.1.139 confirmado no spike do CEO), o output JSON tem o shape:
 * `{ type: "result", session_id, result, is_error, duration_ms, ... }`.
 *
 * **Timeout:** vem do payload (`timeoutSec`, default 30min). `execFile`
 * com `timeout` envia SIGTERM e depois SIGKILL — captura o que tem em
 * `stdout`/`stderr` mesmo no abort.
 *
 * **maxBuffer:** 10MB. Output JSON do Claude Code tem `usage.iterations`
 * que pode crescer, mas 10MB é folga gigante. Se estourar, `execFile`
 * rejeita com `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` — handler reporta.
 *
 * @see ADR-V2-032 (contrato run-claude-code)
 */
import { execFile, type ExecFileException } from 'node:child_process';

const DEFAULT_TIMEOUT_SEC = 30 * 60; // 30min
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB
const CLAUDE_BINARY = 'claude';

export interface RunnerInput {
  /** Prompt completo enviado ao Claude Code. Vai como `-p <prompt>` (argv). */
  prompt: string;
  /** Diretório de trabalho. Já canonicalizado e validado pelo allowlist. */
  cwd: string;
  /** Se presente, passa `--resume <id>` para continuar sessão anterior. */
  resumeSessionId?: string | null;
  /** Timeout em segundos. Default 30min. */
  timeoutSec?: number;
  /**
   * Se presente e não-vazio, passa `--system-prompt <conteúdo>` ao CLI.
   * Usado para injetar regras globais (ex: ~/.claude/CLAUDE.md) sem poluir
   * o `prompt` da tarefa — o histórico de intenções fica limpo.
   */
  systemPrompt?: string;
  /** Override do execFile (testes). Default: `child_process.execFile`. */
  execFileImpl?: typeof execFile;
}

export interface RunnerResult {
  /** Stdout completo (até maxBuffer). Pode conter JSON do Claude Code. */
  stdout: string;
  /** Stderr completo (até maxBuffer). */
  stderr: string;
  /**
   * Exit code do processo. `0` em sucesso. `null` se o processo foi
   * killado por sinal sem código (raro com timeout — execFile retorna
   * `1` na maioria das vezes).
   */
  exitCode: number | null;
  /** Sinal que terminou o processo (ex: 'SIGTERM' em timeout) ou null. */
  signal: string | null;
  /** True se o `execFile` reportou timeout (killed=true por timeout). */
  timedOut: boolean;
  /** Duração medida no agente (Date.now diff), em ms. */
  durationMs: number;
}

/**
 * Executa o CLI `claude` e retorna stdout/stderr/exitCode. Nunca lança —
 * exceções do `execFile` são capturadas e mapeadas em `RunnerResult` com
 * `exitCode != 0`. Caller decide o que fazer.
 *
 * **Decisão de captura:** mesmo em erro (`execFile` callback recebe `Error`),
 * `stdout`/`stderr` são preservados (Node anexa em `err.stdout`/`err.stderr`).
 * Aproveitamos — é exatamente o que precisamos pra parsear sessão mesmo
 * com exit≠0.
 *
 * @example
 *   const r = await runClaudeCode({
 *     prompt: 'list files',
 *     cwd: '/home/dev/projetos/foo',
 *   });
 *   if (r.exitCode !== 0) reportError(r.stderr);
 */
export async function runClaudeCode(input: RunnerInput): Promise<RunnerResult> {
  const timeoutSec =
    input.timeoutSec && input.timeoutSec > 0 ? input.timeoutSec : DEFAULT_TIMEOUT_SEC;
  const execFn = input.execFileImpl ?? execFile;

  // `--dangerously-skip-permissions`:
  //   No modo `-p` (headless/non-interactive), o Claude Code recusa Edit/Write
  //   por padrao porque nao tem como pedir confirmacao ao usuario. Em
  //   contexto de automation remota disparada pela UI, o usuario JA aprovou
  //   ao clicar "Executar" (e Risk Gate ja classificou + Approval Flow ja
  //   filtrou HIGH risk). Sem esta flag, todo run-claude-code termina em
  //   "permission denied" e working tree fica limpo (claude apenas planeja
  //   sem aplicar). Container do agent roda como `scrumban-agent` (sem root)
  //   dentro de allowedProjectRoots — blast radius contido.
  const args: string[] = [];

  // `--system-prompt`: injeta regras globais (ex: conteúdo do ~/.claude/CLAUDE.md)
  // antes do prompt da tarefa. Em modo `-p`, o Claude Code não lê o CLAUDE.md
  // global — esta flag supre essa ausência sem poluir o histórico da intenção.
  if (input.systemPrompt && input.systemPrompt.trim() !== '') {
    args.push('--system-prompt', input.systemPrompt);
  }

  args.push(
    '-p',
    input.prompt,
    '--output-format',
    'json',
    '--dangerously-skip-permissions',
  );
  if (input.resumeSessionId && input.resumeSessionId.length > 0) {
    args.push('--resume', input.resumeSessionId);
  }

  const startMs = Date.now();

  return await new Promise<RunnerResult>((resolve) => {
    const child = execFn(
      CLAUDE_BINARY,
      args,
      {
        cwd: input.cwd,
        timeout: timeoutSec * 1000,
        maxBuffer: MAX_BUFFER_BYTES,
        // O CLI deve respeitar locale básico; nada de shell.
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const durationMs = Date.now() - startMs;
        const e = err as (ExecFileException & { stdout?: string; stderr?: string }) | null;

        if (e === null) {
          resolve({
            stdout: toString(stdout),
            stderr: toString(stderr),
            exitCode: 0,
            signal: null,
            timedOut: false,
            durationMs,
          });
          return;
        }

        // Captura stdout/stderr mesmo em erro (Node preserva no err).
        const capturedOut = toString(e.stdout ?? stdout);
        const capturedErr = toString(e.stderr ?? stderr);

        // execFile com timeout: `killed=true` e `signal='SIGTERM'`.
        const timedOut = e.killed === true || e.signal === 'SIGTERM';
        const exitCode = typeof e.code === 'number' ? e.code : timedOut ? null : 1;

        resolve({
          stdout: capturedOut,
          stderr: capturedErr,
          exitCode,
          signal: typeof e.signal === 'string' ? e.signal : null,
          timedOut,
          durationMs,
        });
      },
    );

    // Defesa: se o child falhar pre-spawn (ENOENT do binário), o callback
    // ainda é invocado pelo Node — não precisamos de listener extra.
    // Apenas evitamos crash silencioso se o child emitir 'error' sem
    // callback (não deveria com execFile, mas defensivo).
    child.on('error', () => {
      /* engolido — callback do execFile já trata. */
    });
  });
}

function toString(v: string | Buffer | undefined | null): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  return v.toString('utf8');
}
