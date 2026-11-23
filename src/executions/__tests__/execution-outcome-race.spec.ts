/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AgentsService, AuthenticatedAgent } from '../../automation/agents/agents.service';
import { ExecutionRunningSweeperService } from '../execution-running-sweeper.service';
import { ExecutionResultDto } from '../../automation/agents/dto/execution-result.dto';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

/**
 * ADR-V2-082 — corrida sweeper × callback e callback × callback.
 *
 * "Banco" fake de UMA linha DPedido que aplica, em memória, exatamente as
 * condições de CAS dos UPDATEs do Engine:
 *  - sweeper (`encerrarVencidas`): só -518 sem outcome → FAILED source='system';
 *  - callback (`registrarOutcome`): só sem outcome OU outcome source='system' →
 *    grava o real; se o anterior era 'system', grava `supersedes`.
 * Assim validamos a POLÍTICA (decisão CEO P1) ponta a ponta através de
 * AgentsService + Engine + Sweeper reais, sem Postgres.
 */
const EXEC_ID = '4815';
const AGENT_ID = '100';

interface Row {
  chave: bigint;
  idClasse: bigint;
  idLocEscritu: bigint;
  baixado: boolean;
  dados: any;
}

function initialRow(overrides: Partial<Row['dados']> = {}): Row {
  return {
    chave: BigInt(EXEC_ID),
    idClasse: BigInt(-301),
    idLocEscritu: BigInt(20),
    baixado: false,
    dados: {
      statusCode: '-518',
      command: { text: 'x' },
      task: { id: '55' },
      runtime: { startedAt: '2026-11-23T10:00:00.000Z' },
      risk: { level: 'LOW', explanation: 'ok', matchedPatterns: [], classifiedAt: 'x' },
      audit: { correlationId: 'corr', triggeredBy: '42', agentId: AGENT_ID, projectId: '20' },
      ...overrides,
    },
  };
}

function buildWorld(
  opts: {
    row?: Row;
    vencida?: boolean;
    staleReads?: boolean;
    taskState?: string;
    taskMovedBy?: string | null;
  } = {},
) {
  const db: { row: Row } = { row: opts.row ?? initialRow() };
  const frozen = structuredClone(db.row);
  const dvfs7 = { count: 0 };
  let taskState = opts.taskState ?? 'EXECUTING';
  let taskMovedBy: string | null = opts.taskMovedBy ?? null;

  const queryRaw = jest.fn().mockImplementation(async (sql: Prisma.Sql) => {
    const r = db.row;
    const outcome = r.dados?.audit?.outcome;

    // Sweeper (Engine.encerrarVencidas)
    if (sql.sql.includes('WITH alvo')) {
      if (r.dados.statusCode !== '-518' || outcome || r.baixado || opts.vencida === false) return [];
      const reason = 'TIMEOUT_NO_CALLBACK';
      const now = new Date().toISOString();
      r.dados = {
        ...r.dados,
        statusCode: '-520',
        claude: { ...(r.dados.claude ?? {}), exitCode: -1, stderr: reason, finishedAt: now },
        runtime: { ...(r.dados.runtime ?? {}), finishedAt: now },
        audit: {
          ...r.dados.audit,
          errorCode: reason,
          outcome: { success: false, source: 'system', reason, recordedAt: now },
        },
      };
      r.baixado = true;
      return [{ chave: r.chave, idLocEscritu: r.idLocEscritu, dados: structuredClone(r.dados), reason }];
    }

    // Callback (Engine.registrarOutcome — CAS)
    if (sql.sql.includes('{audit,outcome,supersedes}')) {
      if (outcome && outcome.source !== 'system') return [];
      const novo = JSON.parse(
        sql.values.find((v) => typeof v === 'string' && v.startsWith('{')) as string,
      );
      let supersedes: any = null;
      if (outcome?.source === 'system') {
        supersedes = { reason: outcome.reason, recordedAt: outcome.recordedAt };
        novo.audit.outcome.supersedes = supersedes;
      }
      r.dados = novo;
      r.baixado = true;
      return [{ chave: r.chave, supersedes }];
    }
    return [];
  });

  const prisma = {
    $queryRaw: queryRaw,
    dPedido: {
      findFirst: jest.fn().mockImplementation(async () =>
        structuredClone(opts.staleReads ? frozen : db.row),
      ),
      // releitura de outcomes pelo sweeper (Ciclo 2 / M2)
      findMany: jest.fn().mockImplementation(async () => [
        { chave: db.row.chave, dados: structuredClone(db.row.dados) },
      ]),
    },
    dTask: {
      findMany: jest.fn().mockImplementation(async () => [
        { chave: BigInt(55), dados: { v3: { state: taskState } } },
      ]),
    },
    dVFS: {
      findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
        where?.chaveScript === 7
          ? {
              chave: BigInt(1),
              chaveScript: 7,
              ativo: true,
              conteudo: '(async function posGravacao(op) { op.__dvfs7Hook(); })',
            }
          : null,
      ),
    },
  };

  const eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
  const tasksService = {
    findOne: jest.fn().mockImplementation(async () => ({
      status: taskState,
      dados: { v3: { state: taskState, movedBy: taskMovedBy } },
    })),
    updateStatus: jest
      .fn()
      .mockImplementation(async (_id: string, dto: { status: string; movedBy?: string }) => {
        taskState = dto.status;
        taskMovedBy = dto.movedBy ?? null;
        return {};
      }),
  };

  // DVFS chave 7 conta execuções via hook no prototype (script chama op.__dvfs7Hook()).
  const OperacaoExecucaoClaude = jest.requireActual(
    '../../engine/lib/operacao/OperacaoExecucaoClaude',
  ).default;
  OperacaoExecucaoClaude.prototype.__dvfs7Hook = () => {
    dvfs7.count += 1;
  };

  const agents = new AgentsService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    eventProducer as any,
    { getOrGenerate: () => 'corr' } as any,
    {} as any,
    tasksService as any,
  );
  const makeSweeper = () =>
    new ExecutionRunningSweeperService(
      prisma as any,
      eventProducer as any,
      { recordSystem: jest.fn().mockResolvedValue(undefined) } as any,
      tasksService as any,
    );
  const sweeper = makeSweeper();
  /** 2ª réplica do backend (instância distinta, mesmo banco). */
  const sweeper2 = makeSweeper();

  const agentEntity: AuthenticatedAgent = { chave: BigInt(AGENT_ID), dados: {} };
  const callback = (dto: Partial<ExecutionResultDto> = {}) =>
    agents.recordExecutionResult({
      agentId: AGENT_ID,
      agentEntity,
      dto: {
        executionId: EXEC_ID,
        exitCode: 0,
        success: true,
        durationMs: 1000,
        claudeSessionId: null,
        claudeSessionPath: null,
        resumedFrom: null,
        stdoutTruncated: 'ok',
        stderrTruncated: '',
        ...dto,
      } as ExecutionResultDto,
    });

  const events = (type: string) =>
    eventProducer.addInternalEvent.mock.calls.filter((c: any[]) => c[0] === type);

  return { db, sweeper, sweeper2, callback, events, dvfs7, getTask: () => taskState, tasksService };
}

