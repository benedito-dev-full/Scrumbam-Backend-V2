/**
 * Loop de heartbeat agent → backend (Sub-tarefa 3).
 *
 * A cada 30s, coleta snapshot de saúde do host + agente e chama
 * `backendClient.sendHeartbeat(payload)`. O `BackendClient` cuida do
 * retry/backoff/HMAC internamente — este módulo só:
 *   - dispara em intervalo fixo (setInterval)
 *   - coleta métricas leves (cpu via loadavg, mem via os.freemem/totalmem,
 *     uptime via process.uptime)
 *   - detecta Claude Code via `claude --version` (com cache 5min para evitar
 *     spawn a cada heartbeat)
 *   - conta falhas consecutivas — após 5, loga `circuit_open: true` mas
 *     CONTINUA tentando (não para o loop; circuit é só métrica de alerta)
 *   - nunca crasha — todo erro é catch-and-log
 *
 * `tunnelHealthy` é placeholder `true` até a Sub-tarefa 5 implementar o
 * autossh wrapper (que vai inspecionar processo + porta).
 *
 * @see Sub-tarefa 5 (autossh wrapper) — substitui `tunnelHealthy = true`
 * @see ADR-V2-008 (DEvento substitui DNotification — heartbeat materializa DEvento -501)
 */
import { execFile } from 'child_process';
import * as os from 'os';
import type { Logger } from 'pino';
import { promisify } from 'util';
import type { BackendClient, HeartbeatPayload } from '../outbound/backend-client';

const execFileAsync = promisify(execFile);

const HEARTBEAT_INTERVAL_MS = 30_000;
const CLAUDE_DETECTION_CACHE_MS = 5 * 60 * 1000; // 5min
const CLAUDE_VERSION_TIMEOUT_MS = 5_000;
const CIRCUIT_OPEN_THRESHOLD = 5;

/** Handle retornado por `startHeartbeatLoop` para o bootstrap parar no SIGTERM. */
export interface HeartbeatHandle {
  /** Para o loop. Idempotente — chamadas extras são no-op. */
  stop(): void;
  /**
   * Dispara um heartbeat imediato (útil para testes — não espera o tick
   * do setInterval). Resolve quando o request termina (ok ou erro).
   */
  triggerNow(): Promise<void>;
}

/** Tunáveis — injetáveis em testes para acelerar o loop sem fake timers. */
export interface HeartbeatLoopOptions {
  /** Intervalo entre heartbeats. Default 30_000ms. */
  intervalMs?: number;
  /** TTL do cache de detecção do Claude Code. Default 5min. */
  claudeDetectionCacheMs?: number;
  /** Versão do agente reportada no payload. Default '0.1.0'. */
  agentVersion?: string;
  /**
   * Override de detecção do Claude (para testes — evita execFile real).
   * Retorna `{ available, version }`. Se omitido, usa `claude --version`.
   */
  detectClaude?: () => Promise<{ available: boolean; version: string | null }>;
  /** Função de agora — testes podem fixar o relógio. Default Date.now. */
  now?: () => number;
  /**
   * setInterval injetável para testes — útil pra controlar precisamente
   * quando o tick ocorre. Default `setInterval` global.
   */
  setIntervalImpl?: (fn: () => void, ms: number) => NodeJS.Timeout;
  /** clearInterval injetável (complemento de setIntervalImpl). */
  clearIntervalImpl?: (handle: NodeJS.Timeout) => void;
}

/**
 * Inicia o loop. NÃO faz fire-and-forget no startup — o primeiro heartbeat
 * acontece após `intervalMs`. Caller pode chamar `triggerNow()` se quiser
 * heartbeat imediato pós-boot (ex: smoke test do install.sh).
 *
 * @example
 *   const handle = startHeartbeatLoop(backendClient, logger);
 *   process.on('SIGTERM', () => handle.stop());
 */
