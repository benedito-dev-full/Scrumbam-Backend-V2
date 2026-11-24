/**
 * Spawn de `claude -p "<prompt>" --output-format json …` com controle do
 * GRUPO DE PROCESSOS (ADR-V2-083, L6).
 *
 * **Por que `spawn(detached)` e não mais `execFile`:**
 *  - A esteira roda `npm run build`, jest, hooks, `gh`, às vezes um dev server.
 *    Com `execFile`, o callback só dispara no `close` dos pipes; um NETO vivo
 *    (que herdou o stdout) segura o pipe ⇒ callback nunca chega ⇒ o mutex do
 *    slug fica preso para sempre (todo dispatch do projeto vira 409).
 *  - `detached: true` faz o `claude` liderar um grupo de processos próprio;
 *    o kill vai para o GRUPO (`process.kill(-pid, sig)`), alcançando os netos.
 *  - Resolve no `exit` do líder + dreno de até {@link DRAIN_MS} para o `close`
 *    dos pipes; logo após o `exit`, o grupo restante recebe SIGKILL (nenhum neto
 *    sobrevive à execução).
 *  - `stdio[0]='ignore'`: stdin fechado (antes o CLI esperava 3s por stdin).
 *  - Sem shell: argumentos vão direto no argv (sem injeção).
 *
 * **Timeout:** SIGTERM no grupo; se não sair em {@link KILL_GRACE_MS}, SIGKILL
 * no grupo (ADR-V2-082). `timedOut=true` em ambos.
 *
 * **Buffer:** até {@link MAX_BUFFER_BYTES} por stream (cabeça preservada).
 *
 * @see ADR-V2-032 (contrato run-claude-code), ADR-V2-082, ADR-V2-083
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { buildClaudeArgs, type BuildClaudeArgsInput } from './command-builder';

const DEFAULT_TIMEOUT_SEC = 30 * 60; // 30min (modo simples)
/** Tolerância entre SIGTERM (timeout) e SIGKILL forçado (ADR-V2-082). */
export const KILL_GRACE_MS = 15_000;
/** Espera pelo `close` dos pipes depois do `exit` do líder (ADR-V2-083). */
export const DRAIN_MS = 5_000;
/** Teto de captura por stream. */
export const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB
const CLAUDE_BINARY = 'claude';

/** Assinatura mínima de `spawn` usada aqui (injetável em testes). */
export type SpawnImpl = (file: string, args: string[], opts: SpawnOptions) => ChildProcess;

/** Envia sinal ao GRUPO do processo (injetável em testes). */
export type KillGroupImpl = (pid: number, signal: NodeJS.Signals) => void;

/** Kill de grupo real: `-pid` = grupo inteiro (o líder foi criado com `detached`). */
export const defaultKillGroup: KillGroupImpl = (pid, signal) => {
  process.kill(-pid, signal);
};

export interface RunnerInput
  extends Pick<
    BuildClaudeArgsInput,
    'appendSystemPrompt' | 'jsonSchema' | 'excludeDynamicSections' | 'maxBudgetUsd'
  > {
  /** Prompt completo enviado ao Claude Code. Vai como `-p <prompt>` (argv). */
  prompt: string;
  /** Diretório de trabalho. Já canonicalizado e validado pelo allowlist. */
  cwd: string;
  /** Se presente, passa `--resume <id>` para continuar sessão anterior. */
  resumeSessionId?: string | null;
  /** Timeout em segundos. Default 30min. */
  timeoutSec?: number;
  /** Override do spawn (testes). */
  spawnImpl?: SpawnImpl;
  /** Override do kill de grupo (testes). */
  killGroupImpl?: KillGroupImpl;
  /** Override do grace SIGTERM→SIGKILL em ms (testes). */
  killGraceMs?: number;
  /** Override do dreno pós-exit em ms (testes). */
  drainMs?: number;
}

export interface RunnerResult {
  /** Stdout (até o teto). Pode conter JSON do Claude Code. */
  stdout: string;
  /** Stderr (até o teto). */
  stderr: string;
  /** Exit code. `0` em sucesso; `null` se morto por sinal. */
  exitCode: number | null;
  /** Sinal que terminou o processo ou null. */
  signal: string | null;
  /** True se encerrado pelo timeout (SIGTERM ou SIGKILL forçado). */
  timedOut: boolean;
  /** Duração medida no agente, em ms. */
  durationMs: number;
}

/** Entrada genérica do executor de grupo (exportado para teste com processo real). */
export interface SpawnGroupInput {
  binary: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  spawnImpl?: SpawnImpl;
  killGroupImpl?: KillGroupImpl;
  killGraceMs?: number;
  drainMs?: number;
  maxBufferBytes?: number;
}

/**
 * Executa um binário num grupo de processos próprio, com timeout, kill de
 * grupo e dreno. Nunca lança.
 *
 * @param input - Binário, argv, cwd, timeout e overrides
 * @returns Resultado (stdout/stderr/exitCode/signal/timedOut/durationMs)
 */