describe('Corrida sweeper × callback (ADR-V2-082 — P1: verdade tardia substitui o sintético uma vez)', () => {
  it('(a) callback antes → sweeper encontra 0 linhas → nenhum execution.failed', async () => {
    const w = buildWorld();

    await w.callback();
    const n = await w.sweeper.sweepStaleRunning();

    expect(n).toBe(0);
    expect(w.events('execution.failed')).toHaveLength(0);
    expect(w.db.row.dados.statusCode).toBe('-519');
    expect(w.db.row.dados.audit.outcome.source).toBe('agent');
    expect(w.db.row.baixado).toBe(true);
    expect(w.getTask()).toBe('DONE');
  });

  it('(b) sweeper antes → callback aplica, grava supersedes, task FAILED → DONE', async () => {
    const w = buildWorld();

    expect(await w.sweeper.sweepStaleRunning()).toBe(1);
    expect(w.getTask()).toBe('FAILED');
    expect(w.db.row.dados.claude.finishedAt).toBeDefined(); // frontend encerra polling
    expect(w.db.row.dados.claude.exitCode).toBe(-1);

    const r = await w.callback();

    expect(r.alreadyPersisted).toBeUndefined();
    expect(w.db.row.dados.statusCode).toBe('-519');
    expect(w.db.row.dados.audit.outcome).toMatchObject({
      success: true,
      source: 'agent',
      supersedes: { reason: 'TIMEOUT_NO_CALLBACK' },
    });
    expect(w.db.row.dados.audit.errorCode).toBeUndefined();
    expect(w.getTask()).toBe('DONE');
    expect(w.events('execution.failed')).toHaveLength(1);
    const finished = w.events('agent.execution.finished');
    expect(finished).toHaveLength(1);
    expect(finished[0][1]).toMatchObject({ supersedes: { reason: 'TIMEOUT_NO_CALLBACK' } });
  });

  it('(c) callback 2× concorrentes (leituras antes de qualquer escrita) → 2º alreadyPersisted, DVFS 7 roda 1×', async () => {
    const w = buildWorld({ staleReads: true });

    const r1 = await w.callback();
    const r2 = await w.callback();

    expect(r1.alreadyPersisted).toBeUndefined();
    expect(r2.alreadyPersisted).toBe(true);
    expect(w.dvfs7.count).toBe(1);
    expect(w.events('agent.execution.finished')).toHaveLength(1);
  });

  it('(d) duas réplicas do sweeper → eventos só da vencedora', async () => {
    const w = buildWorld();

    const [a, b] = await Promise.all([
      w.sweeper.sweepStaleRunning(),
      w.sweeper2.sweepStaleRunning(),
    ]);

    expect(a + b).toBe(1);
    expect(w.events('execution.failed')).toHaveLength(1);
  });

  it('(e) supersede ÚNICO: sweeper → callback A (aplica) → callback B (0 linhas)', async () => {
    const w = buildWorld();

    await w.sweeper.sweepStaleRunning();
    const a = await w.callback();
    const b = await w.callback({ success: false, exitCode: 1 });

    expect(a.alreadyPersisted).toBeUndefined();
    expect(b.alreadyPersisted).toBe(true);
    expect(w.db.row.dados.statusCode).toBe('-519'); // B não sobrescreveu
    expect(w.dvfs7.count).toBe(1);
  });

  it('(f) desfecho do backfill (BACKFILL_STALE, source=system) também é substituível pelo callback', async () => {
    const w = buildWorld({
      row: (() => {
        const row = initialRow({ statusCode: '-520' });
        row.baixado = true;
        row.dados.audit.outcome = {
          success: false,
          source: 'system',
          reason: 'BACKFILL_STALE',
          recordedAt: '2026-11-23T09:00:00.000Z',
        };
        return row;
      })(),
    });

    const r = await w.callback();

    expect(r.alreadyPersisted).toBeUndefined();
    expect(w.db.row.dados.audit.outcome.supersedes).toEqual({
      reason: 'BACKFILL_STALE',
      recordedAt: '2026-11-23T09:00:00.000Z',
    });
  });

  it('(g) métodos de desfecho não tocam dados.risk nem chamam calcula() (guardas ADR-V2-081 não re-executam)', async () => {
    const OperacaoExecucaoClaude = jest.requireActual(
      '../../engine/lib/operacao/OperacaoExecucaoClaude',
    ).default;
    const calculaSpy = jest.spyOn(OperacaoExecucaoClaude.prototype, 'calcula');
    const w = buildWorld();
    const riskBefore = structuredClone(w.db.row.dados.risk);

    await w.sweeper.sweepStaleRunning();
    await w.callback();

    expect(calculaSpy).not.toHaveBeenCalled();
    expect(w.db.row.dados.risk).toEqual(riskBefore);
    calculaSpy.mockRestore();
  });

  // ─── Ciclo 2 / M2 + L7: critério seguro de promoção no supersede ─────────

  it('(M2) callback aplica ANTES do sweeper liberar a task (task ainda EXECUTING) → DONE e o sweeper não a derruba', async () => {
    const w = buildWorld();
    // Sweeper encerra a linha, mas o callback "entra" antes da liberação da task:
    // simulamos chamando o callback dentro da 1ª releitura do sweeper.
    const origFindMany = (w as any).sweeper['prisma'].dPedido.findMany;
    let injected = false;
    (w as any).sweeper['prisma'].dPedido.findMany = jest.fn().mockImplementation(async (args: any) => {
      if (!injected) {
        injected = true;
        await w.callback(); // task EXECUTING → promovida a DONE (supersede)
      }
      return origFindMany(args);
    });

    await w.sweeper.sweepStaleRunning();

    expect(w.getTask()).toBe('DONE');
    expect(w.db.row.dados.audit.outcome.source).toBe('agent');
  });

  it('(L7) FAILED manual de usuário (sem marcador) NÃO é promovido a DONE pelo callback tardio', async () => {
    const row = initialRow({ statusCode: '-520' });
    row.dados.audit.outcome = { success: false, source: 'system', reason: 'TIMEOUT_NO_CALLBACK', recordedAt: 'x' };
    const w = buildWorld({ row, taskState: 'FAILED', taskMovedBy: '42' });

    await w.callback();

    expect(w.getTask()).toBe('FAILED');
  });

  it('(L7) FAILED gravado por OUTRA execução (marcador de outro id) NÃO é promovido', async () => {
    const row = initialRow({ statusCode: '-520' });
    row.dados.audit.outcome = { success: false, source: 'system', reason: 'TIMEOUT_NO_CALLBACK', recordedAt: 'x' };
    const w = buildWorld({ row, taskState: 'FAILED', taskMovedBy: 'system:execution-9999' });

    await w.callback();

    expect(w.getTask()).toBe('FAILED');
  });
});