export function startHeartbeatLoop(
  backendClient: BackendClient,
  logger: Logger,
  options: HeartbeatLoopOptions = {},
): HeartbeatHandle {
  const intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  const cacheMs = options.claudeDetectionCacheMs ?? CLAUDE_DETECTION_CACHE_MS;
  const agentVersion = options.agentVersion ?? '0.1.0';
  const now = options.now ?? Date.now;
  const setIntervalFn = options.setIntervalImpl ?? setInterval;
  const clearIntervalFn = options.clearIntervalImpl ?? clearInterval;
  const detectClaude = options.detectClaude ?? defaultDetectClaude;

  let stopped = false;
  let consecutiveFailures = 0;
  let circuitOpenLogged = false;

  // Cache de detecção do Claude Code.
  let claudeCache: {
    value: { available: boolean; version: string | null };
    expiresAt: number;
  } | null = null;

  async function getClaudeStatus(): Promise<{ available: boolean; version: string | null }> {
    const t = now();
    if (claudeCache && claudeCache.expiresAt > t) {
      return claudeCache.value;
    }
    try {
      const value = await detectClaude();
      claudeCache = { value, expiresAt: t + cacheMs };
      return value;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ stage: 'heartbeat.claude-detect', err: message }, 'falha ao detectar claude');
      const fallback = { available: false, version: null };
      claudeCache = { value: fallback, expiresAt: t + cacheMs };
      return fallback;
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;

    try {
      const claude = await getClaudeStatus();
      const payload: HeartbeatPayload = {
        cpu: collectCpuLoad(),
        mem: collectMemFraction(),
        uptime: Math.floor(process.uptime()),
        claudeCodeAvailable: claude.available,
        // TODO Sub-tarefa 5 (autossh wrapper): inspecionar processo autossh
        // + porta local e refletir o estado real. Hoje é placeholder.
        tunnelHealthy: true,
        agentVersion,
        claudeVersion: claude.version,
      };

      await backendClient.sendHeartbeat(payload);

      // Sucesso → reseta contadores.
      if (consecutiveFailures > 0 || circuitOpenLogged) {
        logger.info(
          { stage: 'heartbeat', recoveredAfterFailures: consecutiveFailures },
          'heartbeat recuperado',
        );
      }
      consecutiveFailures = 0;
      circuitOpenLogged = false;
    } catch (err) {
      consecutiveFailures += 1;
      const message = err instanceof Error ? err.message : String(err);
      const shouldOpenCircuit = consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD;

      if (shouldOpenCircuit && !circuitOpenLogged) {
        logger.error(
          {
            stage: 'heartbeat',
            consecutiveFailures,
            circuit_open: true,
            err: message,
          },
          'heartbeat circuit aberto (5+ falhas consecutivas) — continua tentando',
        );
        circuitOpenLogged = true;
      } else {
        logger.warn(
          { stage: 'heartbeat', consecutiveFailures, err: message },
          'heartbeat falhou — continua loop',
        );
      }
      // NUNCA propagar: loop não pode crashar.
    }
  }

  const handle = setIntervalFn(() => {
    void tick();
  }, intervalMs);

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearIntervalFn(handle);
      logger.info({ stage: 'heartbeat' }, 'heartbeat loop encerrado');
    },
    async triggerNow(): Promise<void> {
      await tick();
    },
  };
}

/**
 * CPU load normalizado (loadavg 1min / cpuCount). Linux/macOS retornam
 * valores reais; Windows retorna [0,0,0] (não suportado pelo Node), mas
 * a VPS é Ubuntu — irrelevante.
 */
function collectCpuLoad(): number {
  const load = os.loadavg()[0] ?? 0;
  const cpus = os.cpus().length || 1;
  return Number((load / cpus).toFixed(3));
}

/** Fração de memória usada (0..1). */
function collectMemFraction(): number {
  const total = os.totalmem();
  if (total <= 0) return 0;
  const used = total - os.freemem();
  return Number((used / total).toFixed(3));
}

/**
 * Detecção default do Claude Code — invoca `claude --version` com timeout.
 * Retorna `{available:false, version:null}` em qualquer erro (binário
 * ausente, timeout, exit≠0, output malformado).
 */
async function defaultDetectClaude(): Promise<{ available: boolean; version: string | null }> {
  try {
    const { stdout } = await execFileAsync('claude', ['--version'], {
      timeout: CLAUDE_VERSION_TIMEOUT_MS,
    });
    const version = stdout.trim().split(/\s+/).pop() ?? null;
    return { available: true, version: version && version.length > 0 ? version : null };
  } catch {
    return { available: false, version: null };
  }
}
