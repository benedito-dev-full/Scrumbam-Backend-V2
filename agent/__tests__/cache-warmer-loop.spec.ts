/**
 * Specs do `cache-warmer-loop.ts`.
 *
 * Cobre 9 cenários:
 *  1. Intervalo respeitado (setInterval mockado)
 *  2. Itera todos os projetos do config em ORDEM
 *  3. Espaçamento 2s entre projetos (sleep mockado)
 *  4. 1 projeto falha → outros continuam
 *  5. `triggerNow()` dispara imediatamente
 *  6. `stop()` é idempotente
 *  7. 5 ticks com falha consecutivos → log circuit_open: true (continua)
 *  8. Cap diário atingido → próximos ticks NÃO chamam warm
 *  9. Virada do dia operacional → contador reseta
 *
 * Telemetria é log estruturado pino — captura via custom destination
 * em vez de mock de backend (decisão de escopo: warmer não persiste no
 * backend; observabilidade via SSH + journalctl + Anthropic Console).
 */
import pino from 'pino';
import type { AgentConfig, CacheWarmerConfig } from '../src/config/schema';
import { startCacheWarmerLoop } from '../src/lifecycle/cache-warmer-loop';
import type { WarmCacheInput, WarmCacheResult } from '../src/handlers/warm-cache.handler';

const TEST_CONFIG: AgentConfig = {
  agentId: 'agent-loop-test',
  agentApiKey: 'api',
  agentCommandSecret: 'secret',
  backendBaseUrl: 'https://api.test.local',
  backendTunnelHost: 'tunnel',
  backendTunnelPort: 22,
  tunnelPort: 39999,
  bindHost: '127.0.0.1',
  allowedProjectRoots: ['/home/dev/projetos'],
  claudeMdPath: '/home/dev/.claude/CLAUDE.md',
  agentSshKeyPath: '/etc/scrumban-agent/ssh_key',
  logLevel: 'error',
};

function silentLogger() {
  return pino({ level: 'silent' });
}

/** Captura logs estruturados pino em array, retornando logger + acessor. */
function capturingLogger(level: pino.Level = 'info') {
  const captured: Array<{ level: number; msg: string; obj: Record<string, unknown> }> = [];
  const logger = pino(
    { level },
    {
      write(chunk: string) {
        try {
          const parsed = JSON.parse(chunk) as Record<string, unknown>;
          captured.push({
            level: (parsed.level as number) ?? 0,
            msg: (parsed.msg as string) ?? '',
            obj: parsed,
          });
        } catch {
          /* ignore */
        }
      },
    },
  );
  return { logger, captured };
}

/** Builder de WarmCacheResult com defaults. */
function makeResult(over: Partial<WarmCacheResult>): WarmCacheResult {
  return {
    projectSlug: 'p',
    startedAt: '2026-05-20T00:00:00.000Z',
    durationMs: 100,
    exitCode: 0,
    success: true,
    claudeSessionId: '22df17ba-7d3d-4c0c-ad5d-234a9ad4b03d',
    cacheCreationTokens: 0,
    cacheReadTokens: 58077,
    inputTokens: 12,
    outputTokens: 3,
    costUsd: 0.003,
    ...over,
  };
}

const BASE_WARMER_CONFIG: CacheWarmerConfig = {
  enabled: true,
  intervalMinutes: 40,
  projects: ['p1', 'p2', 'p3'],
  warmupPrompt: 'responda apenas ok. nao use ferramentas.',
  claudeFlags: ['--permission-mode=plan', '--max-turns=1'],
  timeoutSeconds: 30,
  dailyCostCapUsd: 1.0,
};

