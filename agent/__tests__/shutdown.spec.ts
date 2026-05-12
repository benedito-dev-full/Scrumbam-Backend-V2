/**
 * Specs do `gracefulShutdown` + `installSignalHandlers` — Sub-tarefa 5.
 *
 * Cenários:
 *  1. Ordem correta: heartbeat → server → autossh → exit(0).
 *  2. Erro em heartbeat.stop() não bloqueia o resto, exit(1) no final.
 *  3. Erro em server.stop() não bloqueia tunnel, exit(1) no final.
 *  4. Erro em tunnel.stop() exit(1) no final.
 *  5. Sucesso completo → exit(0).
 *  6. `installSignalHandlers` deduplica chamadas concorrentes (SIGTERM +
 *     SIGINT) — só dispara uma vez.
 */
import pino from 'pino';
import {
  gracefulShutdown,
  installSignalHandlers,
  type ShutdownContext,
} from '../src/lifecycle/shutdown';

function silentLogger() {
  return pino({ level: 'silent' });
}

function makeOrderTracker() {
  const order: string[] = [];
  return {
    order,
    push(label: string): void {
      order.push(label);
    },
  };
}

describe('gracefulShutdown', () => {
  it('executa na ordem heartbeat -> server -> tunnel -> exit(0)', async () => {
    const tracker = makeOrderTracker();
    const exit = jest.fn();
    const ctx: ShutdownContext = {
      heartbeat: {
        stop: () => tracker.push('heartbeat'),
      },
      server: {
        stop: async () => {
          tracker.push('server');
        },
      },
      tunnel: {
        stop: async () => {
          tracker.push('tunnel');
        },
      },
      logger: silentLogger(),
      exit: exit as unknown as (code: number) => never,
    };

    await gracefulShutdown(ctx, 'SIGTERM');

    expect(tracker.order).toEqual(['heartbeat', 'server', 'tunnel']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('erro em heartbeat.stop() não bloqueia o resto, exit(1)', async () => {
    const tracker = makeOrderTracker();
    const exit = jest.fn();
    const ctx: ShutdownContext = {
      heartbeat: {
        stop: () => {
          tracker.push('heartbeat-throw');
          throw new Error('heartbeat boom');
        },
      },
      server: {
        stop: async () => {
          tracker.push('server');
        },
      },
      tunnel: {
        stop: async () => {
          tracker.push('tunnel');
        },
      },
      logger: silentLogger(),
      exit: exit as unknown as (code: number) => never,
    };

    await gracefulShutdown(ctx, 'SIGTERM');

    expect(tracker.order).toEqual(['heartbeat-throw', 'server', 'tunnel']);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('erro em server.stop() não bloqueia tunnel, exit(1)', async () => {
    const tracker = makeOrderTracker();
    const exit = jest.fn();
    const ctx: ShutdownContext = {
      heartbeat: {
        stop: () => tracker.push('heartbeat'),
      },
      server: {
        stop: async () => {
          tracker.push('server-throw');
          throw new Error('server boom');
        },
      },
      tunnel: {
        stop: async () => {
          tracker.push('tunnel');
        },
      },
      logger: silentLogger(),
      exit: exit as unknown as (code: number) => never,
    };

    await gracefulShutdown(ctx, 'SIGTERM');

    expect(tracker.order).toEqual(['heartbeat', 'server-throw', 'tunnel']);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('erro em tunnel.stop() exit(1)', async () => {
    const tracker = makeOrderTracker();
    const exit = jest.fn();
    const ctx: ShutdownContext = {
      heartbeat: {
        stop: () => tracker.push('heartbeat'),
      },
      server: {
        stop: async () => {
          tracker.push('server');
        },
      },
      tunnel: {
        stop: async () => {
          tracker.push('tunnel-throw');
          throw new Error('tunnel boom');
        },
      },
      logger: silentLogger(),
      exit: exit as unknown as (code: number) => never,
    };

    await gracefulShutdown(ctx, 'SIGTERM');

    expect(tracker.order).toEqual(['heartbeat', 'server', 'tunnel-throw']);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('aguarda server.stop() completar antes de tunnel.stop()', async () => {
    const tracker = makeOrderTracker();
    const exit = jest.fn();
    const ctx: ShutdownContext = {
      heartbeat: {
        stop: () => tracker.push('heartbeat'),
      },
      server: {
        stop: async () => {
          tracker.push('server-start');
          await new Promise((resolve) => setTimeout(resolve, 50));
          tracker.push('server-done');
        },
      },
      tunnel: {
        stop: async () => {
          tracker.push('tunnel');
        },
      },
      logger: silentLogger(),
      exit: exit as unknown as (code: number) => never,
    };

    await gracefulShutdown(ctx, 'SIGTERM');

    expect(tracker.order).toEqual(['heartbeat', 'server-start', 'server-done', 'tunnel']);
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe('installSignalHandlers', () => {
  // Salvamos os listeners originais para restaurar depois.
  const originalSigtermListeners = process.listeners('SIGTERM');
  const originalSigintListeners = process.listeners('SIGINT');

  beforeEach(() => {
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  afterEach(() => {
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    for (const l of originalSigtermListeners) {
      process.on('SIGTERM', l);
    }
    for (const l of originalSigintListeners) {
      process.on('SIGINT', l);
    }
  });

  it('registra handlers para SIGTERM e SIGINT', () => {
    const exit = jest.fn();
    installSignalHandlers({
      heartbeat: { stop: jest.fn() },
      server: { stop: jest.fn(async () => undefined) },
      tunnel: { stop: jest.fn(async () => undefined) },
      logger: silentLogger(),
      exit: exit as unknown as (code: number) => never,
    });

    expect(process.listeners('SIGTERM').length).toBeGreaterThan(0);
    expect(process.listeners('SIGINT').length).toBeGreaterThan(0);
  });

  it('shutdown so dispara uma vez mesmo com SIGTERM + SIGINT', async () => {
    const heartbeatStop = jest.fn();
    const serverStop = jest.fn(async () => undefined);
    const tunnelStop = jest.fn(async () => undefined);
    const exit = jest.fn();

    installSignalHandlers({
      heartbeat: { stop: heartbeatStop },
      server: { stop: serverStop },
      tunnel: { stop: tunnelStop },
      logger: silentLogger(),
      exit: exit as unknown as (code: number) => never,
    });

    process.emit('SIGTERM');
    process.emit('SIGINT');

    // Espera o flow async terminar.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(heartbeatStop).toHaveBeenCalledTimes(1);
    expect(serverStop).toHaveBeenCalledTimes(1);
    expect(tunnelStop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
