import { TelemetryData } from './schemas/task-dados.schema';
import { WORK_SESSION_STALE_MS, resolveActiveWorkSession } from './work-session.util';

describe('resolveActiveWorkSession (task #794 / DEV-123)', () => {
  const NOW = Date.parse('2026-07-10T15:00:00.000Z');
  const freshIso = new Date(NOW - 30 * 60 * 1000).toISOString(); // 30min atrás
  const staleIso = new Date(NOW - WORK_SESSION_STALE_MS - 1000).toISOString(); // > 2h

  const telemetry = (workSessions: TelemetryData['workSessions']): TelemetryData => ({
    workSessions,
  });

  it('retorna null quando status != EXECUTING (mesmo com sessão aberta)', () => {
    const t = telemetry([{ startedAt: freshIso, agentId: '7' }]);
    expect(resolveActiveWorkSession(t, 'READY', NOW)).toBeNull();
    expect(resolveActiveWorkSession(t, 'DONE', NOW)).toBeNull();
    expect(resolveActiveWorkSession(t, 'INBOX', NOW)).toBeNull();
  });

  it('retorna a sessão aberta quando EXECUTING + fresca', () => {
    const t = telemetry([{ startedAt: freshIso, agentId: '7' }]);
    expect(resolveActiveWorkSession(t, 'EXECUTING', NOW)).toEqual({
      startedAt: freshIso,
      agentId: '7',
    });
  });

  it('retorna null quando todas as sessões estão fechadas (endedAt presente)', () => {
    const t = telemetry([
      { startedAt: freshIso, endedAt: new Date(NOW).toISOString(), agentId: '7' },
    ]);
    expect(resolveActiveWorkSession(t, 'EXECUTING', NOW)).toBeNull();
  });

  it('aplica TTL de 2h: sessão aberta porém ÓRFÃ (> 2h) trata como não-ativa', () => {
    const t = telemetry([{ startedAt: staleIso, agentId: '7' }]);
    expect(resolveActiveWorkSession(t, 'EXECUTING', NOW)).toBeNull();
  });

  it('agentId ausente vira null (dono não identificável)', () => {
    const t = telemetry([{ startedAt: freshIso }]);
    expect(resolveActiveWorkSession(t, 'EXECUTING', NOW)).toEqual({
      startedAt: freshIso,
      agentId: null,
    });
  });

  it('com múltiplas sessões, escolhe a ÚLTIMA aberta', () => {
    const olderClosed = { startedAt: staleIso, endedAt: freshIso, agentId: '1' };
    const openLast = { startedAt: freshIso, agentId: '9' };
    const t = telemetry([olderClosed, openLast]);
    expect(resolveActiveWorkSession(t, 'EXECUTING', NOW)).toEqual({
      startedAt: freshIso,
      agentId: '9',
    });
  });

  it('retorna null para telemetry ausente / workSessions vazio', () => {
    expect(resolveActiveWorkSession(null, 'EXECUTING', NOW)).toBeNull();
    expect(resolveActiveWorkSession(undefined, 'EXECUTING', NOW)).toBeNull();
    expect(resolveActiveWorkSession(telemetry([]), 'EXECUTING', NOW)).toBeNull();
    expect(resolveActiveWorkSession(telemetry(undefined), 'EXECUTING', NOW)).toBeNull();
  });

  it('retorna null quando startedAt é inválido', () => {
    const t = telemetry([{ startedAt: 'not-a-date', agentId: '7' }]);
    expect(resolveActiveWorkSession(t, 'EXECUTING', NOW)).toBeNull();
  });

  it('sessão exatamente no limite do TTL ainda é considerada fresca', () => {
    const edgeIso = new Date(NOW - WORK_SESSION_STALE_MS).toISOString();
    const t = telemetry([{ startedAt: edgeIso, agentId: '7' }]);
    expect(resolveActiveWorkSession(t, 'EXECUTING', NOW)).toEqual({
      startedAt: edgeIso,
      agentId: '7',
    });
  });
});
