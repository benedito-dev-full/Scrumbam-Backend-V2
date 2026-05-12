/**
 * Wrapper do processo `autossh` — Sub-tarefa 5 do Task #1 (F13 cliente).
 *
 * Responsável por estabelecer o REVERSE TUNNEL SSH entre o agente (VPS do
 * cliente) e o backend V2. O agente bind-a o servidor HTTP em
 * `127.0.0.1:<tunnelPort>` (nunca 0.0.0.0 — defesa em camadas) e o tunnel
 * expõe essa porta no backend via `-R <bindHost>:<tunnelPort>:127.0.0.1:<tunnelPort>`.
 *
 * Diferenças vs implementação inline do agente legado (Scrumbam-Backend):
 *  - Modular: wrapper isolado do bootstrap, testável via mock de `spawn`.
 *  - Reconexão própria (NÃO depende mais de systemd `Restart=always`):
 *      backoff exponencial 1s → 60s, com reset após 60s de uptime.
 *  - Circuit breaker: 5 crashes consecutivos em 60s pausa 5min para evitar
 *    flap loop (ex: chave SSH inválida que faria autossh crashar em 100ms
 *    e systemd reiniciar 100 vezes/min).
 *  - `isHealthy()` exposto para heartbeat loop refletir estado real do
 *    tunnel (Sub-tarefa 3 deixou placeholder `true`).
 *
 * O processo autossh em si já cuida da reconexão SSH-level (option
 * `ServerAliveInterval=30` + `ServerAliveCountMax=3` derruba a conexão TCP
 * morta e ele re-conecta sozinho). Este wrapper só lida com o caso em que
 * o próprio `autossh` CRASHA (rare — geralmente chave inválida, porta
 * remota já ocupada com `ExitOnForwardFailure=yes`).
 *
 * @see plan-automation-agent-v2-client-task1.md §5 Sub-tarefa 5
 */
import { ChildProcess, spawn } from 'child_process';
import type { Logger } from 'pino';
import type { AgentConfig } from '../config/schema';

/** Estado lógico do tunnel (não o estado bruto do processo unix). */
export type TunnelStatus =
  | 'idle' // antes de start()
  | 'starting' // spawn chamado, ainda sem PID
  | 'running' // processo vivo
  | 'reconnecting' // crashou, aguardando backoff antes de respawn
  | 'circuit_open' // 5 crashes/60s, pausando 5min
  | 'stopped'; // stop() chamado explicitamente

/**
 * Handle público do wrapper. Imutável após `start()` — toda mutação interna.
 */
export interface AutosshHandle {
  /** Spawna autossh. Idempotente — chamadas extras viram no-op + warn. */
  start(): Promise<void>;
  /**
   * Encerra autossh com SIGTERM e marca shutdown definitivo. Se o processo
   * não morrer em `stopGraceMs`, força SIGKILL. NÃO reinicia depois de
   * `stop()` — wrapper vira lixo.
   */
  stop(): Promise<void>;
  /** True se status === 'running' (heartbeat usa isso). */
  isHealthy(): boolean;
  /** Estado atual. Útil para inspeção e logs. */
  status(): TunnelStatus;
}

