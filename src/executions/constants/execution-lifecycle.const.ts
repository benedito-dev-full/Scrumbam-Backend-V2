/**
 * Ciclo de vida terminal de execuções Claude Code (ADR-V2-082).
 *
 * Fonte ÚNICA dos limites de tempo e de retry usados por:
 *  - `ExecutionsService.execute` → grava `DPedido.dados.timeoutSec` na criação;
 *  - `ExecutionRunProcessor`     → envia `timeoutSec` ao agente e trata 409 PROJECT_BUSY;
 *  - `ExecutionRunningSweeperService` → deadline = startedAt + timeoutSec + margem.
 *
 * Valores sobrescrevíveis por env (ver {@link resolveExecutionLifecycleConfig}).
 * Nenhuma DClasse nova: o motivo da falha vive em `dados.audit.outcome.reason`
 * (atributo do desfecho, não tipo de registro).
 *
 * @see ADR-V2-082 (ciclo de vida terminal de execuções)
 */

/** Timeout default de uma execução (s). Também é o fallback de execuções legadas sem `timeoutSec`. */
export const EXECUTION_DEFAULT_TIMEOUT_SEC = 1800;

/** Limite inferior do timeout (s) — coerente com `CommandValidatorService` (30.000 ms). */
export const EXECUTION_TIMEOUT_MIN_SEC = 30;

/** Limite superior do timeout (s) — coerente com `CommandValidatorService` (3.600.000 ms). */
export const EXECUTION_TIMEOUT_MAX_SEC = 3600;

/**
 * Margem somada ao timeout para declarar uma RUNNING vencida (decisão CEO P4).
 * Cobre git checkout/pull + janela de retry do callback (~65s) + skew + 1 ciclo de cron.
 */
export const EXECUTION_DEADLINE_MARGIN_SEC = 300;

/** Teto de tentativas após 409 PROJECT_BUSY do agente (decisão CEO P2 — ~41 min). */
export const EXECUTION_BUSY_MAX_RETRIES = 10;

/** Delay base do backoff do 409 PROJECT_BUSY (ms). */
export const EXECUTION_BUSY_BASE_DELAY_MS = 30_000;

/** Teto do delay do backoff do 409 PROJECT_BUSY (ms). */
export const EXECUTION_BUSY_MAX_DELAY_MS = 300_000;

/**
 * Prazo (s) para uma execução QUEUED (-514) / APPROVED (-516) ser considerada
 * órfã (job perdido no Redis, ou `REDIS_ENABLED=false` sem processor) —
 * contado de `GREATEST(atualizadoEm, dispatch.nextAttemptAt)`. 15 min ≫ teto do
 * backoff de PROJECT_BUSY (300s), então retries legítimos nunca caem aqui.
 * Ciclo 2 / M3 (ADR-V2-082).
 */
export const EXECUTION_QUEUE_STALE_SEC = 900;

/** Máximo de linhas encerradas por ciclo do sweeper (evita lote gigante). */
export const EXECUTION_SWEEPER_BATCH_LIMIT = 100;

/**
 * Motivos de falha marcada pelo SISTEMA (`audit.outcome.source='system'`).
 * Strings estáveis — consumidas por log, evento `execution.failed` e frontend (F-2).
 */
export const EXECUTION_FAILURE_REASONS = {
  /** Deadline (startedAt + timeoutSec + margem) vencido sem callback. */
  TIMEOUT_NO_CALLBACK: 'TIMEOUT_NO_CALLBACK',
  /** Heartbeat mostra que o agente reiniciou depois do início da execução. */
  AGENT_RESTARTED: 'AGENT_RESTARTED',
  /** 409 PROJECT_BUSY após {@link EXECUTION_BUSY_MAX_RETRIES} tentativas. */
  PROJECT_BUSY_EXHAUSTED: 'PROJECT_BUSY_EXHAUSTED',
  /** Outra execução da mesma task já está RUNNING (CAS do markRunning). */
  DUPLICATE_TASK_EXECUTION: 'DUPLICATE_TASK_EXECUTION',
  /**
   * Túnel SSH do agente indisponível no probe pré-dispatch (Ciclo 3). O detalhe
   * técnico (`ECONNREFUSED`, `TUNNEL_TIMEOUT`, …) fica só em `claude.stderr`.
   */
  TUNNEL_UNAVAILABLE: 'TUNNEL_UNAVAILABLE',
  /**
   * Demais falhas de dispatch: ACK timeout, HTTP != 200 que não é busy, agente/projeto
   * não encontrado, contrato runtime incompleto, slug ausente, falha ao re-enfileirar.
   */
  DISPATCH_FAILED: 'DISPATCH_FAILED',
  /** Fechamento silencioso de RUNNING antigas pelo script de backfill (decisão CEO P3). */
  BACKFILL_STALE: 'BACKFILL_STALE',
  /** QUEUED/APPROVED sem dispatch além de EXECUTION_QUEUE_STALE_SEC (job perdido / sem Redis). */
  QUEUE_STALE: 'QUEUE_STALE',
} as const;

