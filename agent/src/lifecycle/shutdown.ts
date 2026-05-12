/**
 * Graceful shutdown coordinator — Sub-tarefa 5 do Task #1 (F13 cliente).
 *
 * Ordem (DEFENSIVA — autossh por último):
 *   1. heartbeat.stop()   — para de mandar batidas (evita log enganoso de
 *                            timeout enquanto o socket cai).
 *   2. server.stop()      — drena requests in-flight no HTTP local. O
 *                            próprio `createServer` tem timeout de 30s e
 *                            cai pra closeAllConnections() se passar.
 *   3. autossh.stop()     — só DEPOIS do server fechar, derruba o tunnel.
 *                            Garante que requests inbound em curso (vindo
 *                            do backend via tunnel) finalizam antes da
 *                            conexão SSH morrer.
 *   4. process.exit(0)    — sucesso. Se algo lançar, sai com 1.
 *
 * Idempotente: chamadas concorrentes (SIGTERM + SIGINT quase simultâneos)
 * são deduplicadas — só o primeiro signal dispara o flow.
 */
import type { Logger } from 'pino';

/** Interfaces estruturais — não importamos os tipos concretos para evitar
 * acoplamento (testes mockam tudo). */
export interface ShutdownHeartbeat {
  stop(): void;
}
export interface ShutdownServer {
  stop(): Promise<void>;
}
export interface ShutdownTunnel {
  stop(): Promise<void>;
}

export interface ShutdownContext {
  heartbeat: ShutdownHeartbeat;
  server: ShutdownServer;
  tunnel: ShutdownTunnel;
  logger: Logger;
  /** Override de process.exit para testes. Default `process.exit`. */
  exit?: (code: number) => never;
}

/**
 * Executa o shutdown na ordem definida. Não lança — captura cada erro
 * individual e continua. No final faz `exit(0)` ou `exit(1)` conforme
 * houve falha.
 *
 * @returns Promise<never> — sempre encerra o processo via `exit`.
 */
export async function gracefulShutdown(
  ctx: ShutdownContext,
  signal: NodeJS.Signals | string,
): Promise<void> {
  const exit = ctx.exit ?? ((code: number): never => process.exit(code));
  ctx.logger.info({ stage: 'shutdown', signal }, 'iniciando graceful shutdown');

  let hadError = false;

  // 1. heartbeat — síncrono, não pode falhar muito, mas blindamos.
  try {
    ctx.heartbeat.stop();
  } catch (err) {
    hadError = true;
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.warn({ stage: 'shutdown.heartbeat', err: message }, 'falha ao parar heartbeat');
  }

  // 2. HTTP server — drena requests in-flight.
  try {
    await ctx.server.stop();
  } catch (err) {
    hadError = true;
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.warn({ stage: 'shutdown.server', err: message }, 'falha ao parar HTTP server');
  }

  // 3. autossh — só agora derruba o tunnel.
  try {
    await ctx.tunnel.stop();
  } catch (err) {
    hadError = true;
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.warn({ stage: 'shutdown.tunnel', err: message }, 'falha ao parar autossh');
  }

  if (hadError) {
    ctx.logger.error({ stage: 'shutdown' }, 'shutdown concluido com erros (exit 1)');
    exit(1);
    return;
  }
  ctx.logger.info({ stage: 'shutdown' }, 'shutdown concluido com sucesso');
  exit(0);
}

/**
 * Helper para registrar SIGTERM + SIGINT atrelados ao mesmo shutdown.
 * Garante idempotência: se SIGTERM já disparou, SIGINT subsequente vira no-op.
 */
export function installSignalHandlers(
  ctx: ShutdownContext,
  signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'],
): void {
  let triggered = false;
  for (const signal of signals) {
    process.on(signal, () => {
      if (triggered) {
        ctx.logger.warn(
          { stage: 'shutdown', signal },
          'sinal recebido durante shutdown — ignorando (idempotente)',
        );
        return;
      }
      triggered = true;
      void gracefulShutdown(ctx, signal);
    });
  }
}
