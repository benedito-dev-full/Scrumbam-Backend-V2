/**
 * runner.ts — escalonamento SIGTERM → SIGKILL (ADR-V2-082, Task 2 Fase 9).
 *
 * `execFile({timeout})` manda só SIGTERM. Um `claude` que ignora SIGTERM
 * prendia o mutex do slug para sempre (todo dispatch virava 409). O runner
 * agora arma SIGKILL após o grace. Testes usam `execFileImpl` fake (sem
 * processo real) + fake timers.
 */
import { EventEmitter } from 'node:events';
import type { execFile } from 'node:child_process';
import { runClaudeCode, KILL_GRACE_MS } from '../src/claude-code/runner';

type Cb = (err: Error | null, stdout: string, stderr: string) => void;

interface FakeChild extends EventEmitter {
  kill: jest.Mock;
  signals: string[];
}

/**
 * Fake execFile: o "processo" só termina quando recebe um dos sinais em
 * `diesOn` (ou nunca, se vazio). Registra os sinais recebidos.
 */
function buildFakeExecFile(diesOn: string[]): {
  impl: typeof execFile;
  child: () => FakeChild;
} {
  let current: FakeChild | null = null;
  const impl = ((_bin: string, _args: string[], _opts: unknown, cb: Cb) => {
    const child = new EventEmitter() as FakeChild;
    child.signals = [];
    child.kill = jest.fn((signal: string) => {
      child.signals.push(signal);
      if (diesOn.includes(signal)) {
        const err = Object.assign(new Error(`killed by ${signal}`), {
          killed: true,
          signal,
          code: null,
          stdout: 'partial-out',
          stderr: '',
        });
        // Node invoca o callback de forma assíncrona após o exit.
        setImmediate(() => cb(err, 'partial-out', ''));
      }
      return true;
    });
    current = child;
    return child;
  }) as unknown as typeof execFile;
  return { impl, child: () => current as FakeChild };
}

describe('runClaudeCode — timeout com escalonamento SIGKILL', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('processo que IGNORA SIGTERM recebe SIGKILL após o grace e a promise resolve (mutex liberável)', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    const fake = buildFakeExecFile(['SIGKILL']); // ignora SIGTERM

    const p = runClaudeCode({
      prompt: 'x',
      cwd: '/tmp',
      timeoutSec: 30,
      execFileImpl: fake.impl,
    });

    // Estoura o timeout → SIGTERM (ignorado)
    jest.advanceTimersByTime(30_000);
    expect(fake.child().signals).toEqual(['SIGTERM']);

    // Grace ainda não venceu → nada de SIGKILL
    jest.advanceTimersByTime(KILL_GRACE_MS - 1);
    expect(fake.child().signals).toEqual(['SIGTERM']);

    // Grace vence → SIGKILL
    jest.advanceTimersByTime(1);
    expect(fake.child().signals).toEqual(['SIGTERM', 'SIGKILL']);

    const result = await p;
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe('SIGKILL');
    expect(result.exitCode).toBeNull();
    expect(result.stdout).toBe('partial-out');
  });

  it('processo que respeita SIGTERM NÃO recebe SIGKILL', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    const fake = buildFakeExecFile(['SIGTERM', 'SIGKILL']);

    const p = runClaudeCode({
      prompt: 'x',
      cwd: '/tmp',
      timeoutSec: 30,
      execFileImpl: fake.impl,
    });

    jest.advanceTimersByTime(30_000);
    const result = await p;
    // Mesmo avançando além do grace, o SIGKILL não é enviado (settled).
    jest.advanceTimersByTime(KILL_GRACE_MS * 2);

    expect(fake.child().signals).toEqual(['SIGTERM']);
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe('SIGTERM');
  });

  it('processo que termina antes do timeout não recebe sinal algum (timers limpos)', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    let callback: Cb | null = null;
    const kill = jest.fn();
    const impl = ((_b: string, _a: string[], _o: unknown, cb: Cb) => {
      callback = cb;
      const child = new EventEmitter() as FakeChild;
      child.kill = kill;
      return child;
    }) as unknown as typeof execFile;

    const p = runClaudeCode({ prompt: 'x', cwd: '/tmp', timeoutSec: 30, execFileImpl: impl });
    callback!(null, '{"type":"result"}', '');
    const result = await p;

    jest.advanceTimersByTime(30_000 + KILL_GRACE_MS + 1);
    expect(kill).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('killGraceMs customizado é respeitado', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    const fake = buildFakeExecFile(['SIGKILL']);

    const p = runClaudeCode({
      prompt: 'x',
      cwd: '/tmp',
      timeoutSec: 30,
      killGraceMs: 1000,
      execFileImpl: fake.impl,
    });

    jest.advanceTimersByTime(30_000 + 1000);
    expect(fake.child().signals).toEqual(['SIGTERM', 'SIGKILL']);
    await expect(p).resolves.toMatchObject({ timedOut: true, signal: 'SIGKILL' });
  });
});
