/**
 * runner.ts — grupo de processos (ADR-V2-083, L6) + escalonamento SIGTERM→SIGKILL (ADR-V2-082).
 *
 * Duas camadas:
 *  1. Fake `spawn` + fake `killGroup` (determinístico, fake timers): sinais vão
 *     para o GRUPO, stdin fechado, `detached`, dreno após `exit`.
 *  2. Processo REAL (`/bin/sh`): um neto que herda o stdout e fica vivo NÃO
 *     trava o runner (antes, com `execFile`, o callback nunca chegava e o mutex
 *     do slug ficava preso) e é morto junto com o grupo.
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import {
  KILL_GRACE_MS,
  runClaudeCode,
  spawnInProcessGroup,
  type KillGroupImpl,
  type SpawnImpl,
} from '../src/claude-code/runner';

interface FakeChild extends EventEmitter {
  pid: number;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: jest.Mock;
}

/**
 * Fake spawn. `diesOn` = sinais (no GRUPO) que fazem o líder sair.
 * `holdPipes=true` simula neto segurando o stdout: `exit` acontece, `close` não.
 */
function buildFake(opts: { diesOn: NodeJS.Signals[]; holdPipes?: boolean }) {
  let child: FakeChild | null = null;
  let spawnOpts: SpawnOptions | null = null;
  let spawnArgs: string[] = [];
  const groupSignals: NodeJS.Signals[] = [];

  const exitWith = (code: number | null, signal: NodeJS.Signals | null): void => {
    const c = child as FakeChild;
    setImmediate(() => {
      c.emit('exit', code, signal);
      if (!opts.holdPipes) setImmediate(() => c.emit('close', code, signal));
    });
  };

  const spawnImpl: SpawnImpl = (_file, args, o) => {
    spawnOpts = o;
    spawnArgs = args;
    const c = new EventEmitter() as FakeChild;
    c.pid = 4242;
    c.stdout = new PassThrough();
    c.stderr = new PassThrough();
    c.kill = jest.fn();
    child = c;
    return c as unknown as ChildProcess;
  };
  const killGroupImpl: KillGroupImpl = (pid, signal) => {
    expect(pid).toBe(4242);
    groupSignals.push(signal);
    if (opts.diesOn.includes(signal) && groupSignals.filter((s) => s === signal).length === 1) {
      exitWith(null, signal);
    }
  };
  return {
    spawnImpl,
    killGroupImpl,
    groupSignals,
    child: () => child as FakeChild,
    spawnOpts: () => spawnOpts as SpawnOptions,
    spawnArgs: () => spawnArgs,
    exitWith,
  };
}

