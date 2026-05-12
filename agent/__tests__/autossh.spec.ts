/**
 * Specs do `createAutosshWrapper` — Sub-tarefa 5.
 *
 * Cenários:
 *  1. spawn é chamado com binário + args corretos.
 *  2. processo vivo → `status === 'running'`, `isHealthy() === true`.
 *  3. crash inesperado → backoff agendado, status `reconnecting`.
 *  4. backoff cresce exponencialmente (1s, 2s, 4s, ...) até `maxBackoffMs`.
 *  5. 5 crashes consecutivos em `crashWindowMs` → circuit aberto, pausa.
 *  6. circuit fecha após `circuitOpenMs` e respawn.
 *  7. uptime > `uptimeResetMs` reseta contadores de crash e backoff.
 *  8. `stop()` envia SIGTERM e, se não morre em `stopGraceMs`, envia SIGKILL.
 *  9. `stop()` é idempotente — chamadas extras viram no-op.
 * 10. `isHealthy()` retorna false em qualquer estado != running.
 *
 * Todos os testes usam `spawnImpl` mock + `setTimeoutImpl/clearTimeoutImpl`
 * controláveis. Zero IO real.
 */
import { EventEmitter } from 'events';
import pino from 'pino';
import type { AgentConfig } from '../src/config/schema';
import { createAutosshWrapper, type AutosshWrapperOptions } from '../src/tunnel/autossh.wrapper';

const BASE_CONFIG: AgentConfig = {
  agentId: 'agent-test-5',
  agentApiKey: 'api',
  agentCommandSecret: 'secret',
  backendBaseUrl: 'https://api.test.local',
  backendTunnelHost: 'tunnel.test.local',
  backendTunnelPort: 2222,
  tunnelPort: 41123,
  allowedProjectRoots: ['/tmp/proj'],
  claudeMdPath: '/tmp/.claude/CLAUDE.md',
  agentSshKeyPath: '/tmp/keys/id_ed25519',
  logLevel: 'error',
};

function silentLogger() {
  return pino({ level: 'silent' });
}

/**
 * Mock de ChildProcess. Implementa só o que o wrapper consome:
 * stdout/stderr (EventEmitter), pid, kill, e o evento 'exit'.
 */
class MockChild extends EventEmitter {
  public pid = Math.floor(Math.random() * 30000) + 1000;
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();
  public killed = false;
  public lastSignal: NodeJS.Signals | null = null;
  public killShouldThrow = false;

  kill(signal: NodeJS.Signals): boolean {
    if (this.killShouldThrow) {
      throw new Error('kill threw');
    }
    this.lastSignal = signal;
    this.killed = true;
    return true;
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('exit', code, signal);
  }
}

/**
 * "Fake clock" com setTimeout/clearTimeout controlável. Cada `tick(ms)`
 * avança o relógio e dispara qualquer timer cujo fire seja <= currentMs.
 * Mais simples que jest.useFakeTimers pra esse caso porque queremos avançar
 * em vários incrementos discretos e checar estado entre eles.
 */
function createFakeClock() {
  let currentMs = 0;
  let nextId = 1;
  const timers = new Map<number, { fireAt: number; fn: () => void }>();

  const setTimeoutImpl = ((fn: () => void, ms: number) => {
    const id = nextId++;
    timers.set(id, { fireAt: currentMs + ms, fn });
    return id as unknown as NodeJS.Timeout;
  }) as unknown as typeof setTimeout;

  const clearTimeoutImpl = ((handle: NodeJS.Timeout) => {
    timers.delete(handle as unknown as number);
  }) as unknown as typeof clearTimeout;

  function tick(ms: number): void {
    currentMs += ms;
    // Loop até estabilizar (callbacks podem registrar novos timers).
    let pass = 0;
    while (pass < 100) {
      pass++;
      const due = [...timers.entries()]
        .filter(([, t]) => t.fireAt <= currentMs)
        .sort((a, b) => a[1].fireAt - b[1].fireAt);
      if (due.length === 0) break;
      for (const [id, t] of due) {
        timers.delete(id);
        t.fn();
      }
    }
  }

  return {
    setTimeoutImpl,
    clearTimeoutImpl,
    tick,
    now: () => currentMs,
    pendingCount: () => timers.size,
  };
}