export type ExecutionFailureReason =
  (typeof EXECUTION_FAILURE_REASONS)[keyof typeof EXECUTION_FAILURE_REASONS];

/**
 * Lista CANÔNICA e fechada dos motivos de falha marcada pelo sistema
 * (`audit.outcome.reason` com `source='system'`) — Ciclo 3. É exatamente o
 * conjunto exposto em `ExecutionResponseDto.outcome.reason`; o frontend mapeia
 * cada código para um texto amigável. Adicionar código = atualizar ADR-V2-082
 * e o frontend.
 */
export const EXECUTION_FAILURE_REASON_CODES: readonly ExecutionFailureReason[] =
  Object.values(EXECUTION_FAILURE_REASONS);

/**
 * Type guard: o valor é um código canônico de falha sistêmica?
 *
 * @param value - Valor lido de `dados.audit.outcome.reason`
 * @returns true se pertence a {@link EXECUTION_FAILURE_REASON_CODES}
 */
export function isExecutionFailureReason(value: unknown): value is ExecutionFailureReason {
  return (
    typeof value === 'string' &&
    (EXECUTION_FAILURE_REASON_CODES as readonly string[]).includes(value)
  );
}

/**
 * Status de execução NÃO-terminais (DClasse -514..-518): QUEUED, AWAITING_APPROVAL,
 * APPROVED, RUNNING. Uma task com execução em um destes status não pode ser
 * reexecutada (409 `execution_in_progress`).
 */
export const NON_TERMINAL_STATUS_CODES: readonly string[] = ['-514', '-515', '-516', '-518'];

/** Status terminais (REJECTED, SUCCESS, FAILED, EXPIRED, ROLLED_BACK) — sempre `baixado=true`. */
export const TERMINAL_STATUS_CODES: readonly string[] = ['-517', '-519', '-520', '-521', '-522'];

/**
 * Configuração efetiva do ciclo de vida (constantes + overrides de env).
 */
export interface ExecutionLifecycleConfig {
  deadlineMarginSec: number;
  defaultTimeoutSec: number;
  busyMaxRetries: number;
  busyBaseDelayMs: number;
  busyMaxDelayMs: number;
  sweeperBatchLimit: number;
  queueStaleSec: number;
}

/**
 * Lê overrides de env (inteiros positivos); valor ausente/inválido = constante.
 *
 * Envs: `EXECUTION_DEADLINE_MARGIN_SEC`, `EXECUTION_DEFAULT_TIMEOUT_SEC`,
 * `EXECUTION_BUSY_MAX_RETRIES`, `EXECUTION_BUSY_BASE_DELAY_MS`,
 * `EXECUTION_BUSY_MAX_DELAY_MS`, `EXECUTION_SWEEPER_BATCH_LIMIT`, `EXECUTION_QUEUE_STALE_SEC`.
 *
 * @param env - Fonte das variáveis (default `process.env`; o `ConfigService`
 *   do Nest lê a mesma fonte). Parâmetro existe para teste.
 * @returns Configuração efetiva
 *
 * @example
 * const cfg = resolveExecutionLifecycleConfig();
 * cfg.deadlineMarginSec; // 300 (ou o override de env)
 */
export function resolveExecutionLifecycleConfig(
  env: Record<string, string | undefined> = process.env,
): ExecutionLifecycleConfig {
  const int = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined || raw.trim() === '') return fallback;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return {
    deadlineMarginSec: int('EXECUTION_DEADLINE_MARGIN_SEC', EXECUTION_DEADLINE_MARGIN_SEC),
    defaultTimeoutSec: int('EXECUTION_DEFAULT_TIMEOUT_SEC', EXECUTION_DEFAULT_TIMEOUT_SEC),
    busyMaxRetries: int('EXECUTION_BUSY_MAX_RETRIES', EXECUTION_BUSY_MAX_RETRIES),
    busyBaseDelayMs: int('EXECUTION_BUSY_BASE_DELAY_MS', EXECUTION_BUSY_BASE_DELAY_MS),
    busyMaxDelayMs: int('EXECUTION_BUSY_MAX_DELAY_MS', EXECUTION_BUSY_MAX_DELAY_MS),
    sweeperBatchLimit: int('EXECUTION_SWEEPER_BATCH_LIMIT', EXECUTION_SWEEPER_BATCH_LIMIT),
    queueStaleSec: int('EXECUTION_QUEUE_STALE_SEC', EXECUTION_QUEUE_STALE_SEC),
  };
}