/** Tunáveis para testes (acelerar backoff, mockar spawn, etc.). */
export interface AutosshWrapperOptions {
  /** Backoff inicial. Default 1000ms. */
  initialBackoffMs?: number;
  /** Backoff máximo. Default 60000ms (60s). */
  maxBackoffMs?: number;
  /** Janela para circuit breaker contar crashes. Default 60000ms (60s). */
  crashWindowMs?: number;
  /** Crashes na janela que abrem o circuito. Default 5. */
  crashThreshold?: number;
  /** Pausa quando circuito aberto. Default 300000ms (5min). */
  circuitOpenMs?: number;
  /** Após quanto tempo de uptime resetar contador de crashes. Default 60000ms. */
  uptimeResetMs?: number;
  /** Grace antes de SIGKILL no stop(). Default 5000ms. */
  stopGraceMs?: number;
  /** Override de `spawn` para testes (jest.fn). Default `child_process.spawn`. */
  spawnImpl?: typeof spawn;
  /** Override de setTimeout (testes com fake timers). Default global. */
  setTimeoutImpl?: typeof setTimeout;
  /** Override de clearTimeout. Default global. */
  clearTimeoutImpl?: typeof clearTimeout;
  /** Função "agora" — testes podem fixar. Default Date.now. */
  now?: () => number;
  /**
   * Host em que o reverse forward vai bindar NO BACKEND. Para containers
   * Dokploy normalmente `172.17.0.1` (docker0 do host). Default `127.0.0.1`.
   */
  bindHost?: string;
  /** Usuário SSH no backend. Default `agent`. */
  sshUser?: string;
  /** Caminho do binário autossh. Default `autossh` (assume PATH). */
  autosshBinary?: string;
}

const DEFAULTS = {
  initialBackoffMs: 1_000,
  maxBackoffMs: 60_000,
  crashWindowMs: 60_000,
  crashThreshold: 5,
  circuitOpenMs: 5 * 60_000, // 5min
  uptimeResetMs: 60_000,
  stopGraceMs: 5_000,
  bindHost: '127.0.0.1',
  sshUser: 'agent',
  autosshBinary: 'autossh',
};

/**
 * Cria um wrapper autossh associado à `config`. O wrapper é PASSIVO até
 * `start()` ser chamado.
 *
 * @example
 *   const tunnel = createAutosshWrapper(config, logger);
 *   await tunnel.start();
 *   // ... mais tarde:
 *   if (tunnel.isHealthy()) { ... }
 *   await tunnel.stop();
 */