describe('runClaudeCode — spawn em grupo próprio (L6)', () => {
  afterEach(() => jest.useRealTimers());

  it('spawn com detached:true e stdin FECHADO (ignore); argv com flags de sessão e sem --system-prompt', async () => {
    const fake = buildFake({ diesOn: [] });
    const p = runClaudeCode({
      prompt: 'oi',
      cwd: '/tmp',
      appendSystemPrompt: 'contrato',
      jsonSchema: '{}',
      excludeDynamicSections: true,
      spawnImpl: fake.spawnImpl,
      killGroupImpl: fake.killGroupImpl,
      drainMs: 10,
    });
    fake.child().stdout.write('{"ok":1}');
    fake.exitWith(0, null);
    const r = await p;

    expect(fake.spawnOpts()).toEqual(
      expect.objectContaining({ detached: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: '/tmp' }),
    );
    expect(fake.spawnArgs()).toEqual(
      expect.arrayContaining(['--append-system-prompt', 'contrato', '--json-schema', '{}']),
    );
    expect(fake.spawnArgs()).not.toContain('--system-prompt');
    expect(r).toEqual(expect.objectContaining({ exitCode: 0, timedOut: false, stdout: '{"ok":1}' }));
  });

  it('após o exit normal do líder, o GRUPO recebe SIGKILL (nenhum neto sobrevive)', async () => {
    const fake = buildFake({ diesOn: [] });
    const p = runClaudeCode({
      prompt: 'oi',
      cwd: '/tmp',
      spawnImpl: fake.spawnImpl,
      killGroupImpl: fake.killGroupImpl,
      drainMs: 10,
    });
    fake.exitWith(0, null);
    await p;
    expect(fake.groupSignals).toEqual(['SIGKILL']);
  });

  it('neto segurando o stdout (exit sem close) NÃO trava: resolve após o dreno', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    const fake = buildFake({ diesOn: [], holdPipes: true });
    const p = runClaudeCode({
      prompt: 'oi',
      cwd: '/tmp',
      spawnImpl: fake.spawnImpl,
      killGroupImpl: fake.killGroupImpl,
      drainMs: 5_000,
    });
    fake.child().stdout.write('parcial');
    fake.exitWith(0, null);
    await new Promise((r) => setImmediate(r));
    await jest.advanceTimersByTimeAsync(5_000);
    const r = await p;
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('parcial');
  });

  it('timeout: SIGTERM no GRUPO; processo que IGNORA SIGTERM recebe SIGKILL no GRUPO após o grace', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    const fake = buildFake({ diesOn: ['SIGKILL'] });
    const p = runClaudeCode({
      prompt: 'x',
      cwd: '/tmp',
      timeoutSec: 1,
      spawnImpl: fake.spawnImpl,
      killGroupImpl: fake.killGroupImpl,
      drainMs: 10,
    });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(fake.groupSignals).toEqual(['SIGTERM']);
    await jest.advanceTimersByTimeAsync(KILL_GRACE_MS);
    await jest.advanceTimersByTimeAsync(20);
    const r = await p;
    expect(fake.groupSignals.slice(0, 2)).toEqual(['SIGTERM', 'SIGKILL']);
    expect(r.timedOut).toBe(true);
    expect(r.signal).toBe('SIGKILL');
  });

  it('timeout: processo que respeita SIGTERM não recebe o SIGKILL do grace', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    const fake = buildFake({ diesOn: ['SIGTERM'] });
    const p = runClaudeCode({
      prompt: 'x',
      cwd: '/tmp',
      timeoutSec: 1,
      spawnImpl: fake.spawnImpl,
      killGroupImpl: fake.killGroupImpl,
      drainMs: 10,
    });
    await jest.advanceTimersByTimeAsync(1_000);
    await jest.advanceTimersByTimeAsync(20);
    const r = await p;
    await jest.advanceTimersByTimeAsync(KILL_GRACE_MS);
    expect(r.timedOut).toBe(true);
    // só o SIGKILL de limpeza pós-exit (um único), não um 2º do grace
    expect(fake.groupSignals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('M4: exit ANTES do timeout + timeout cairia durante o dreno → NÃO marca timedOut nem manda SIGTERM', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    const fake = buildFake({ diesOn: [], holdPipes: true }); // neto segura o pipe ⇒ dreno de 5s
    const p = runClaudeCode({
      prompt: 'x',
      cwd: '/tmp',
      timeoutSec: 2,
      spawnImpl: fake.spawnImpl,
      killGroupImpl: fake.killGroupImpl,
      drainMs: 5_000,
    });
    await jest.advanceTimersByTimeAsync(1_500);
    fake.exitWith(0, null); // sai em t=1.5s; timeout seria em t=2s (dentro do dreno)
    await new Promise((r) => setImmediate(r));
    await jest.advanceTimersByTimeAsync(5_000);
    const r = await p;
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(fake.groupSignals).toEqual(['SIGKILL']); // só a limpeza pós-exit, nenhum SIGTERM
  });

  it('binário ausente (error ENOENT) → resolve exitCode -1, nunca lança', async () => {
    const fake = buildFake({ diesOn: [] });
    const p = runClaudeCode({
      prompt: 'x',
      cwd: '/tmp',
      spawnImpl: fake.spawnImpl,
      killGroupImpl: fake.killGroupImpl,
    });
    fake.child().emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }));
    const r = await p;
    expect(r.exitCode).toBe(-1);
    expect(r.stderr).toContain('ENOENT');
  });

  it('kill de grupo com ESRCH (grupo vazio) cai no kill do líder sem lançar', async () => {
    const fake = buildFake({ diesOn: [] });
    const p = runClaudeCode({
      prompt: 'x',
      cwd: '/tmp',
      spawnImpl: fake.spawnImpl,
      killGroupImpl: () => {
        throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
      },
      drainMs: 10,
    });
    fake.exitWith(0, null);
    const r = await p;
    expect(r.exitCode).toBe(0);
    expect(fake.child().kill).toHaveBeenCalledWith('SIGKILL');
  });
});

describe('spawnInProcessGroup — processo REAL (L6)', () => {
  const isPosix = process.platform !== 'win32';
  const maybe = isPosix ? it : it.skip;

  maybe(
    'neto em background herdando o stdout não segura o runner e morre com o grupo',
    async () => {
      const marker = `scrumban-l6-${process.pid}-${Date.now()}`;
      const t0 = Date.now();
      const r = await spawnInProcessGroup({
        binary: '/bin/sh',
        // neto: sleep longo que HERDA o stdout; líder sai logo após imprimir
        args: ['-c', `(exec -a ${marker} sleep 30) & echo pronto`],
        cwd: process.cwd(),
        timeoutMs: 20_000,
        drainMs: 2_000,
      });
      const elapsed = Date.now() - t0;

      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('pronto');
      expect(elapsed).toBeLessThan(5_000); // com execFile esperaria os 30s do neto

      // o neto foi morto junto com o grupo
      await new Promise((res) => setTimeout(res, 200));
      const { execFileSync } = await import('node:child_process');
      let alive = '';
      try {
        alive = execFileSync('pgrep', ['-f', marker]).toString();
      } catch {
        alive = '';
      }
      expect(alive.trim()).toBe('');
    },
    15_000,
  );

  maybe(
    'timeout real: grupo que ignora SIGTERM é morto com SIGKILL após o grace',
    async () => {
      const r = await spawnInProcessGroup({
        binary: '/bin/sh',
        args: ['-c', "trap '' TERM; sleep 30"],
        cwd: process.cwd(),
        timeoutMs: 300,
        killGraceMs: 300,
        drainMs: 500,
      });
      expect(r.timedOut).toBe(true);
      expect(r.exitCode).toBeNull();
    },
    10_000,
  );
});
