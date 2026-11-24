import {
  computeBusyDelayMs,
  EXECUTION_BUSY_MAX_RETRIES,
  EXECUTION_DEADLINE_MARGIN_SEC,
  resolveExecutionLifecycleConfig,
  resolveExecutionTimeoutSec,
  toActiveExecutionStatus,
  EXECUTION_BUSY_MAX_WAIT_SEC,
  EXECUTION_FAILURE_REASON_CODES,
  EXECUTION_PIPELINE_REASON_CODES,
  executionBranchName,
  isBusyWaitExhausted,
  resolvePipelineTimeoutSec,
} from '../constants/execution-lifecycle.const';

/**
 * ADR-V2-082 — constantes e funções puras do ciclo de vida de execuções.
 */
describe('execution-lifecycle.const', () => {
  describe('resolveExecutionTimeoutSec (fonte única de timeout)', () => {
    it('default 1800s sem command/timeoutMs (modo PROMPT)', () => {
      expect(resolveExecutionTimeoutSec(undefined)).toBe(1800);
      expect(resolveExecutionTimeoutSec({})).toBe(1800);
      expect(resolveExecutionTimeoutSec({ timeoutMs: null })).toBe(1800);
    });

    it('converte ms → s com arredondamento', () => {
      expect(resolveExecutionTimeoutSec({ timeoutMs: 60000 })).toBe(60);
      expect(resolveExecutionTimeoutSec({ timeoutMs: 600400 })).toBe(600);
    });

    it('clamp 30..3600', () => {
      expect(resolveExecutionTimeoutSec({ timeoutMs: 10 })).toBe(30);
      expect(resolveExecutionTimeoutSec({ timeoutMs: 29000 })).toBe(30);
      expect(resolveExecutionTimeoutSec({ timeoutMs: 3600000 })).toBe(3600);
      expect(resolveExecutionTimeoutSec({ timeoutMs: 99999999 })).toBe(3600);
    });

    it('valores inválidos caem no default', () => {
      expect(resolveExecutionTimeoutSec({ timeoutMs: -5 })).toBe(1800);
      expect(resolveExecutionTimeoutSec({ timeoutMs: Number.NaN })).toBe(1800);
    });
  });

  describe('computeBusyDelayMs (backoff do 409 PROJECT_BUSY)', () => {
    it('30s, 60s, 120s, 240s, 300s (teto) …', () => {
      expect([1, 2, 3, 4, 5, 6, 10].map((n) => computeBusyDelayMs(n))).toEqual([
        30000, 60000, 120000, 240000, 300000, 300000, 300000,
      ]);
    });

    it('10 tentativas somam ≥ 1 janela de timeout default (30 min)', () => {
      let total = 0;
      for (let i = 1; i <= EXECUTION_BUSY_MAX_RETRIES; i++) total += computeBusyDelayMs(i);
      expect(total).toBeGreaterThanOrEqual(1800 * 1000);
    });

    it('attempt absurdo não estoura (teto)', () => {
      expect(computeBusyDelayMs(1000)).toBe(300000);
      expect(computeBusyDelayMs(0)).toBe(30000);
    });
  });

  describe('resolveExecutionLifecycleConfig (overrides por env)', () => {
    it('sem env → constantes (margem 300, 10 tentativas)', () => {
      const cfg = resolveExecutionLifecycleConfig({});
      expect(cfg.deadlineMarginSec).toBe(EXECUTION_DEADLINE_MARGIN_SEC);
      expect(cfg.busyMaxRetries).toBe(10);
      expect(cfg.sweeperBatchLimit).toBe(100);
    });

    it('env válido sobrescreve; inválido é ignorado', () => {
      const cfg = resolveExecutionLifecycleConfig({
        EXECUTION_DEADLINE_MARGIN_SEC: '600',
        EXECUTION_BUSY_MAX_RETRIES: 'abc',
        EXECUTION_BUSY_BASE_DELAY_MS: '-1',
      });
      expect(cfg.deadlineMarginSec).toBe(600);
      expect(cfg.busyMaxRetries).toBe(10);
      expect(cfg.busyBaseDelayMs).toBe(30000);
    });
  });

  it('toActiveExecutionStatus mapeia statusCode → contrato do 409/activeExecution', () => {
    expect(toActiveExecutionStatus('-518')).toBe('running');
    expect(toActiveExecutionStatus('-515')).toBe('awaiting_approval');
    expect(toActiveExecutionStatus('-514')).toBe('queued');
    expect(toActiveExecutionStatus('-516')).toBe('queued');
  });

  describe('ADR-V2-083 — modo esteira', () => {
    it('resolvePipelineTimeoutSec: default 4h, teto 6h, mínimo 30s (P2)', () => {
      expect(resolvePipelineTimeoutSec()).toBe(14400);
      expect(resolvePipelineTimeoutSec(21600)).toBe(21600);
      expect(resolvePipelineTimeoutSec(99999)).toBe(21600);
      expect(resolvePipelineTimeoutSec(5)).toBe(30);
      expect(resolvePipelineTimeoutSec(Number.NaN)).toBe(14400);
    });

    it('override de env do default do modo esteira e da janela de busy', () => {
      const cfg = resolveExecutionLifecycleConfig({
        EXECUTION_PIPELINE_DEFAULT_TIMEOUT_SEC: '7200',
        EXECUTION_BUSY_MAX_WAIT_SEC: '600',
      });
      expect(cfg.pipelineDefaultTimeoutSec).toBe(7200);
      expect(cfg.busyMaxWaitSec).toBe(600);
      const def = resolveExecutionLifecycleConfig({});
      expect(def.pipelineDefaultTimeoutSec).toBe(14400);
      expect(def.busyMaxWaitSec).toBe(EXECUTION_BUSY_MAX_WAIT_SEC);
    });

    it('P4: janela de espera do 409 = teto da esteira (6h) + margem (300s) = 21900s', () => {
      expect(EXECUTION_BUSY_MAX_WAIT_SEC).toBe(21900);
    });

    it('isBusyWaitExhausted: por TEMPO, não por contagem', () => {
      const t0 = Date.parse('2026-11-23T00:00:00.000Z');
      expect(isBusyWaitExhausted('2026-11-23T00:00:00.000Z', t0 + 41 * 60_000)).toBe(false);
      expect(isBusyWaitExhausted('2026-11-23T00:00:00.000Z', t0 + 21_900_000)).toBe(false);
      expect(isBusyWaitExhausted('2026-11-23T00:00:00.000Z', t0 + 21_900_001)).toBe(true);
      expect(isBusyWaitExhausted(undefined, t0)).toBe(false);
      expect(isBusyWaitExhausted('lixo', t0)).toBe(false);
    });

    it('executionBranchName = scrumban/exec-<id>', () => {
      expect(executionBranchName('4815')).toBe('scrumban/exec-4815');
    });

    it('motivos da esteira ⊂ lista canônica (13 códigos, 5 novos aditivos)', () => {
      expect(EXECUTION_FAILURE_REASON_CODES).toHaveLength(13);
      for (const c of EXECUTION_PIPELINE_REASON_CODES) {
        expect(EXECUTION_FAILURE_REASON_CODES).toContain(c);
      }
    });
  });
});
