/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import OperacaoExecucaoClaude from '../OperacaoExecucaoClaude';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

/**
 * ADR-V2-082 — métodos de desfecho terminal do Engine (CAS + baixa).
 * Zona da Task 1 (calcula/guardas de prompt) NÃO é exercitada aqui.
 */
function build(rows: unknown[] = [{ chave: BigInt(1) }]) {
  const bd = { $queryRaw: jest.fn().mockResolvedValue(rows) };
  const op = new OperacaoExecucaoClaude({
    usuario: 'system:test',
    classe: '-301',
    bd: bd as any,
    projectId: '20',
    agentId: '30',
    correlationId: 'corr',
    command: { text: 'x' },
    agentTunnelService: {},
    eventProducer: { addInternalEvent: jest.fn() } as any,
  });
  return { op, bd, sql: () => bd.$queryRaw.mock.calls[0][0] as Prisma.Sql };
}

describe('OperacaoExecucaoClaude — desfecho sistêmico (ADR-V2-082)', () => {
  it('L2: registrarOutcome grava runtime.finishedAt real (substitui o do sintético)', async () => {
    const t = build([{ chave: BigInt(1), supersedes: null }]);
    (t.bd as any).dVFS = { findFirst: jest.fn().mockResolvedValue(null) };

    await t.op.registrarOutcome({
      dadosExistentes: {
        chave: BigInt(1),
        idClasse: BigInt(-301),
        dados: {
          command: { text: 'x' },
          runtime: { startedAt: 'a', finishedAt: '2000-01-01T00:00:00.000Z' },
        } as any,
      },
      claudeSessionId: null,
      claudeSessionPath: null,
      resumedFrom: null,
      exitCode: 0,
      success: true,
      durationMs: 1,
      stdoutTruncated: '',
      stderrTruncated: '',
    });

    const json = JSON.parse(
      t.sql().values.find((v) => typeof v === 'string' && v.startsWith('{')) as string,
    );
    expect(json.runtime.startedAt).toBe('a');
    expect(json.runtime.finishedAt).not.toBe('2000-01-01T00:00:00.000Z');
  });

  it('encerrarPorFalhaSistemica: CAS (sem outcome + status esperado) + baixado + formato exigido pelo frontend', async () => {
    const t = build();

    const ok = await t.op.encerrarPorFalhaSistemica({
      chave: BigInt(1),
      reason: 'DISPATCH_FAILED',
      detail: 'ACK timeout',
      errorCode: 'ACK_TIMEOUT',
      expected: 'ANY_NON_TERMINAL',
    });

    expect(ok).toBe(true);
    const sql = t.sql();
    expect(sql.sql).toContain('baixado = true');
    expect(sql.sql).toContain(`dados->'audit'->'outcome' IS NULL`);
    expect(sql.sql).toContain(`'{statusCode}', to_jsonb('-520'::text)`);
    expect(sql.sql).toContain(`'exitCode', -1`);
    expect(sql.sql).toContain(`'finishedAt'`);
    expect(sql.sql).toContain(`'source', 'system'`);
    // ISO 8601 UTC, parseável por new Date() no frontend
    expect(sql.sql).toContain(`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`);
    expect(sql.sql).toContain(`dados->>'statusCode' IS NULL OR dados->>'statusCode' IN`);
    expect(sql.values).toEqual(
      expect.arrayContaining(['DISPATCH_FAILED', 'ACK timeout', 'ACK_TIMEOUT', '-514', '-518']),
    );
  });

  it('expected=RUNNING restringe a -518', async () => {
    const t = build();
    await t.op.encerrarPorFalhaSistemica({ chave: BigInt(1), reason: 'X', expected: 'RUNNING' });
    expect(t.sql().sql).toContain(`dados->>'statusCode' = '-518'`);
    expect(t.sql().values).not.toContain('-514');
  });

  it('CAS sem linhas → false (desfecho já gravado por callback/sweeper)', async () => {
    const t = build([]);
    await expect(
      t.op.encerrarPorFalhaSistemica({ chave: BigInt(1), reason: 'X', expected: 'RUNNING' }),
    ).resolves.toBe(false);
  });

  it('devolverParaFila: CAS -518 sem outcome → -514, remove runtime.startedAt, grava dispatch', async () => {
    const t = build();

    const ok = await t.op.devolverParaFila({
      chave: BigInt(1),
      busyAttempt: 3,
      nextAttemptAt: '2026-11-23T10:00:00.000Z',
    });

    expect(ok).toBe(true);
    const sql = t.sql();
    expect(sql.sql).toContain(`dados->>'statusCode' = '-518'`);
    expect(sql.sql).toContain(`dados->'audit'->'outcome' IS NULL`);
    expect(sql.sql).toContain(`- 'startedAt'`);
    expect(sql.sql).not.toContain('baixado = true'); // QUEUED não é terminal
    const dispatch = JSON.parse(sql.values.find((v) => typeof v === 'string' && v.startsWith('{')) as string);
    expect(dispatch).toEqual({
      busyAttempts: 3,
      nextAttemptAt: '2026-11-23T10:00:00.000Z',
      lastErrorCode: 'PROJECT_BUSY',
    });
  });

  it('encerrarVencidas repassa margem/default/limite e devolve as linhas do RETURNING', async () => {
    const rows = [{ chave: BigInt(9), idLocEscritu: null, dados: {}, reason: 'AGENT_RESTARTED' }];
    const bd = { $queryRaw: jest.fn().mockResolvedValue(rows) };

    const out = await OperacaoExecucaoClaude.encerrarVencidas(bd as any, {
      marginSec: 123,
      defaultTimeoutSec: 456,
      queueStaleSec: 789,
      limit: 7,
    });

    expect(out).toBe(rows);
    const sql = bd.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.values).toEqual(expect.arrayContaining([123, 456, 789, 7, 'QUEUE_STALE']));
    // M3: RUNNING e QUEUED/APPROVED em ramos separados; CAS pelo status lido
    expect(sql.sql).toContain(`p.dados->>'statusCode' = '-518'`);
    expect(sql.sql).toContain(`p.dados->>'statusCode' IN ('-514', '-516')`);
    expect(sql.sql).toContain('alvo.status_code');
  });
});