describe('createAutosshWrapper', () => {
  it('chama spawn com binario, args e env corretos', async () => {
    const spawnCalls: Array<[string, string[], Record<string, unknown>]> = [];
    const spawnImpl = ((bin: string, args: string[], opts: Record<string, unknown>) => {
      spawnCalls.push([bin, args, opts]);
      return new MockChild() as unknown as ReturnType<
        NonNullable<AutosshWrapperOptions['spawnImpl']>
      >;
    }) as unknown as AutosshWrapperOptions['spawnImpl'];
    const clock = createFakeClock();
    const wrapper = createAutosshWrapper(BASE_CONFIG, silentLogger(), {
      spawnImpl,
      setTimeoutImpl: clock.setTimeoutImpl,
      clearTimeoutImpl: clock.clearTimeoutImpl,
      now: clock.now,
      sshUser: 'agent',
      bindHost: '172.17.0.1',
    });

    await wrapper.start();

    expect(spawnCalls.length).toBe(1);
    const [bin, args, opts] = spawnCalls[0]!;
    expect(bin).toBe('autossh');
    expect(args).toEqual(
      expect.arrayContaining([
        '-M',
        '0',
        '-N',
        '-o',
        'ServerAliveInterval=30',
        '-o',
        'ServerAliveCountMax=3',
        '-o',
        'ExitOnForwardFailure=yes',
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-i',
        '/tmp/keys/id_ed25519',
        '-p',
        '2222',
        '-R',
        '172.17.0.1:41123:127.0.0.1:41123',
        'agent@tunnel.test.local',
      ]),
    );
    expect((opts.env as Record<string, string> | undefined)?.AUTOSSH_GATETIME).toBe('0');
    expect(wrapper.isHealthy()).toBe(true);
    expect(wrapper.status()).toBe('running');
  });

  it('crash inesperado coloca em reconnecting com backoff inicial', async () => {
    const mockChild = new MockChild();
    const spawnImpl = jest.fn(
      () => mockChild as unknown as ReturnType<NonNullable<AutosshWrapperOptions['spawnImpl']>>,
    );
    const clock = createFakeClock();
    const wrapper = createAutosshWrapper(BASE_CONFIG, silentLogger(), {
      spawnImpl: spawnImpl as unknown as AutosshWrapperOptions['spawnImpl'],
      setTimeoutImpl: clock.setTimeoutImpl,
      clearTimeoutImpl: clock.clearTimeoutImpl,
      now: clock.now,
      initialBackoffMs: 1_000,
      maxBackoffMs: 60_000,
      uptimeResetMs: 60_000,
    });

    await wrapper.start();
    expect(wrapper.isHealthy()).toBe(true);

    mockChild.emitExit(255, null);
    expect(wrapper.status()).toBe('reconnecting');
    expect(wrapper.isHealthy()).toBe(false);

    // Avança o backoff inicial → respawn.
    clock.tick(1_000);
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    expect(wrapper.status()).toBe('running');
  });

  it('backoff cresce exponencialmente (1s, 2s, 4s) ate maxBackoffMs', async () => {
    const children: MockChild[] = [];
    const spawnImpl = jest.fn(() => {
      const c = new MockChild();
      children.push(c);
      return c as unknown as ReturnType<NonNullable<AutosshWrapperOptions['spawnImpl']>>;
    });
    const clock = createFakeClock();
    const wrapper = createAutosshWrapper(BASE_CONFIG, silentLogger(), {
      spawnImpl: spawnImpl as unknown as AutosshWrapperOptions['spawnImpl'],
      setTimeoutImpl: clock.setTimeoutImpl,
      clearTimeoutImpl: clock.clearTimeoutImpl,
      now: clock.now,
      initialBackoffMs: 1_000,
      maxBackoffMs: 10_000, // teto baixo pra testar saturação
      crashThreshold: 100, // alto pra NÃO disparar circuit
      uptimeResetMs: 600_000, // alto pra NÃO resetar contadores
    });

    await wrapper.start();
    // Crash 1 → backoff 1s
    children[0]!.emitExit(1, null);
    clock.tick(1_000);
    expect(spawnImpl).toHaveBeenCalledTimes(2);

    // Crash 2 → backoff 2s
    children[1]!.emitExit(1, null);
    clock.tick(1_999);
    expect(spawnImpl).toHaveBeenCalledTimes(2); // ainda não disparou
    clock.tick(1);
    expect(spawnImpl).toHaveBeenCalledTimes(3);

    // Crash 3 → backoff 4s
    children[2]!.emitExit(1, null);
    clock.tick(3_999);
    expect(spawnImpl).toHaveBeenCalledTimes(3);
    clock.tick(1);
    expect(spawnImpl).toHaveBeenCalledTimes(4);

    // Crash 4 → backoff 8s
    children[3]!.emitExit(1, null);
    clock.tick(8_000);
    expect(spawnImpl).toHaveBeenCalledTimes(5);

    // Crash 5 → backoff 16s, mas capeado em 10s
    children[4]!.emitExit(1, null);
    clock.tick(10_000);
    expect(spawnImpl).toHaveBeenCalledTimes(6);
  });

  it('5 crashes em 60s abrem circuit breaker (pausa 5min)', async () => {
    const children: MockChild[] = [];
    const spawnImpl = jest.fn(() => {
      const c = new MockChild();
      children.push(c);
      return c as unknown as ReturnType<NonNullable<AutosshWrapperOptions['spawnImpl']>>;
    });
    const clock = createFakeClock();
    const wrapper = createAutosshWrapper(BASE_CONFIG, silentLogger(), {
      spawnImpl: spawnImpl as unknown as AutosshWrapperOptions['spawnImpl'],
      setTimeoutImpl: clock.setTimeoutImpl,
      clearTimeoutImpl: clock.clearTimeoutImpl,
      now: clock.now,
      initialBackoffMs: 100,
      maxBackoffMs: 100, // fixo para teste rápido
      crashWindowMs: 60_000,
      crashThreshold: 5,
      circuitOpenMs: 300_000,
      uptimeResetMs: 600_000,
    });

    await wrapper.start();

    // Provoca 5 crashes (1ª já foi via start()). Crash #5 abre circuito.
    // NÃO tickamos após o 5º crash — o circuitTimer fica pendente até o
    // teste avançar explicitamente a janela completa.
    for (let i = 0; i < 4; i++) {
      children[i]!.emitExit(1, null);
      clock.tick(100); // dispara respawn (backoff fixo em 100ms)
    }
    // 5º crash → abre circuito, não respawna.
    children[4]!.emitExit(1, null);

    expect(wrapper.status()).toBe('circuit_open');
    expect(wrapper.isHealthy()).toBe(false);
    const spawnsBeforeCircuit = spawnImpl.mock.calls.length;
    expect(spawnsBeforeCircuit).toBe(5); // start + 4 respawns

    // Avançar quase 5min não deve respawnar (circuit ainda aberto).
    clock.tick(299_999);
    expect(spawnImpl).toHaveBeenCalledTimes(spawnsBeforeCircuit);
    expect(wrapper.status()).toBe('circuit_open');

    // Avançar mais 1ms → fecha circuito e respawn.
    clock.tick(1);
    expect(spawnImpl).toHaveBeenCalledTimes(spawnsBeforeCircuit + 1);
    expect(wrapper.status()).toBe('running');
  });

  it('uptime > uptimeResetMs reseta contadores de crash e backoff', async () => {
    const children: MockChild[] = [];
    const spawnImpl = jest.fn(() => {
      const c = new MockChild();
      children.push(c);
      return c as unknown as ReturnType<NonNullable<AutosshWrapperOptions['spawnImpl']>>;
    });
    const clock = createFakeClock();
    const wrapper = createAutosshWrapper(BASE_CONFIG, silentLogger(), {
      spawnImpl: spawnImpl as unknown as AutosshWrapperOptions['spawnImpl'],
      setTimeoutImpl: clock.setTimeoutImpl,
      clearTimeoutImpl: clock.clearTimeoutImpl,
      now: clock.now,
      initialBackoffMs: 1_000,
      maxBackoffMs: 60_000,
      uptimeResetMs: 60_000,
      crashThreshold: 5,
    });

    await wrapper.start();
    // Acumula 3 crashes
    for (let i = 0; i < 3; i++) {
      children[i]!.emitExit(1, null);
      clock.tick(1_000 * Math.pow(2, i));
    }
    // Quarto child rodando — espera 60s sem crashar → resets.
    clock.tick(60_000);
    // Agora crashar de novo → backoff volta a ser 1s (não 8s).
    children[3]!.emitExit(1, null);
    clock.tick(999);
    expect(spawnImpl).toHaveBeenCalledTimes(4); // ainda não respawnou
    clock.tick(1);
    expect(spawnImpl).toHaveBeenCalledTimes(5);
  });

  it('stop() envia SIGTERM e processo morre limpo', async () => {
    const mockChild = new MockChild();
    const spawnImpl = jest.fn(
      () => mockChild as unknown as ReturnType<NonNullable<AutosshWrapperOptions['spawnImpl']>>,
    );
    const clock = createFakeClock();
    const wrapper = createAutosshWrapper(BASE_CONFIG, silentLogger(), {
      spawnImpl: spawnImpl as unknown as AutosshWrapperOptions['spawnImpl'],
      setTimeoutImpl: clock.setTimeoutImpl,
      clearTimeoutImpl: clock.clearTimeoutImpl,
      now: clock.now,
      stopGraceMs: 5_000,
    });

    await wrapper.start();
    const stopPromise = wrapper.stop();
    // Simula processo respondendo ao SIGTERM rapidamente.
    setImmediate(() => mockChild.emitExit(0, 'SIGTERM'));
    await stopPromise;
    expect(mockChild.lastSignal).toBe('SIGTERM');
    expect(wrapper.status()).toBe('stopped');
    expect(wrapper.isHealthy()).toBe(false);
  });

  it('stop() envia SIGKILL se SIGTERM nao mata em stopGraceMs', async () => {
    const mockChild = new MockChild();
    const spawnImpl = jest.fn(
      () => mockChild as unknown as ReturnType<NonNullable<AutosshWrapperOptions['spawnImpl']>>,
    );
    const clock = createFakeClock();
    const wrapper = createAutosshWrapper(BASE_CONFIG, silentLogger(), {
      spawnImpl: spawnImpl as unknown as AutosshWrapperOptions['spawnImpl'],
      setTimeoutImpl: clock.setTimeoutImpl,
      clearTimeoutImpl: clock.clearTimeoutImpl,
      now: clock.now,
      stopGraceMs: 5_000,
    });

    await wrapper.start();
    const stopPromise = wrapper.stop();
    // Processo ignora SIGTERM. Avançamos o relógio para disparar SIGKILL.
    clock.tick(5_000);
    await stopPromise;
    expect(mockChild.lastSignal).toBe('SIGKILL');
    expect(wrapper.status()).toBe('stopped');
  });

  it('stop() em estado idle/stopped e no-op', async () => {
    const wrapper = createAutosshWrapper(BASE_CONFIG, silentLogger(), {
      spawnImpl: jest.fn() as unknown as AutosshWrapperOptions['spawnImpl'],
    });
    expect(wrapper.status()).toBe('idle');
    await wrapper.stop(); // não deve lançar
    expect(wrapper.status()).toBe('idle');
  });

  it('isHealthy() retorna false em todos os estados != running', async () => {
    const mockChild = new MockChild();
    const spawnImpl = jest.fn(
      () => mockChild as unknown as ReturnType<NonNullable<AutosshWrapperOptions['spawnImpl']>>,
    );
    const clock = createFakeClock();
    const wrapper = createAutosshWrapper(BASE_CONFIG, silentLogger(), {
      spawnImpl: spawnImpl as unknown as AutosshWrapperOptions['spawnImpl'],
      setTimeoutImpl: clock.setTimeoutImpl,
      clearTimeoutImpl: clock.clearTimeoutImpl,
      now: clock.now,
      initialBackoffMs: 5_000,
    });

    // idle
    expect(wrapper.isHealthy()).toBe(false);

    // running
    await wrapper.start();
    expect(wrapper.isHealthy()).toBe(true);

    // reconnecting
    mockChild.emitExit(1, null);
    expect(wrapper.isHealthy()).toBe(false);
  });

  it('spawn lancando (binario ausente) entra em flow de reconnecting', async () => {
    let firstCall = true;
    const spawnImpl = jest.fn(() => {
      if (firstCall) {
        firstCall = false;
        throw new Error('ENOENT: autossh not found');
      }
      return new MockChild() as unknown as ReturnType<
        NonNullable<AutosshWrapperOptions['spawnImpl']>
      >;
    });
    const clock = createFakeClock();
    const wrapper = createAutosshWrapper(BASE_CONFIG, silentLogger(), {
      spawnImpl: spawnImpl as unknown as AutosshWrapperOptions['spawnImpl'],
      setTimeoutImpl: clock.setTimeoutImpl,
      clearTimeoutImpl: clock.clearTimeoutImpl,
      now: clock.now,
      initialBackoffMs: 1_000,
    });

    await wrapper.start();
    expect(wrapper.status()).toBe('reconnecting');
    expect(wrapper.isHealthy()).toBe(false);

    // Backoff → segunda tentativa, agora bem sucedida.
    clock.tick(1_000);
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    expect(wrapper.status()).toBe('running');
  });
});
