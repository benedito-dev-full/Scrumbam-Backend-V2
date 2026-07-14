import { Logger } from '@nestjs/common';
import { MetricsService } from '../metrics.service';

describe('MetricsService (F0 — observabilidade)', () => {
  let service: MetricsService;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new MetricsService();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Extrai o objeto JSON da última linha logada. */
  const lastLine = (spy: jest.SpyInstance): Record<string, unknown> =>
    JSON.parse(spy.mock.calls[spy.mock.calls.length - 1][0] as string) as Record<string, unknown>;

  it('emite linha JSON com o campo `metric` (consultável por grep/jq)', () => {
    service.increment('auth.refresh.attempt', { userGroupId: '42' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = lastLine(logSpy);
    expect(line.metric).toBe('auth.refresh.attempt');
    expect(line.userGroupId).toBe('42');
    expect(line.count).toBe(1);
    expect(typeof line.ts).toBe('string');
  });

  it('acumula o contador entre chamadas', () => {
    service.increment('auth.401', { reason: 'token_expired' });
    service.increment('auth.401', { reason: 'no_credential' });

    expect(service.getSnapshot().counters['auth.401']).toBe(2);
  });

  it('respeita o nível warn (sinais críticos como revoke_all)', () => {
    service.increment('auth.refresh.revoke_all', { userGroupId: '7' }, { level: 'warn' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    expect(lastLine(warnSpy).metric).toBe('auth.refresh.revoke_all');
  });

  it('modo silent conta sem poluir o log (cache hit/miss de alta frequência)', () => {
    service.increment('auth.role_cache.hit', { cache: 'org' }, { silent: true });
    service.increment('auth.role_cache.hit', { cache: 'org' }, { silent: true });

    expect(logSpy).not.toHaveBeenCalled();
    expect(service.getSnapshot().counters['auth.role_cache.hit']).toBe(2);
  });

  it('NUNCA loga valor string em campo com nome de segredo', () => {
    service.increment('teste', {
      refreshToken: 'super-secreto',
      passwordHash: 'abc123',
      userGroupId: '9',
    });

    const line = lastLine(logSpy);
    expect(line.refreshToken).toBe('[redacted]');
    expect(line.passwordHash).toBe('[redacted]');
    expect(line.userGroupId).toBe('9');
    expect(JSON.stringify(line)).not.toContain('super-secreto');
  });

  it('preserva boolean `hadRefreshToken` (é sinal, não segredo)', () => {
    service.increment('frontend.auth_zombie', { hadRefreshToken: true });

    expect(lastLine(logSpy).hadRefreshToken).toBe(true);
  });

  it('não lança quando o campo é impossível de serializar', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() =>
      service.increment('teste', circular as unknown as Record<string, string>),
    ).not.toThrow();
  });
});