export function createAutosshWrapper(
  config: AgentConfig,
  logger: Logger,
  options: AutosshWrapperOptions = {},
): AutosshHandle {
  const opts = { ...DEFAULTS, ...options };
  const spawnFn = options.spawnImpl ?? spawn;
  const setTimeoutFn = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutImpl ?? clearTimeout;
  const now = options.now ?? Date.now;

  // --- estado interno (mutável) ---
  let state: TunnelStatus = 'idle';
  let child: ChildProcess | null = null;
  let stopRequested = false;
  let crashTimestamps: number[] = []; // janela deslizante para circuit breaker
  let consecutiveBackoffStep = 0; // 0 → initial, 1 → 2x, 2 → 4x, ...
  let reconnectTimer: NodeJS.Timeout | null = null;
  let circuitTimer: NodeJS.Timeout | null = null;
  let uptimeResetTimer: NodeJS.Timeout | null = null;
  let startResolvedOnce = false; // start() só resolve uma vez

  function buildSshArgs(): string[] {
    return [
      '-M',
      '0', // sem monitor port (autossh moderno usa ServerAlive interno)
      '-N', // sem comando remoto
      '-o',
      'ServerAliveInterval=30',
      '-o',
      'ServerAliveCountMax=3',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-i',
      config.agentSshKeyPath,
      '-p',
      String(config.backendTunnelPort),
      '-R',
      `${opts.bindHost}:${config.tunnelPort}:127.0.0.1:${config.tunnelPort}`,
      `${opts.sshUser}@${config.backendTunnelHost}`,
    ];
  }

  function clearAllTimers(): void {
    if (reconnectTimer !== null) {
      clearTimeoutFn(reconnectTimer);
      reconnectTimer = null;
    }
    if (circuitTimer !== null) {
      clearTimeoutFn(circuitTimer);
      circuitTimer = null;
    }
    if (uptimeResetTimer !== null) {
      clearTimeoutFn(uptimeResetTimer);
      uptimeResetTimer = null;
    }
  }

  function computeBackoffMs(): number {
    const ms = opts.initialBackoffMs * Math.pow(2, consecutiveBackoffStep);
    return Math.min(ms, opts.maxBackoffMs);
  }

  function pruneCrashWindow(): void {
    const cutoff = now() - opts.crashWindowMs;
    crashTimestamps = crashTimestamps.filter((t) => t >= cutoff);
  }

  function shouldOpenCircuit(): boolean {
    pruneCrashWindow();
    return crashTimestamps.length >= opts.crashThreshold;
  }

  function scheduleUptimeReset(): void {
    if (uptimeResetTimer !== null) {
      clearTimeoutFn(uptimeResetTimer);
    }
    uptimeResetTimer = setTimeoutFn(() => {
      // Processo está vivo há `uptimeResetMs` ms — é um run "saudável".
      // Resetamos os contadores para que o próximo crash recomece a janela.
      if (state === 'running') {
        if (crashTimestamps.length > 0 || consecutiveBackoffStep > 0) {
          logger.info(
            { stage: 'tunnel.autossh', uptimeMs: opts.uptimeResetMs },
            'tunnel estavel — resetando contadores de crash/backoff',
          );
        }
        crashTimestamps = [];
        consecutiveBackoffStep = 0;
      }
      uptimeResetTimer = null;
    }, opts.uptimeResetMs);
  }

  function attachChildListeners(proc: ChildProcess): void {
    // Captura stdout/stderr e loga (sem expor chave privada — autossh não
    // imprime chave, mas o logger.redact cobre se aparecer no caminho).
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text.length > 0) {
        logger.debug({ stage: 'tunnel.autossh.stdout', text }, 'autossh stdout');
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text.length > 0) {
        logger.warn({ stage: 'tunnel.autossh.stderr', text }, 'autossh stderr');
      }
    });

    proc.on('error', (err: Error) => {
      logger.error(
        { stage: 'tunnel.autossh', err: err.message },
        'erro ao spawnar autossh (binario ausente? ENOENT?)',
      );
    });

    proc.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      const wasStopped = stopRequested;
      logger.warn(
        { stage: 'tunnel.autossh', code, signal, wasStopped },
        wasStopped ? 'autossh encerrado por stop()' : 'autossh saiu inesperadamente',
      );

      child = null;
      if (uptimeResetTimer !== null) {
        clearTimeoutFn(uptimeResetTimer);
        uptimeResetTimer = null;
      }

      if (wasStopped) {
        state = 'stopped';
        return;
      }

      // Crash inesperado → registra e decide se faz backoff ou abre circuito.
      crashTimestamps.push(now());

      if (shouldOpenCircuit()) {
        state = 'circuit_open';
        logger.error(
          {
            stage: 'tunnel.autossh',
            crashes: crashTimestamps.length,
            windowMs: opts.crashWindowMs,
            pauseMs: opts.circuitOpenMs,
          },
          'circuit breaker aberto — pausando reconexao para evitar flap loop',
        );
        circuitTimer = setTimeoutFn(() => {
          // Fim da pausa → reseta janela e tenta de novo do zero.
          logger.info(
            { stage: 'tunnel.autossh' },
            'circuit breaker fechando — tentando reconectar',
          );
          crashTimestamps = [];
          consecutiveBackoffStep = 0;
          circuitTimer = null;
          if (!stopRequested) {
            void respawn();
          }
        }, opts.circuitOpenMs);
        return;
      }

      // Backoff normal.
      const delay = computeBackoffMs();
      consecutiveBackoffStep += 1;
      state = 'reconnecting';
      logger.info(
        { stage: 'tunnel.autossh', delayMs: delay, attempt: consecutiveBackoffStep },
        'tentando reconectar autossh apos backoff',
      );
      reconnectTimer = setTimeoutFn(() => {
        reconnectTimer = null;
        if (!stopRequested) {
          void respawn();
        }
      }, delay);
    });
  }

  function spawnAutossh(): void {
    state = 'starting';
    const args = buildSshArgs();
    logger.info(
      {
        stage: 'tunnel.autossh',
        binary: opts.autosshBinary,
        backendHost: config.backendTunnelHost,
        backendPort: config.backendTunnelPort,
        bindHost: opts.bindHost,
        tunnelPort: config.tunnelPort,
        sshKey: config.agentSshKeyPath,
      },
      'spawnando autossh',
    );
    try {
      child = spawnFn(opts.autosshBinary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AUTOSSH_GATETIME: '0' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { stage: 'tunnel.autossh', err: message },
        'falha ao chamar spawn (binario provavelmente ausente)',
      );
      // Spawn síncrono falhou — empurra para mesmo fluxo de crash.
      child = null;
      crashTimestamps.push(now());
      if (shouldOpenCircuit()) {
        state = 'circuit_open';
        circuitTimer = setTimeoutFn(() => {
          crashTimestamps = [];
          consecutiveBackoffStep = 0;
          circuitTimer = null;
          if (!stopRequested) spawnAutossh();
        }, opts.circuitOpenMs);
        return;
      }
      const delay = computeBackoffMs();
      consecutiveBackoffStep += 1;
      state = 'reconnecting';
      reconnectTimer = setTimeoutFn(() => {
        reconnectTimer = null;
        if (!stopRequested) spawnAutossh();
      }, delay);
      return;
    }

    if (!child || typeof child.pid !== 'number') {
      logger.error(
        { stage: 'tunnel.autossh' },
        'spawn retornou sem PID — tratando como crash imediato',
      );
      // Mesmo fluxo: contabiliza crash e agenda retry.
      child = null;
      crashTimestamps.push(now());
      const delay = computeBackoffMs();
      consecutiveBackoffStep += 1;
      state = 'reconnecting';
      reconnectTimer = setTimeoutFn(() => {
        reconnectTimer = null;
        if (!stopRequested) spawnAutossh();
      }, delay);
      return;
    }

    state = 'running';
    logger.info(
      { stage: 'tunnel.autossh', pid: child.pid },
      'autossh ativo (-R reverse tunnel estabelecido)',
    );
    attachChildListeners(child);
    scheduleUptimeReset();
  }

  // `respawn` é diferente de `spawnAutossh` apenas semanticamente — usado
  // depois de crash/backoff/circuit. Reaproveita o mesmo código.
  function respawn(): void {
    if (stopRequested) return;
    spawnAutossh();
  }

  return {
    async start(): Promise<void> {
      if (startResolvedOnce) {
        logger.warn({ stage: 'tunnel.autossh' }, 'start() chamado novamente — ignorando');
        return;
      }
      startResolvedOnce = true;
      stopRequested = false;
      spawnAutossh();
      // start() resolve assim que SPAWN é chamado — não espera o tunnel ser
      // efetivamente estabelecido (autossh não emite "ready" facilmente
      // sem parsing de stderr). isHealthy() reflete o estado em runtime.
    },

    async stop(): Promise<void> {
      if (state === 'stopped' || state === 'idle') {
        return;
      }
      stopRequested = true;
      clearAllTimers();

      if (child) {
        const proc = child;
        logger.info({ stage: 'tunnel.autossh', pid: proc.pid }, 'enviando SIGTERM para autossh');
        try {
          proc.kill('SIGTERM');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(
            { stage: 'tunnel.autossh', err: message },
            'falha ao enviar SIGTERM (processo provavelmente ja morto)',
          );
        }

        await new Promise<void>((resolve) => {
          let resolved = false;
          const grace = setTimeoutFn(() => {
            if (resolved) return;
            resolved = true;
            logger.warn(
              { stage: 'tunnel.autossh', graceMs: opts.stopGraceMs },
              'timeout no SIGTERM — enviando SIGKILL',
            );
            try {
              proc.kill('SIGKILL');
            } catch {
              /* já morto */
            }
            resolve();
          }, opts.stopGraceMs);

          proc.once('exit', () => {
            if (resolved) return;
            resolved = true;
            clearTimeoutFn(grace);
            resolve();
          });
        });
      }

      state = 'stopped';
      child = null;
      logger.info({ stage: 'tunnel.autossh' }, 'tunnel encerrado');
    },

    isHealthy(): boolean {
      return state === 'running';
    },

    status(): TunnelStatus {
      return state;
    },
  };
}
