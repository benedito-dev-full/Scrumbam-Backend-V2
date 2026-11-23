/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExecutionRunningSweeperService } from '../execution-running-sweeper.service';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

/**
 * ADR-V2-082 — sweeper de RUNNING. O SQL de vencimento mora no Engine
 * (`encerrarVencidas`, UPDATE … RETURNING); aqui o mock de `$queryRaw` simula
 * as linhas devolvidas e validamos (a) o SQL enviado e (b) os efeitos pós-persistência.
 */
function row(chave: number, reason: string, taskId?: string) {
  return {
    chave: BigInt(chave),
    idLocEscritu: BigInt(20),
    reason,
    dados: {
      statusCode: '-520',
      ...(taskId ? { task: { id: taskId } } : {}),
      audit: { projectId: '20', agentId: '30', correlationId: `corr-${chave}` },
    },
  };
}

function build(
  opts: {
    rows?: any[];
    tasks?: Array<{ chave: bigint; state: string }>;
    /**
     * Outcome atual por execução em cada releitura (M2): 1ª chamada = pré-checagem,
     * 2ª = pós-checagem. Default: todas seguem `source='system'`.
     */
    outcomeReads?: Array<Record<string, { source: string; success: boolean }>>;
  } = {},
) {
  let readIdx = 0;
  const prisma = {
    dPedido: {
      findMany: jest.fn().mockImplementation(async ({ where }: any) => {
        const override = opts.outcomeReads?.[readIdx++];
        return (where.chave.in as bigint[]).map((chave) => ({
          chave,
          dados: {
            audit: {
              outcome: override?.[chave.toString()] ?? { source: 'system', success: false },
            },
          },
        }));
      }),
    },
    $queryRaw: jest.fn().mockResolvedValue(opts.rows ?? []),
    dTask: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          (opts.tasks ?? []).map((t) => ({ chave: t.chave, dados: { v3: { state: t.state } } })),
        ),
    },
  };
  const eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
  const logService = { recordSystem: jest.fn().mockResolvedValue(undefined) };
  const tasksService = { updateStatus: jest.fn().mockResolvedValue({}) };
  const sweeper = new ExecutionRunningSweeperService(
    prisma as any,
    eventProducer as any,
    logService as any,
    tasksService as any,
  );
  return { sweeper, prisma, eventProducer, logService, tasksService };
}

