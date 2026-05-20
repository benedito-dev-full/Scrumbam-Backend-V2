/**
 * Loop periódico do Cache Warmer.
 *
 * Padrão arquitetural espelhado de `heartbeat-loop.ts`:
 *   - `setInterval` injetável (sem BullMQ — agent não tem Redis).
 *   - `tick()` async que NUNCA crasha (catch-and-log).
 *   - `stop()` idempotente.
 *   - `triggerNow()` para smoke test manual.
 *   - Contagem de falhas consecutivas — após 5, loga `circuit_open: true`
 *     mas CONTINUA tentando (alinhado ao heartbeat).
 *
 * Decisões deste loop:
 *  - **Sequencial entre projetos** com 2s de espaçamento.
 *    Resistência > velocidade — elimina contenção de rate limit Anthropic.
 *  - **Falha de 1 projeto NÃO derruba os outros.**
 *  - **Telemetria via log estruturado pino** — observabilidade via SSH +
 *    journalctl + Anthropic Console. Sem persistência no backend.
 *  - **Kill switch `dailyCostCapUsd`**: contador em memória acumula
 *    `costUsd` de cada warm. Quando atinge cap, loop pausa novos ticks até
 *    a virada do dia operacional. Reseta no restart. Defesa contra (a) bug
 *    de loop tight, (b) desvio de pricing Anthropic.
 */
import type { Logger } from 'pino';
import { warmCache, type WarmCacheResult } from '../handlers/warm-cache.handler';
import type { AgentConfig, CacheWarmerConfig } from '../config/schema';

const SEQUENTIAL_SPACING_MS = 2_000; // 2s entre projetos no mesmo tick
const CIRCUIT_OPEN_THRESHOLD = 5;

/** Handle retornado por `startCacheWarmerLoop` para o bootstrap parar no SIGTERM. */
export interface CacheWarmerHandle {
  /** Para o loop. Idempotente — chamadas extras são no-op. */
  stop(): void;
  /**
   * Dispara um ciclo imediato (útil para testes / smoke). Resolve quando
   * TODOS os projetos do ciclo terminaram (sucesso ou falha).
   */
  triggerNow(): Promise<void>;
}

/** Tunáveis — injetáveis em testes para acelerar/controlar o loop. */
export interface CacheWarmerLoopOptions {
  /** Override do intervalMs (em vez de derivar de config). Default: cfg.intervalMinutes * 60_000. */
  intervalMs?: number;
  /** Override do espaçamento entre projetos no mesmo tick. Default: 2_000ms. */
  sequentialSpacingMs?: number;
  /** setInterval injetável (testes). Default: global. */
  setIntervalImpl?: (fn: () => void, ms: number) => NodeJS.Timeout;
  /** clearInterval injetável (testes). */
  clearIntervalImpl?: (handle: NodeJS.Timeout) => void;
  /** sleep injetável (testes — fake timers). */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Função `now()` injetável. Default `Date.now`. */
  nowImpl?: () => number;
  /** Override de `warmCache` (testes evitam execFile real). */
  warmImpl?: typeof warmCache;
}

/**
 * Inicia o loop. NÃO dispara fire-and-forget no startup — o primeiro
 * ciclo acontece após `intervalMs`. Bootstrap pode chamar `triggerNow()`
 * se quiser warm imediato pós-boot.
 *
 * @example
 *   const handle = startCacheWarmerLoop(
 *     config, cacheWarmerConfig, backendClient, logger
 *   );
 *   process.on('SIGTERM', () => handle.stop());
 */