export async function spawnInProcessGroup(input: SpawnGroupInput): Promise<RunnerResult> {
  const spawnFn: SpawnImpl = input.spawnImpl ?? (spawn as unknown as SpawnImpl);
  const killGroup = input.killGroupImpl ?? defaultKillGroup;
  const killGraceMs =
    input.killGraceMs !== undefined && input.killGraceMs >= 0 ? input.killGraceMs : KILL_GRACE_MS;
  const drainMs = input.drainMs !== undefined && input.drainMs >= 0 ? input.drainMs : DRAIN_MS;
  const cap = input.maxBufferBytes ?? MAX_BUFFER_BYTES;
  const startMs = Date.now();

  return await new Promise<RunnerResult>((resolve) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let settled = false;
    let timedOut = false;
    let exitCode: number | null = null;
    let exitSignal: string | null = null;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let drainTimer: NodeJS.Timeout | undefined;

    let child: ChildProcess;
    try {
      child = spawnFn(input.binary, input.args, {
        cwd: input.cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      resolve({
        stdout: '',
        stderr: e instanceof Error ? e.message : String(e),
        exitCode: -1,
        signal: null,
        timedOut: false,
        durationMs: Date.now() - startMs,
      });
      return;
    }

    const signalGroup = (signal: NodeJS.Signals): void => {
      const pid = child.pid;
      if (typeof pid !== 'number') return;
      try {
        killGroup(pid, signal);
      } catch {
        // ESRCH: grupo já vazio. Fallback: só o líder (se ainda vivo).
        try {
          child.kill(signal);
        } catch {
          /* processo já saiu */
        }
      }
    };

    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (drainTimer) clearTimeout(drainTimer);
      child.stdout?.removeAllListeners('data');
      child.stderr?.removeAllListeners('data');
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        exitCode,
        signal: exitSignal,
        timedOut,
        durationMs: Date.now() - startMs,
      });
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (outBytes >= cap) return;
      const slice = chunk.subarray(0, cap - outBytes);
      out.push(slice);
      outBytes += slice.length;
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (errBytes >= cap) return;
      const slice = chunk.subarray(0, cap - errBytes);
      err.push(slice);
      errBytes += slice.length;
    });

    child.on('error', (e: NodeJS.ErrnoException) => {
      // ENOENT (binário ausente) etc. — não houve processo útil.
      if (exitCode === null) exitCode = -1;
      err.push(Buffer.from(String(e.message ?? e)));
      finish();
    });

    child.on('exit', (code, signal) => {
      exitCode = typeof code === 'number' ? code : null;
      exitSignal = signal ?? null;
      // Ciclo 2 / M4: o líder saiu — o timeout não pode mais disparar durante o
      // dreno (marcaria timedOut=true indevido e mandaria SIGTERM a um pgid morto).
      // O SIGKILL do grace também perde o sentido (o grupo leva SIGKILL abaixo).
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      // L6: o líder saiu — qualquer neto restante no grupo é encerrado já,
      // para soltar os pipes e não sobreviver à execução.
      signalGroup('SIGKILL');
      drainTimer = setTimeout(finish, drainMs);
    });

    child.on('close', () => finish());

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      signalGroup('SIGTERM');
      killTimer = setTimeout(() => {
        if (settled) return;
        signalGroup('SIGKILL');
      }, killGraceMs);
    }, input.timeoutMs);
  });
}

/**
 * Executa o CLI `claude` e retorna stdout/stderr/exitCode. Nunca lança.
 *
 * @example
 *   const r = await runClaudeCode({ prompt: 'list files', cwd: '/home/dev/projetos/foo' });
 *   if (r.exitCode !== 0) reportError(r.stderr);
 */
export async function runClaudeCode(input: RunnerInput): Promise<RunnerResult> {
  const timeoutSec =
    input.timeoutSec && input.timeoutSec > 0 ? input.timeoutSec : DEFAULT_TIMEOUT_SEC;

  // Montagem do argv DELEGADA a `buildClaudeArgs` (ADR-V2-046) — mesma função
  // do Cache Warmer (paridade do prefixo cacheável).
  const { args } = buildClaudeArgs({
    prompt: input.prompt,
    appendSystemPrompt: input.appendSystemPrompt,
    jsonSchema: input.jsonSchema,
    excludeDynamicSections: input.excludeDynamicSections,
    maxBudgetUsd: input.maxBudgetUsd,
    resumeSessionId: input.resumeSessionId,
  });

  return spawnInProcessGroup({
    binary: CLAUDE_BINARY,
    args,
    cwd: input.cwd,
    timeoutMs: timeoutSec * 1000,
    spawnImpl: input.spawnImpl,
    killGroupImpl: input.killGroupImpl,
    killGraceMs: input.killGraceMs,
    drainMs: input.drainMs,
  });
}
