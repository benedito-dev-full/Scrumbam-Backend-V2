import { WORK_SESSION_STALE_MS } from '../../tasks/work-session.util';
import { McpToolError } from './tool.interface';
import { LockableTask, assertTaskNotLockedByOther } from './task-concurrency.guard';

describe('assertTaskNotLockedByOther (task #794 / DEV-123)', () => {
  const CALLER = BigInt(7);
  const OTHER = '99';
  const freshIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const staleIso = new Date(Date.now() - WORK_SESSION_STALE_MS - 1000).toISOString();

  const task = (
    status: string,
    workSessions: Array<{ startedAt: string; endedAt?: string; agentId?: string }>,
    activeWorkSession?: LockableTask['activeWorkSession'],
  ): LockableTask => ({
    status,
    dados: { telemetry: { workSessions } },
    activeWorkSession,
  });

  it('não trava quando a task não está EXECUTING', () => {
    const t = task('READY', [{ startedAt: freshIso, agentId: OTHER }]);
    expect(() => assertTaskNotLockedByOther(t, CALLER)).not.toThrow();
  });

  it('não trava quando não há workSession aberta', () => {
    const t = task('EXECUTING', [
      { startedAt: freshIso, endedAt: new Date().toISOString(), agentId: OTHER },
    ]);
    expect(() => assertTaskNotLockedByOther(t, CALLER)).not.toThrow();
  });

  it('não trava quando o dono é o PRÓPRIO caller (retomada legítima)', () => {
    const t = task('EXECUTING', [{ startedAt: freshIso, agentId: '7' }]);
    expect(() => assertTaskNotLockedByOther(t, CALLER)).not.toThrow();
  });

  it('não trava quando a sessão está órfã (> TTL 2h)', () => {
    const t = task('EXECUTING', [{ startedAt: staleIso, agentId: OTHER }]);
    expect(() => assertTaskNotLockedByOther(t, CALLER)).not.toThrow();
  });

  it('TRAVA quando EXECUTING com sessão aberta de OUTRO ator', () => {
    const t = task('EXECUTING', [{ startedAt: freshIso, agentId: OTHER }], {
      agentId: OTHER,
      agentName: 'Ana Souza',
      startedAt: freshIso,
    });
    expect(() => assertTaskNotLockedByOther(t, CALLER)).toThrow(McpToolError);
  });

  it('erro carrega reason=task_locked + QUEM (agentId+nome) + DESDE QUANDO', () => {
    const t = task('EXECUTING', [{ startedAt: freshIso, agentId: OTHER }], {
      agentId: OTHER,
      agentName: 'Ana Souza',
      startedAt: freshIso,
    });
    try {
      assertTaskNotLockedByOther(t, CALLER);
      fail('deveria ter lançado McpToolError');
    } catch (err) {
      expect(err).toBeInstanceOf(McpToolError);
      const e = err as McpToolError;
      expect(e.code).toBe(-32602); // INVALID_PARAMS
      expect(e.data).toEqual({
        reason: 'task_locked',
        lockedBy: { agentId: OTHER, agentName: 'Ana Souza' },
        since: freshIso,
      });
    }
  });

  it('TRAVA conservador quando agentId é nulo (dono não identificável)', () => {
    const t = task('EXECUTING', [{ startedAt: freshIso }]); // sem agentId
    try {
      assertTaskNotLockedByOther(t, CALLER);
      fail('deveria ter lançado McpToolError');
    } catch (err) {
      const e = err as McpToolError;
      expect(e).toBeInstanceOf(McpToolError);
      expect(e.data).toEqual({
        reason: 'task_locked',
        lockedBy: { agentId: null, agentName: null },
        since: freshIso,
      });
    }
  });

  it('agentName cai para null quando não hidratado no DTO', () => {
    const t = task('EXECUTING', [{ startedAt: freshIso, agentId: OTHER }]); // sem activeWorkSession
    try {
      assertTaskNotLockedByOther(t, CALLER);
      fail('deveria ter lançado');
    } catch (err) {
      const e = err as McpToolError;
      expect((e.data as { lockedBy: { agentName: string | null } }).lockedBy.agentName).toBeNull();
    }
  });
});