describe('ExecutionRunningSweeperService.sweepStaleRunning', () => {
  it('SQL do Engine: só -518 sem outcome, deadline (timeoutSec|1800 + 300s) OU restart via heartbeat, lote limitado, CAS + RETURNING', async () => {
    const t = build();

    await t.sweeper.sweepStaleRunning();

    const sql = t.prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toContain(`p.dados->>'statusCode' = '-518'`);
    expect(sql.sql).toContain(`p.dados->'audit'->'outcome' IS NULL`);
    expect(sql.sql).toContain('p.baixado = false');
    expect(sql.sql).toContain('make_interval');
    expect(sql.sql).toContain(`a.dados->>'lastSeen'`);
    expect(sql.sql).toContain(`a.dados->>'uptime'`);
    expect(sql.sql).toContain(`interval '60 seconds'`);
    expect(sql.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql.sql).toContain('RETURNING');
    expect(sql.sql).toContain('baixado = true');
    // valores: fallback 1800, margem 300, limite 100, motivos
    expect(sql.values).toEqual(
      expect.arrayContaining([1800, 300, 100, 900, 'TIMEOUT_NO_CALLBACK', 'AGENT_RESTARTED', 'QUEUE_STALE']),
    );
    // M3: QUEUED/APPROVED órfãs (prazo a partir de atualizadoEm/nextAttemptAt)
    expect(sql.sql).toContain(`p.dados->>'statusCode' IN ('-514', '-516')`);
    expect(sql.sql).toContain(`p.dados->'dispatch'->>'nextAttemptAt'`);
    // CAS: UPDATE re-confere o statusCode lido no SELECT
    expect(sql.sql).toContain(`"DPedido".dados->>'statusCode' = alvo.status_code`);
  });

  it('RETURNING vazio → zero eventos, zero logs, nenhuma task tocada', async () => {
    const t = build({ rows: [] });

    const n = await t.sweeper.sweepStaleRunning();

    expect(n).toBe(0);
    expect(t.eventProducer.addInternalEvent).not.toHaveBeenCalled();
    expect(t.logService.recordSystem).not.toHaveBeenCalled();
    expect(t.prisma.dTask.findMany).not.toHaveBeenCalled();
  });

  it('vencida por deadline → execution.failed TIMEOUT_NO_CALLBACK + log -496 + task EXECUTING→FAILED', async () => {
    const t = build({
      rows: [row(1, 'TIMEOUT_NO_CALLBACK', '55')],
      tasks: [{ chave: BigInt(55), state: 'EXECUTING' }],
    });

    const n = await t.sweeper.sweepStaleRunning();

    expect(n).toBe(1);
    expect(t.tasksService.updateStatus).toHaveBeenCalledWith('55', {
      status: 'FAILED',
      movedBy: 'system:execution-1',
    });
    expect(t.logService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: '1', code: 'TIMEOUT_NO_CALLBACK' }),
    );
    expect(t.eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'execution.failed',
      {
        executionId: '1',
        projectId: '20',
        agentId: '30',
        taskId: '55',
        reason: 'TIMEOUT_NO_CALLBACK',
        errorCode: 'TIMEOUT_NO_CALLBACK',
      },
      'corr-1',
      { source: ExecutionRunningSweeperService.name },
    );
  });

  it('agente reiniciado → reason AGENT_RESTARTED no evento', async () => {
    const t = build({ rows: [row(2, 'AGENT_RESTARTED')] });

    await t.sweeper.sweepStaleRunning();

    expect(t.eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'execution.failed',
      expect.objectContaining({ executionId: '2', reason: 'AGENT_RESTARTED' }),
      'corr-2',
      expect.anything(),
    );
  });

  it('task já movida por humano (READY) → não é sobrescrita; leitura de status em batch (1 query)', async () => {
    const t = build({
      rows: [row(1, 'TIMEOUT_NO_CALLBACK', '55'), row(2, 'TIMEOUT_NO_CALLBACK', '56')],
      tasks: [
        { chave: BigInt(55), state: 'READY' },
        { chave: BigInt(56), state: 'EXECUTING' },
      ],
    });

    await t.sweeper.sweepStaleRunning();

    expect(t.prisma.dTask.findMany).toHaveBeenCalledTimes(1);
    expect(t.tasksService.updateStatus).toHaveBeenCalledTimes(1);
    expect(t.tasksService.updateStatus).toHaveBeenCalledWith('56', {
      status: 'FAILED',
      movedBy: 'system:execution-2',
    });
  });

  it('reentrância bloqueada: ciclo em andamento faz o próximo retornar 0 sem consultar', async () => {
    let release!: (v: unknown) => void;
    const t = build();
    t.prisma.$queryRaw.mockReturnValueOnce(new Promise((r) => (release = r)));

    const first = t.sweeper.sweepStaleRunning();
    const second = await t.sweeper.sweepStaleRunning();
    release([]);
    await first;

    expect(second).toBe(0);
    expect(t.prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('erro no SQL não derruba o cron (retorna 0) e libera a guarda', async () => {
    const t = build();
    t.prisma.$queryRaw.mockRejectedValueOnce(new Error('db down'));

    await expect(t.sweeper.sweepStaleRunning()).resolves.toBe(0);
    await expect(t.sweeper.sweepStaleRunning()).resolves.toBe(0);
    expect(t.prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('falha ao mover uma task não impede eventos das demais', async () => {
    const t = build({
      rows: [row(1, 'TIMEOUT_NO_CALLBACK', '55'), row(2, 'TIMEOUT_NO_CALLBACK')],
      tasks: [{ chave: BigInt(55), state: 'EXECUTING' }],
    });
    t.tasksService.updateStatus.mockRejectedValueOnce(new Error('boom'));

    await t.sweeper.sweepStaleRunning();

    expect(t.eventProducer.addInternalEvent).toHaveBeenCalledTimes(2);
  });

  // ─── Ciclo 2 / M2: corrida com callback tardio ────────────────────────────

  it('M2 pré-checagem: callback real já substituiu o sintético → task NÃO vai a FAILED', async () => {
    const t = build({
      rows: [row(1, 'TIMEOUT_NO_CALLBACK', '55')],
      tasks: [{ chave: BigInt(55), state: 'EXECUTING' }],
      outcomeReads: [{ '1': { source: 'agent', success: true } }],
    });

    await t.sweeper.sweepStaleRunning();

    expect(t.tasksService.updateStatus).not.toHaveBeenCalled();
    expect(t.prisma.dTask.findMany).not.toHaveBeenCalled();
  });

  it('M2 pós-checagem: callback de sucesso chega entre o FAILED e a releitura → compensa para DONE', async () => {
    const t = build({
      rows: [row(1, 'TIMEOUT_NO_CALLBACK', '55')],
      tasks: [{ chave: BigInt(55), state: 'EXECUTING' }],
      outcomeReads: [
        { '1': { source: 'system', success: false } },
        { '1': { source: 'agent', success: true } },
      ],
    });

    await t.sweeper.sweepStaleRunning();

    expect(t.tasksService.updateStatus.mock.calls).toEqual([
      ['55', { status: 'FAILED', movedBy: 'system:execution-1' }],
      ['55', { status: 'DONE', movedBy: 'system:execution-1' }],
    ]);
  });

  it('M2 pós-checagem: callback de FALHA real no meio → task fica FAILED (sem compensação)', async () => {
    const t = build({
      rows: [row(1, 'TIMEOUT_NO_CALLBACK', '55')],
      tasks: [{ chave: BigInt(55), state: 'EXECUTING' }],
      outcomeReads: [
        { '1': { source: 'system', success: false } },
        { '1': { source: 'agent', success: false } },
      ],
    });

    await t.sweeper.sweepStaleRunning();

    expect(t.tasksService.updateStatus).toHaveBeenCalledTimes(1);
  });

  it('M3: QUEUE_STALE emite execution.failed com o motivo e libera a task se estiver EXECUTING', async () => {
    const t = build({ rows: [row(7, 'QUEUE_STALE', '57')], tasks: [{ chave: BigInt(57), state: 'READY' }] });

    await t.sweeper.sweepStaleRunning();

    expect(t.eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'execution.failed',
      expect.objectContaining({ executionId: '7', reason: 'QUEUE_STALE', taskId: '57' }),
      'corr-7',
      expect.anything(),
    );
    expect(t.tasksService.updateStatus).not.toHaveBeenCalled(); // READY = humano/fila, não mexe
  });
});

