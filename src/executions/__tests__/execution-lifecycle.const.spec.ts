import {
  computeBusyDelayMs,
  EXECUTION_BUSY_MAX_RETRIES,
  EXECUTION_DEADLINE_MARGIN_SEC,
  resolveExecutionLifecycleConfig,
  resolveExecutionTimeoutSec,
  toActiveExecutionStatus,
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
});
