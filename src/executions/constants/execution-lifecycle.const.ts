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
 * Timeout default (s) do MODO ESTEIRA (ADR-V2-083, decisão CEO P2): 4h.
 * A esteira multi-agent do repo (Strategist → Implementer → Reviewer →
 * Documenter) leva 3–4h por task; 30 min matava a esteira no meio.
 */
export const EXECUTION_PIPELINE_DEFAULT_TIMEOUT_SEC = 14_400;

/** Teto (s) do timeout no MODO ESTEIRA (ADR-V2-083, decisão CEO P2): 6h. */
export const EXECUTION_PIPELINE_TIMEOUT_MAX_SEC = 21_600;

/**
 * Tipos de task cujo sucesso exige PR verificado + decisão APPROVED da esteira
 * (ADR-V2-083). Os demais tipos (research/validation/other) também rodam pela
 * esteira (decisão CEO P1: sem fallback de execução simples), mas podem
 * terminar sem PR (`NO_CHANGES`).
 */
export const PIPELINE_PR_REQUIRED_TASK_TYPES: readonly string[] = ['code', 'docs'];

/** Versão do contrato de saída da esteira (`pipeline-result.schema.json`). */
export const PIPELINE_CONTRACT_VERSION = 1;

/**
 * Margem somada ao timeout para declarar uma RUNNING vencida (decisão CEO P4).
 * Cobre git checkout/pull + skew + 1 ciclo de cron. ADR-V2-083: o retry do
 * callback do agente 0.2.0 dura ~8 min (> margem) — um callback que chega
 * depois do deadline substitui o FAILED sintético (política P1 da ADR-V2-082).
 */
export const EXECUTION_DEADLINE_MARGIN_SEC = 300;

/**
 * @deprecated ADR-V2-083 (decisão CEO P4): a desistência do 409 PROJECT_BUSY
 * passou a ser POR TEMPO ({@link EXECUTION_BUSY_MAX_WAIT_SEC}), não por
 * contagem. Mantido só como referência histórica da Task 2 (~41 min) e para
 * o override de env legado continuar sendo lido sem erro.
 */
export const EXECUTION_BUSY_MAX_RETRIES = 10;

/**
 * Janela máxima (s) de espera por um projeto ocupado (409 PROJECT_BUSY) —
 * ADR-V2-083, decisão CEO P4 (revisa a P2 da Task 2). Uma esteira pode
 * segurar o projeto até o teto do modo esteira (6h); a 2ª execução espera
 * esse teto + a margem do deadline (~6h05) em vez de desistir após 10
 * tentativas (~41 min). Backoff continua 30s→300s.
 */
export const EXECUTION_BUSY_MAX_WAIT_SEC = EXECUTION_PIPELINE_TIMEOUT_MAX_SEC + 300;

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
  /** 409 PROJECT_BUSY além da janela {@link EXECUTION_BUSY_MAX_WAIT_SEC} (ADR-V2-083 / P4). */
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
  // ── Esteira headless (ADR-V2-083) ─────────────────────────────────────────
  /**
   * Repo do cliente sem o comando `.claude/commands/scrumban-executar.md`
   * (decisão CEO P1: parar e avisar, para TODOS os tipos de task).
   */
  PIPELINE_NOT_INSTALLED: 'PIPELINE_NOT_INSTALLED',
  /** Pré-condição da esteira ausente na VPS: `gh`/`GITHUB_TOKEN`, branch base, preparo do git. */
  PIPELINE_PRECONDITION_FAILED: 'PIPELINE_PRECONDITION_FAILED',
  /**
   * A esteira terminou sem o contrato de saída válido (JSON do schema v1) ou a
   * declaração não bate com o runtime (ex.: `APPROVED` sem o Reviewer ter rodado).
   */
  PIPELINE_CONTRACT_MISSING: 'PIPELINE_CONTRACT_MISSING',
  /** Esteira não aprovou (NEEDS_CHANGES/REJECTED/ABORTED) — PR fica em rascunho (P3). */
  PIPELINE_NOT_APPROVED: 'PIPELINE_NOT_APPROVED',
  /** Tipo que exige PR (code/docs) terminou sem PR verificado da esteira (P3). */
  PR_NOT_CREATED: 'PR_NOT_CREATED',
} as const;

export type ExecutionFailureReason =
  (typeof EXECUTION_FAILURE_REASONS)[keyof typeof EXECUTION_FAILURE_REASONS];

/**
 * Lista CANÔNICA e fechada dos motivos de falha (`audit.outcome.reason`) —
 * Ciclo 3 (ADR-V2-082) + esteira (ADR-V2-083). É exatamente o conjunto exposto
 * em `ExecutionResponseDto.outcome.reason`; o frontend mapeia cada código para
 * um texto amigável (com fallback genérico para código desconhecido).
 * Adicionar código = atualizar ADR-V2-082/083 e o frontend.
 */
export const EXECUTION_FAILURE_REASON_CODES: readonly ExecutionFailureReason[] =
  Object.values(EXECUTION_FAILURE_REASONS);