describe('startCacheWarmerLoop', () => {
  it('1) intervalo respeitado (setInterval injetado)', () => {
    let capturedMs = -1;
    const setIntervalMock = jest.fn((_fn: () => void, ms: number) => {
      capturedMs = ms;
      return null as unknown as NodeJS.Timeout;
    });
    const clearIntervalMock = jest.fn();

    const handle = startCacheWarmerLoop(
      TEST_CONFIG,
      { ...BASE_WARMER_CONFIG, intervalMinutes: 40 },
      silentLogger(),
      {
        setIntervalImpl: setIntervalMock as never,
        clearIntervalImpl: clearIntervalMock as never,
      },
    );

    expect(setIntervalMock).toHaveBeenCalledTimes(1);
    expect(capturedMs).toBe(40 * 60_000); // 40min em ms

    handle.stop();
  });

  it('2) itera todos os projetos do config em ORDEM via triggerNow', async () => {
    const callOrder: string[] = [];
    const warmImpl = jest.fn(async (input: WarmCacheInput) => {
      callOrder.push(input.projectSlug);
      return makeResult({ projectSlug: input.projectSlug });
    });

    const handle = startCacheWarmerLoop(TEST_CONFIG, BASE_WARMER_CONFIG, silentLogger(), {
      setIntervalImpl: jest.fn(() => null as unknown as NodeJS.Timeout) as never,
      clearIntervalImpl: jest.fn() as never,
      sleepImpl: async () => {
        /* no-op para acelerar */
      },
      warmImpl:
        warmImpl as unknown as typeof import('../src/handlers/warm-cache.handler').warmCache,
    });

    await handle.triggerNow();

    expect(callOrder).toEqual(['p1', 'p2', 'p3']);
    handle.stop();
  });

  it('3) espaçamento entre projetos (sleep injetado é chamado N-1 vezes)', async () => {
    const sleepImpl = jest.fn(async () => {
      /* noop */
    });
    const warmImpl = jest.fn(async (input: WarmCacheInput) =>
      makeResult({ projectSlug: input.projectSlug }),
    );

    const handle = startCacheWarmerLoop(TEST_CONFIG, BASE_WARMER_CONFIG, silentLogger(), {
      setIntervalImpl: jest.fn(() => null as unknown as NodeJS.Timeout) as never,
      clearIntervalImpl: jest.fn() as never,
      sleepImpl,
      sequentialSpacingMs: 2000,
      warmImpl:
        warmImpl as unknown as typeof import('../src/handlers/warm-cache.handler').warmCache,
    });

    await handle.triggerNow();

    // 3 projetos → 2 espaçamentos
    expect(sleepImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(2000);
    handle.stop();
  });

  it('4) 1 projeto falha → outros continuam (log captura sucesso/erro)', async () => {
    const callOrder: string[] = [];
    const warmImpl = jest.fn(async (input: WarmCacheInput) => {
      callOrder.push(input.projectSlug);
      if (input.projectSlug === 'p2') {
        return makeResult({
          projectSlug: 'p2',
          success: false,
          errorCode: 'WARM_TIMEOUT',
          cacheReadTokens: 0,
        });
      }
      return makeResult({ projectSlug: input.projectSlug });
    });

    const { logger, captured } = capturingLogger('info');
    const handle = startCacheWarmerLoop(TEST_CONFIG, BASE_WARMER_CONFIG, logger, {
      setIntervalImpl: jest.fn(() => null as unknown as NodeJS.Timeout) as never,
      clearIntervalImpl: jest.fn() as never,
      sleepImpl: async () => undefined,
      warmImpl:
        warmImpl as unknown as typeof import('../src/handlers/warm-cache.handler').warmCache,
    });

    await handle.triggerNow();

    expect(callOrder).toEqual(['p1', 'p2', 'p3']);
    const reportLogs = captured.filter((c) => c.obj.stage === 'cache-warmer.report');
    expect(reportLogs).toHaveLength(3);
    expect(reportLogs[1]?.obj.success).toBe(false);
    expect(reportLogs[1]?.obj.errorCode).toBe('WARM_TIMEOUT');
    handle.stop();
  });

  it('5) triggerNow() dispara imediatamente sem esperar interval', async () => {
    const warmImpl = jest.fn(async (input: WarmCacheInput) =>
      makeResult({ projectSlug: input.projectSlug }),
    );
    const { logger, captured } = capturingLogger('info');

    const handle = startCacheWarmerLoop(
      TEST_CONFIG,
      { ...BASE_WARMER_CONFIG, projects: ['only-one'] },
      logger,
      {
        setIntervalImpl: jest.fn(() => null as unknown as NodeJS.Timeout) as never,
        clearIntervalImpl: jest.fn() as never,
        sleepImpl: async () => undefined,
        warmImpl:
          warmImpl as unknown as typeof import('../src/handlers/warm-cache.handler').warmCache,
      },
    );

    expect(warmImpl).not.toHaveBeenCalled();
    await handle.triggerNow();
    expect(warmImpl).toHaveBeenCalledTimes(1);
    const reportLogs = captured.filter((c) => c.obj.stage === 'cache-warmer.report');
    expect(reportLogs).toHaveLength(1);
    expect(reportLogs[0]?.obj.projectSlug).toBe('only-one');
    handle.stop();
  });

  it('6) stop() é idempotente', () => {
    const clearMock = jest.fn();
    const handle = startCacheWarmerLoop(TEST_CONFIG, BASE_WARMER_CONFIG, silentLogger(), {
      setIntervalImpl: jest.fn(() => null as unknown as NodeJS.Timeout) as never,
      clearIntervalImpl: clearMock as never,
    });

    handle.stop();
    handle.stop(); // 2ª chamada não deve crashar nem chamar clearInterval de novo
    handle.stop();
    expect(clearMock).toHaveBeenCalledTimes(1);
  });

  it('7) 5 ticks consecutivos com falha → log circuit_open: true (loop continua)', async () => {
    // Cada warm retorna success=false → todo tick acumula failure → após 5
    // ticks, circuit_open é logado mas o loop continua tentando.
    const warmImpl = jest.fn(async (input: WarmCacheInput) =>
      makeResult({
        projectSlug: input.projectSlug,
        success: false,
        errorCode: 'WARM_TIMEOUT',
        cacheReadTokens: 0,
      }),
    );

    const { logger, captured } = capturingLogger('error');
    const handle = startCacheWarmerLoop(
      TEST_CONFIG,
      { ...BASE_WARMER_CONFIG, projects: ['p1'] },
      logger,
      {
        setIntervalImpl: jest.fn(() => null as unknown as NodeJS.Timeout) as never,
        clearIntervalImpl: jest.fn() as never,
        sleepImpl: async () => undefined,
        warmImpl:
          warmImpl as unknown as typeof import('../src/handlers/warm-cache.handler').warmCache,
      },
    );

    for (let i = 0; i < 5; i += 1) {
      await handle.triggerNow();
    }

    const circuitLog = captured.find((c) => c.obj.circuit_open === true);
    expect(circuitLog).toBeDefined();
    expect(circuitLog?.obj.consecutiveFailures).toBe(5);
    handle.stop();
  });

  it('8) cap diário atingido → próximos ticks NÃO chamam warm', async () => {
    const warmImpl = jest.fn(async (input: WarmCacheInput) =>
      // Cada warm custa 0.6 USD → cap=1.0 → após 2 warms cap é estourado.
      makeResult({ projectSlug: input.projectSlug, costUsd: 0.6 }),
    );

    const handle = startCacheWarmerLoop(
      TEST_CONFIG,
      { ...BASE_WARMER_CONFIG, projects: ['p1'], dailyCostCapUsd: 1.0 },
      silentLogger(),
      {
        setIntervalImpl: jest.fn(() => null as unknown as NodeJS.Timeout) as never,
        clearIntervalImpl: jest.fn() as never,
        sleepImpl: async () => undefined,
        warmImpl:
          warmImpl as unknown as typeof import('../src/handlers/warm-cache.handler').warmCache,
      },
    );

    // Tick 1: spent=0 (< 1.0) → roda, total=0.6
    await handle.triggerNow();
    expect(warmImpl).toHaveBeenCalledTimes(1);

    // Tick 2: spent=0.6 (< 1.0) → roda, total=1.2
    await handle.triggerNow();
    expect(warmImpl).toHaveBeenCalledTimes(2);

    // Tick 3: spent=1.2 (>= 1.0) → CAP atingido, NÃO roda
    await handle.triggerNow();
    expect(warmImpl).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it('9) virada do dia operacional → contador reseta', async () => {
    const warmImpl = jest.fn(async (input: WarmCacheInput) =>
      makeResult({ projectSlug: input.projectSlug, costUsd: 0.6 }),
    );

    // Relógio que avança em 1 dia entre ticks.
    let nowMs = Date.UTC(2026, 4, 20, 12, 0, 0); // 2026-05-20T12:00:00Z
    const nowImpl = () => nowMs;

    const handle = startCacheWarmerLoop(
      TEST_CONFIG,
      { ...BASE_WARMER_CONFIG, projects: ['p1'], dailyCostCapUsd: 1.0 },
      silentLogger(),
      {
        setIntervalImpl: jest.fn(() => null as unknown as NodeJS.Timeout) as never,
        clearIntervalImpl: jest.fn() as never,
        sleepImpl: async () => undefined,
        nowImpl,
        warmImpl:
          warmImpl as unknown as typeof import('../src/handlers/warm-cache.handler').warmCache,
      },
    );

    // 2 ticks no mesmo dia (total=1.2 → cap atinge no 3º)
    await handle.triggerNow();
    await handle.triggerNow();
    await handle.triggerNow(); // capped
    expect(warmImpl).toHaveBeenCalledTimes(2);

    // Avança 1 dia
    nowMs = Date.UTC(2026, 4, 21, 12, 0, 0); // 2026-05-21T12:00:00Z
    await handle.triggerNow(); // novo dia → contador reseta → roda
    expect(warmImpl).toHaveBeenCalledTimes(3);
    handle.stop();
  });
});