/**
 * Resolve o timeout (s) que será gravado UMA vez em `DPedido.dados.timeoutSec`.
 *
 * Regra da fonte única (plano Task 2, Fase 2):
 *  - `command.timeoutMs` presente (modo COMMAND/HÍBRIDO) → `clamp(round(ms/1000), 30, 3600)`;
 *  - ausente/inválido (ou modo PROMPT sem override) → `defaultSec` (1800).
 *
 * @param command - Command estruturado (opcional)
 * @param defaultSec - Default quando não há timeout explícito
 * @returns Timeout em segundos, sempre dentro de [30, 3600]
 *
 * @example
 * resolveExecutionTimeoutSec({ timeoutMs: 60000 }); // 60
 * resolveExecutionTimeoutSec({ timeoutMs: 10 });    // 30 (clamp)
 * resolveExecutionTimeoutSec(undefined);            // 1800
 */
export function resolveExecutionTimeoutSec(
  command?: { timeoutMs?: number | null } | null,
  defaultSec: number = EXECUTION_DEFAULT_TIMEOUT_SEC,
): number {
  const ms = command?.timeoutMs;
  const base =
    typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : defaultSec;
  return Math.min(EXECUTION_TIMEOUT_MAX_SEC, Math.max(EXECUTION_TIMEOUT_MIN_SEC, base));
}

/**
 * Delay (ms) do retry após o N-ésimo 409 PROJECT_BUSY: backoff exponencial
 * `base * 2^(attempt-1)` com teto. Default: 30s, 60s, 120s, 240s, 300s, 300s…
 *
 * @param attempt - Tentativa (1-based)
 * @param baseMs - Delay base
 * @param maxMs - Teto
 * @returns Delay em ms
 *
 * @example
 * computeBusyDelayMs(1); // 30000
 * computeBusyDelayMs(5); // 300000 (teto)
 */
export function computeBusyDelayMs(
  attempt: number,
  baseMs: number = EXECUTION_BUSY_BASE_DELAY_MS,
  maxMs: number = EXECUTION_BUSY_MAX_DELAY_MS,
): number {
  const n = Math.max(1, Math.floor(attempt));
  // Evita overflow para attempt grande: a partir de 2^20 já passou de qualquer teto.
  const factor = Math.pow(2, Math.min(n - 1, 20));
  return Math.min(maxMs, baseMs * factor);
}

/**
 * Status simplificado (contrato do 409 `execution_in_progress` e do
 * `activeExecution` do frontend) a partir do `statusCode` da execução.
 *
 * @param statusCode - `dados.statusCode` (-514..-518)
 * @returns `'running' | 'queued' | 'awaiting_approval'`
 */
export function toActiveExecutionStatus(
  statusCode: string | undefined,
): 'running' | 'queued' | 'awaiting_approval' {
  if (statusCode === '-518') return 'running';
  if (statusCode === '-515') return 'awaiting_approval';
  return 'queued';
}

/**
 * Chave do advisory lock por task (Ciclo 2 / M1). Usada como
 * `pg_advisory_xact_lock(hashtext(<chave>))` no `markRunning` (processor) e na
 * trava+criação de `ExecutionsService.execute` — serializa por task e elimina o
 * write skew do `NOT EXISTS` sob READ COMMITTED.
 *
 * @param taskId - DTask.chave
 * @returns `exec-task:<taskId>`
 */
export function executionTaskLockKey(taskId: string): string {
  return `exec-task:${taskId}`;
}

/**
 * Marcador gravado em `DTask.dados.v3.movedBy` quando o SISTEMA move a task
 * para FAILED por falha sintética desta execução (Ciclo 2 / M2 + L7).
 * O callback tardio só promove FAILED→DONE se o FAILED tiver ESTE marcador —
 * nunca sobrescreve FAILED manual de usuário nem FAILED de outra execução.
 *
 * @param executionId - DPedido.chave da execução
 * @returns `system:execution-<executionId>`
 */
export function systemFailureMovedBy(executionId: string): string {
  return `system:execution-${executionId}`;
}