export function startCacheWarmerLoop(
  config: AgentConfig,
  cacheWarmerConfig: CacheWarmerConfig,
  logger: Logger,
  options: CacheWarmerLoopOptions = {},
): CacheWarmerHandle {
  const intervalMs = options.intervalMs ?? cacheWarmerConfig.intervalMinutes * 60_000;
  const spacingMs = options.sequentialSpacingMs ?? SEQUENTIAL_SPACING_MS;
  const setIntervalFn = options.setIntervalImpl ?? setInterval;
  const clearIntervalFn = options.clearIntervalImpl ?? clearInterval;
  const sleep = options.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.nowImpl ?? Date.now;
  const warmFn = options.warmImpl ?? warmCache;

  let stopped = false;
  let consecutiveFailures = 0;
  let circuitOpenLogged = false;

  // Kill switch: contador de custo do dia operacional. Reseta quando
  // o "ymd" (YYYY-MM-DD UTC) muda.
  let costAccumulator = { ymd: ymd(now()), totalUsd: 0 };

  function checkAndRefreshDailyCap(timestamp: number): {
    capped: boolean;
    todaySpentUsd: number;
  } {
    const today = ymd(timestamp);
    if (today !== costAccumulator.ymd) {
      logger.info(
        {
          stage: 'cache-warmer.kill-switch',
          previousYmd: costAccumulator.ymd,
          previousTotalUsd: costAccumulator.totalUsd,
        },
        'kill switch — virada do dia, contador resetado',
      );
      costAccumulator = { ymd: today, totalUsd: 0 };
    }

    const cap = cacheWarmerConfig.dailyCostCapUsd;
    const capped = cap > 0 && costAccumulator.totalUsd >= cap;
    return { capped, todaySpentUsd: costAccumulator.totalUsd };
  }

  async function tick(): Promise<void> {
    if (stopped) return;

    const { capped, todaySpentUsd } = checkAndRefreshDailyCap(now());
    if (capped) {
      logger.warn(
        {
          stage: 'cache-warmer.kill-switch',
          dailyCostCapUsd: cacheWarmerConfig.dailyCostCapUsd,
          todaySpentUsd,
        },
        'cache warmer pausado — cap de custo diário atingido (resume na virada do dia)',
      );
      return;
    }

    let tickHadFailure = false;

    for (let i = 0; i < cacheWarmerConfig.projects.length; i += 1) {
      if (stopped) break;

      const slug = cacheWarmerConfig.projects[i];
      if (slug === undefined) continue;

      // Espaçamento entre projetos NO MESMO tick.
      if (i > 0 && spacingMs > 0) {
        await sleep(spacingMs);
      }

      // Re-check cap entre projetos do mesmo tick — defesa contra o caso
      // de um único tick passar do cap (vários warms sucessivos).
      const recheck = checkAndRefreshDailyCap(now());
      if (recheck.capped) {
        logger.warn(
          {
            stage: 'cache-warmer.kill-switch',
            todaySpentUsd: recheck.todaySpentUsd,
            remainingProjects: cacheWarmerConfig.projects.length - i,
          },
          'cap atingido no meio do tick — abortando projetos restantes',
        );
        break;
      }

      let result: WarmCacheResult;
      try {
        result = await warmFn({ projectSlug: slug }, { config, cacheWarmerConfig, logger });
      } catch (err) {
        // warmCache promete nunca lançar. Se mesmo assim lançar, defesa.
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { stage: 'cache-warmer', projectSlug: slug, err: message },
          'warmCache lancou (defeito interno) — continuando proximos projetos',
        );
        tickHadFailure = true;
        continue;
      }

      // Atualiza contador de custo (sempre que warmCache reportou custo
      // > 0, mesmo que success=false — o token JÁ foi consumido).
      if (result.costUsd > 0) {
        costAccumulator.totalUsd += result.costUsd;
      }

      // Telemetria local — log estruturado pino. Observabilidade via SSH
      // na VPS (journalctl/tail). Cruzar com Anthropic Console pra validar
      // cache_read_input_tokens > 0 nas tasks reais subsequentes.
      logger.info(
        {
          stage: 'cache-warmer.report',
          projectSlug: result.projectSlug,
          startedAt: result.startedAt,
          durationMs: result.durationMs,
          claudeSessionId: result.claudeSessionId,
          exitCode: result.exitCode,
          success: result.success,
          cacheCreationTokens: result.cacheCreationTokens,
          cacheReadTokens: result.cacheReadTokens,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd.toFixed(6),
          ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
        },
        'cache warm concluído',
      );

      if (!result.success) {
        tickHadFailure = true;
      }
    }

    // Atualiza circuito.
    if (tickHadFailure) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD && !circuitOpenLogged) {
        logger.error(
          {
            stage: 'cache-warmer',
            consecutiveFailures,
            circuit_open: true,
          },
          'cache-warmer circuit aberto (5+ ticks com falha) — continua tentando',
        );
        circuitOpenLogged = true;
      }
    } else if (consecutiveFailures > 0 || circuitOpenLogged) {
      logger.info(
        {
          stage: 'cache-warmer',
          recoveredAfterFailures: consecutiveFailures,
        },
        'cache-warmer recuperado',
      );
      consecutiveFailures = 0;
      circuitOpenLogged = false;
    }
  }

  const handle = setIntervalFn(() => {
    void tick();
  }, intervalMs);

  logger.info(
    {
      stage: 'cache-warmer',
      intervalMs,
      projects: cacheWarmerConfig.projects,
      dailyCostCapUsd: cacheWarmerConfig.dailyCostCapUsd,
    },
    'cache-warmer loop iniciado',
  );

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearIntervalFn(handle);
      logger.info({ stage: 'cache-warmer' }, 'cache-warmer loop encerrado');
    },
    async triggerNow(): Promise<void> {
      await tick();
    },
  };
}

/** YYYY-MM-DD em UTC para indexar o contador diário. */
function ymd(t: number): string {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