/**
 * Subconjunto de motivos que podem vir num desfecho `source='agent'` (callback
 * real), atribuídos pela política da esteira do Engine
 * (`OperacaoExecucaoClaude.avaliarDesfechoEsteira`) — ADR-V2-083. Motivos
 * sistêmicos (TIMEOUT_NO_CALLBACK…) NUNCA são expostos com `source='agent'`.
 */
export const EXECUTION_PIPELINE_REASON_CODES: readonly ExecutionFailureReason[] = [
  EXECUTION_FAILURE_REASONS.PIPELINE_NOT_INSTALLED,
  EXECUTION_FAILURE_REASONS.PIPELINE_PRECONDITION_FAILED,
  EXECUTION_FAILURE_REASONS.PIPELINE_CONTRACT_MISSING,
  EXECUTION_FAILURE_REASONS.PIPELINE_NOT_APPROVED,
  EXECUTION_FAILURE_REASONS.PR_NOT_CREATED,
];

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
  /** Timeout default do modo esteira (ADR-V2-083) — clamp no teto de 6h. */
  pipelineDefaultTimeoutSec: number;
  /** @deprecated ADR-V2-083 — desistência do busy é por tempo ({@link busyMaxWaitSec}). */
  busyMaxRetries: number;
  /** Janela máxima de espera por projeto ocupado, em segundos (ADR-V2-083 / P4). */
  busyMaxWaitSec: number;
  busyBaseDelayMs: number;
  busyMaxDelayMs: number;
  sweeperBatchLimit: number;
  queueStaleSec: number;
}

/**
 * Lê overrides de env (inteiros positivos); valor ausente/inválido = constante.
 *
 * Envs: `EXECUTION_DEADLINE_MARGIN_SEC`, `EXECUTION_DEFAULT_TIMEOUT_SEC`,
 * `EXECUTION_PIPELINE_DEFAULT_TIMEOUT_SEC`, `EXECUTION_BUSY_MAX_WAIT_SEC`,
 * `EXECUTION_BUSY_MAX_RETRIES` (deprecated), `EXECUTION_BUSY_BASE_DELAY_MS`,
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
    pipelineDefaultTimeoutSec: int(
      'EXECUTION_PIPELINE_DEFAULT_TIMEOUT_SEC',
      EXECUTION_PIPELINE_DEFAULT_TIMEOUT_SEC,
    ),
    busyMaxRetries: int('EXECUTION_BUSY_MAX_RETRIES', EXECUTION_BUSY_MAX_RETRIES),
    busyMaxWaitSec: int('EXECUTION_BUSY_MAX_WAIT_SEC', EXECUTION_BUSY_MAX_WAIT_SEC),
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
 * Resolve o timeout (s) do MODO ESTEIRA (ADR-V2-083, decisão CEO P2).
 *
 * O placeholder `command.timeoutMs` do modo PROMPT é ignorado (ele existe só
 * para o `CommandValidatorService`, limitado a 1h). Valor = `defaultSec`
 * (default 4h, override por env) com clamp em [30, 21600].
 *
 * @param defaultSec - Default efetivo (config de lifecycle)
 * @returns Timeout em segundos, dentro de [30, 21600]
 *
 * @example
 * resolvePipelineTimeoutSec();       // 14400
 * resolvePipelineTimeoutSec(99999);  // 21600 (teto)
 */
export function resolvePipelineTimeoutSec(
  defaultSec: number = EXECUTION_PIPELINE_DEFAULT_TIMEOUT_SEC,
): number {
  const base =
    Number.isFinite(defaultSec) && defaultSec > 0
      ? Math.round(defaultSec)
      : EXECUTION_PIPELINE_DEFAULT_TIMEOUT_SEC;
  return Math.min(EXECUTION_PIPELINE_TIMEOUT_MAX_SEC, Math.max(EXECUTION_TIMEOUT_MIN_SEC, base));
}

/**
 * A espera por projeto ocupado (409 PROJECT_BUSY) estourou a janela?
 * (ADR-V2-083, decisão CEO P4 — desistência por TEMPO, não por contagem.)
 *
 * @param firstBusyAt - ISO do 1º 409 recebido (ausente/inválido = começa agora → false)
 * @param nowMs - Relógio atual (ms)
 * @param maxWaitSec - Janela máxima (default {@link EXECUTION_BUSY_MAX_WAIT_SEC})
 * @returns true quando `now - firstBusyAt > maxWaitSec`
 *
 * @example
 * isBusyWaitExhausted('2026-11-23T00:00:00Z', Date.parse('2026-11-23T07:00:00Z')); // true
 */
export function isBusyWaitExhausted(
  firstBusyAt: string | undefined,
  nowMs: number,
  maxWaitSec: number = EXECUTION_BUSY_MAX_WAIT_SEC,
): boolean {
  if (!firstBusyAt) return false;
  const start = Date.parse(firstBusyAt);
  if (!Number.isFinite(start)) return false;
  return nowMs - start > maxWaitSec * 1000;
}

/**
 * Nome canônico da branch de uma execução da esteira (ADR-V2-083). O BACKEND
 * decide a branch (fonte de verdade); o agente só a prepara e verifica.
 *
 * @param executionId - DPedido.chave da execução
 * @returns `scrumban/exec-<executionId>`
 */
export function executionBranchName(executionId: string): string {
  return `scrumban/exec-${executionId}`;
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

