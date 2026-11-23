/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Job } from 'bullmq';
import { ExecutionRunProcessor } from '../processors/execution-run.processor';
import { ExecutionQueueService, ExecutionRunJobData } from '../queues/execution-queue.service';
import { PrismaService } from '../../prisma.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { AgentTunnelService } from '../../automation/agents/agent-tunnel.service';
import { RemoteExecutionClient } from '../../automation/runtime/remote-execution-client';
import { ExecutionRuntimeLogService } from '../../automation/runtime/execution-runtime-log.service';
import { RemoteAgentHttpError } from '../../automation/runtime/remote-agent-http.error';
import { TasksService } from '../../tasks/tasks.service';
import { isExecutionFailureReason } from '../constants/execution-lifecycle.const';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

/** Classifica uma chamada `$queryRaw(Prisma.sql…)` do Engine pelo SQL. */
function kindOf(sql: Prisma.Sql): 'encerrar' | 'devolver' | 'other' {
  if (sql.sql.includes("'-520'")) return 'encerrar';
  if (sql.sql.includes("'-514'")) return 'devolver';
  return 'other';
}

function callsOf(mock: jest.Mock, kind: 'encerrar' | 'devolver'): Prisma.Sql[] {
  return mock.mock.calls.map((c) => c[0] as Prisma.Sql).filter((s) => kindOf(s) === kind);
}

interface Scenario {
  pedidoDados?: Record<string, unknown>;
  project?: Record<string, unknown> | null;
  agentDados?: Record<string, unknown>;
  probeOk?: boolean;
  markRunningCount?: number;
  /** Linhas devolvidas pelo UPDATE de encerramento (CAS). */
  encerrarApplied?: boolean;
  devolverApplied?: boolean;
  /** Releitura pós-ACK do DPedido (moveLinkedTaskToExecutingIfStillRunning). */
  rereadDados?: Record<string, unknown>;
  /** Outra execução RUNNING da mesma task (handleMarkRunningLost). */
  otherRunning?: { chave: bigint } | null;
  executeImpl?: jest.Mock;
  taskStatus?: string;
  busyAttempt?: number;
  enqueueRetryImpl?: jest.Mock;
}

function build(sc: Scenario = {}) {
  const pedido = {
    chave: BigInt(123),
    idClasse: BigInt(-301),
    idLocEscritu: BigInt(20),
    dados: sc.pedidoDados ?? {
      statusCode: '-514',
      prompt: 'refatore o servico X',
      timeoutSec: 600,
      task: { id: '55' },
      audit: { projectId: '20', agentId: '30', correlationId: 'corr' },
    },
  };

  const findFirst = jest.fn().mockImplementation(({ where, select }: any) => {
    // handleMarkRunningLost: busca outra RUNNING da mesma task
    if (where?.chave?.not !== undefined) return Promise.resolve(sc.otherRunning ?? null);
    // releitura pós-ACK (select so dados)
    if (select && select.dados && !select.idClasse) {
      return Promise.resolve({
        dados: sc.rereadDados ?? { ...pedido.dados, statusCode: '-518' },
      });
    }
    return Promise.resolve(pedido);
  });

  const queryRaw = jest.fn().mockImplementation((sql: Prisma.Sql) => {
    const kind = kindOf(sql);
    if (kind === 'encerrar') {
      return Promise.resolve(sc.encerrarApplied === false ? [] : [{ chave: BigInt(123) }]);
    }
    if (kind === 'devolver') {
      return Promise.resolve(sc.devolverApplied === false ? [] : [{ chave: BigInt(123) }]);
    }
    return Promise.resolve([]);
  });

  const prisma = {
    dPedido: { findFirst, update: jest.fn() },
    dProject: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          sc.project === null
            ? null
            : { chave: BigInt(20), dados: sc.project ?? { slug: 'scrumban-backend-v2' } },
        ),
    },
    dEntidade: {
      findFirst: jest.fn().mockResolvedValue({
        chave: BigInt(30),
        dados: sc.agentDados ?? { tunnelPort: 20000, agentCommandSecretEncrypted: 'encrypted' },
      }),
    },
    $executeRaw: jest.fn().mockImplementation(async (strings: string[]) =>
      // advisory lock (SELECT pg_advisory_xact_lock) → 1; UPDATE do markRunning → cenário
      strings.join('?').includes('pg_advisory_xact_lock') ? 1 : (sc.markRunningCount ?? 1),
    ),
    $queryRaw: queryRaw,
    // markRunning roda em $transaction (Ciclo 2 / M1): tx = o próprio mock.
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
  const agentTunnel = {
    probe: jest
      .fn()
      .mockResolvedValue(
        sc.probeOk === false ? { tunnelOk: false, error: 'TUNNEL_UNAVAILABLE' } : { tunnelOk: true },
      ),
  };
  const remoteClient = {
    execute: sc.executeImpl ?? jest.fn().mockResolvedValue({ accepted: true, executionId: '123' }),
  };
  const logService = { recordSystem: jest.fn().mockResolvedValue(undefined) };
  const tasksService = {
    updateStatus: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue({ status: sc.taskStatus ?? 'READY' }),
  };
  const executionQueue = {
    enqueueRetry: sc.enqueueRetryImpl ?? jest.fn().mockResolvedValue({}),
  };

  const processor = new ExecutionRunProcessor(
    prisma as unknown as PrismaService,
    eventProducer as unknown as EventProducerService,
    agentTunnel as unknown as AgentTunnelService,
    remoteClient as unknown as RemoteExecutionClient,
    logService as unknown as ExecutionRuntimeLogService,
    tasksService as unknown as TasksService,
    executionQueue as unknown as ExecutionQueueService,
  );

  const job = {
    data: {
      executionId: '123',
      projectId: '20',
      agentId: '30',
      enqueuedAt: new Date().toISOString(),
      ...(sc.busyAttempt !== undefined ? { busyAttempt: sc.busyAttempt } : {}),
    },
  } as Job<ExecutionRunJobData>;

  return {
    processor,
    job,
    prisma,
    eventProducer,
    remoteClient,
    logService,
    tasksService,
    executionQueue,
  };
}

function eventTypes(eventProducer: { addInternalEvent: jest.Mock }): string[] {
  return eventProducer.addInternalEvent.mock.calls.map((c) => c[0] as string);
}

describe('ExecutionRunProcessor — falhas de dispatch (via Engine encerrarPorFalhaSistemica)', () => {
  it('probe offline → FAILED sistêmico (CAS + baixado + claude.finishedAt) e execution.failed com reason', async () => {
    const t = build({ probeOk: false });

    await t.processor.process(t.job);

    expect(t.remoteClient.execute).not.toHaveBeenCalled();
    expect(t.prisma.dPedido.update).not.toHaveBeenCalled(); // não usa mais o update raw do processor
    const [sql] = callsOf(t.prisma.$queryRaw, 'encerrar');
    // Ciclo 3: túnel indisponível tem código canônico próprio (reason + errorCode);
    // o detalhe do probe vai só para claude.stderr.
    expect(sql.values).toEqual(expect.arrayContaining(['TUNNEL_UNAVAILABLE', BigInt(123)]));
    expect(sql.values).not.toContain('DISPATCH_FAILED');
    // Formato exigido pelo frontend: claude.finishedAt + exitCode=-1; baixa canônica.
    expect(sql.sql).toContain("'finishedAt'");
    expect(sql.sql).toContain("'exitCode', -1");
    expect(sql.sql).toContain('baixado = true');
    expect(sql.sql).toContain("dados->'audit'->'outcome' IS NULL");
    expect(t.eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'execution.failed',
      expect.objectContaining({
        executionId: '123',
        projectId: '20',
        agentId: '30',
        taskId: '55',
        reason: 'TUNNEL_UNAVAILABLE',
        // L3 (Ciclo 2): errorCode canônico; detalhe só em claude.stderr/log
        errorCode: 'TUNNEL_UNAVAILABLE',
      }),
      'corr',
      { source: ExecutionRunProcessor.name },
    );
    expect(eventTypes(t.eventProducer)).not.toContain('execution.started');
    expect(t.logService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TUNNEL_UNAVAILABLE', line: 'TUNNEL_UNAVAILABLE' }),
    );
  });

  it('contrato runtime do agent incompleto → FAILED com mensagem clara', async () => {
    const t = build({ agentDados: { tunnelPort: 20000 } });

    await t.processor.process(t.job);

    const [sql] = callsOf(t.prisma.$queryRaw, 'encerrar');
    expect(sql.values).toContain('Agent sem tunnelPort ou agentCommandSecretEncrypted.');
    expect(eventTypes(t.eventProducer)).toContain('execution.failed');
  });

  it('DProject.dados.slug ausente → FAILED antes do dispatch', async () => {
    const t = build({ project: { automation: { remotePath: '/srv/repo' } } });

    await t.processor.process(t.job);

    expect(t.remoteClient.execute).not.toHaveBeenCalled();
    const [sql] = callsOf(t.prisma.$queryRaw, 'encerrar');
    expect(sql.values.some((v) => typeof v === 'string' && v.includes('slug'))).toBe(true);
  });

  it('CAS de encerramento não aplica (desfecho já gravado) → sem log, sem evento, sem mexer na task', async () => {
    const t = build({ probeOk: false, encerrarApplied: false, taskStatus: 'EXECUTING' });

    await t.processor.process(t.job);

    expect(eventTypes(t.eventProducer)).not.toContain('execution.failed');
    expect(t.logService.recordSystem).not.toHaveBeenCalled();
    expect(t.tasksService.updateStatus).not.toHaveBeenCalled();
  });

  it('failExecution tira a task de EXECUTING → FAILED (só se ainda EXECUTING)', async () => {
    const t = build({ probeOk: false, taskStatus: 'EXECUTING' });

    await t.processor.process(t.job);

    // M2/L7: marcador da execução no movedBy
    expect(t.tasksService.updateStatus).toHaveBeenCalledWith('55', {
      status: 'FAILED',
      movedBy: 'system:execution-123',
    });
  });

  it('failExecution NÃO pisa em task movida por humano (READY)', async () => {
    const t = build({ probeOk: false, taskStatus: 'READY' });

    await t.processor.process(t.job);

    expect(t.tasksService.updateStatus).not.toHaveBeenCalled();
  });

  it('erros HTTP não-busy do agente (403/422/500) → FAILED imediato, sem retry', async () => {
    for (const status of [403, 422, 500]) {
      const t = build({
        executeImpl: jest
          .fn()
          .mockRejectedValue(new RemoteAgentHttpError(status, 'X', `HTTP ${status}`)),
      });
      await t.processor.process(t.job);
      expect(t.executionQueue.enqueueRetry).not.toHaveBeenCalled();
      expect(callsOf(t.prisma.$queryRaw, 'devolver')).toHaveLength(0);
      expect(callsOf(t.prisma.$queryRaw, 'encerrar')).toHaveLength(1);
    }
  });
});

describe('ExecutionRunProcessor — dispatch OK e ordem da task', () => {
  it('payload V2 completo + task → EXECUTING SÓ depois do ACK', async () => {
    const order: string[] = [];
    const t = build({
      executeImpl: jest.fn().mockImplementation(async () => {
        order.push('ack');
        return { accepted: true, executionId: '123' };
      }),
    });
    t.tasksService.updateStatus.mockImplementation(async () => {
      order.push('task');
      return {};
    });

    await t.processor.process(t.job);

    expect(t.remoteClient.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: '123',
        projectSlug: 'scrumban-backend-v2',
        idClasseRisk: -301,
        prompt: 'refatore o servico X',
        timeoutSec: 600,
      }),
    );
    expect(order).toEqual(['ack', 'task']);
    expect(t.tasksService.updateStatus).toHaveBeenCalledWith('55', { status: 'EXECUTING' });
    expect(eventTypes(t.eventProducer)).toEqual(['execution.started']);
  });

  it('callback ultrarrápido (releitura já SUCCESS) → task NÃO volta para EXECUTING', async () => {
    const t = build({
      rereadDados: {
        statusCode: '-519',
        audit: { outcome: { success: true, recordedAt: 'x', source: 'agent' } },
      },
    });

    await t.processor.process(t.job);

    expect(t.remoteClient.execute).toHaveBeenCalled();
    expect(t.tasksService.updateStatus).not.toHaveBeenCalled();
  });

  it('timeoutSec ausente (legado) → fallback 1800s enviado ao agente', async () => {
    const t = build({
      pedidoDados: {
        statusCode: '-514',
        prompt: 'p',
        audit: { projectId: '20', agentId: '30', correlationId: 'corr' },
      },
    });

    await t.processor.process(t.job);

    expect(t.remoteClient.execute).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutSec: 1800 }),
    );
  });
});

describe('ExecutionRunProcessor — markRunning reforçado (CAS)', () => {
  it('SQL exige outcome ausente e nenhuma OUTRA RUNNING da mesma task', async () => {
    const t = build();

    await t.processor.process(t.job);

    const updateCall = t.prisma.$executeRaw.mock.calls.find((c) =>
      (c[0] as string[]).join('?').includes('UPDATE "DPedido"'),
    )!;
    const sql = (updateCall[0] as string[]).join('?');
    expect(sql).toContain("dados->'audit'->'outcome' IS NULL");
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain(`o.dados->'task'->>'id' = "DPedido".dados->'task'->>'id'`);
  });

  it('CAS perdida para outra RUNNING da mesma task → FAILED DUPLICATE_TASK_EXECUTION', async () => {
    const t = build({ markRunningCount: 0, otherRunning: { chave: BigInt(99) } });

    await t.processor.process(t.job);

    expect(t.remoteClient.execute).not.toHaveBeenCalled();
    const [sql] = callsOf(t.prisma.$queryRaw, 'encerrar');
    expect(sql.values).toContain('DUPLICATE_TASK_EXECUTION');
    expect(t.eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'execution.failed',
      expect.objectContaining({ reason: 'DUPLICATE_TASK_EXECUTION' }),
      'corr',
      expect.anything(),
    );
  });

  it('CAS perdida sem duplicata (job stale) → skip silencioso', async () => {
    const t = build({ markRunningCount: 0, otherRunning: null });

    await t.processor.process(t.job);

    expect(t.remoteClient.execute).not.toHaveBeenCalled();
    expect(callsOf(t.prisma.$queryRaw, 'encerrar')).toHaveLength(0);
    expect(t.eventProducer.addInternalEvent).not.toHaveBeenCalled();
  });
});

describe('ExecutionRunProcessor — 409 PROJECT_BUSY → retry com backoff', () => {
  const busy = () =>
    jest
      .fn()
      .mockRejectedValue(new RemoteAgentHttpError(409, 'PROJECT_BUSY', 'HTTP 409 (PROJECT_BUSY)'));

  it('1º 409 → devolverParaFila + enqueueRetry(attempt=1, 30s, jobId -busy-1); task não vai a EXECUTING', async () => {
    const t = build({ executeImpl: busy() });

    await t.processor.process(t.job);

    const [devolver] = callsOf(t.prisma.$queryRaw, 'devolver');
    expect(devolver).toBeDefined();
    expect(devolver.sql).toContain("dados->>'statusCode' = '-518'");
    expect(devolver.sql).toContain("- 'startedAt'");
    expect(t.executionQueue.enqueueRetry).toHaveBeenCalledWith(
      { executionId: '123', projectId: '20', agentId: '30' },
      { attempt: 1, delayMs: 30000 },
    );
    expect(t.tasksService.updateStatus).not.toHaveBeenCalled();
    expect(eventTypes(t.eventProducer)).not.toContain('execution.failed');
    expect(callsOf(t.prisma.$queryRaw, 'encerrar')).toHaveLength(0);
    expect(t.logService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PROJECT_BUSY', line: 'PROJECT_BUSY retry 1/10 em 30s' }),
    );
  });

  it('backoff exponencial com teto: 4º 409 → 240s; 6º → 300s', async () => {
    const t4 = build({ executeImpl: busy(), busyAttempt: 3 });
    await t4.processor.process(t4.job);
    expect(t4.executionQueue.enqueueRetry).toHaveBeenCalledWith(expect.anything(), {
      attempt: 4,
      delayMs: 240000,
    });

    const t6 = build({ executeImpl: busy(), busyAttempt: 5 });
    await t6.processor.process(t6.job);
    expect(t6.executionQueue.enqueueRetry).toHaveBeenCalledWith(expect.anything(), {
      attempt: 6,
      delayMs: 300000,
    });
  });

  it('409 após a 10ª tentativa → FAILED PROJECT_BUSY_EXHAUSTED, sem novo retry', async () => {
    const t = build({ executeImpl: busy(), busyAttempt: 10 });

    await t.processor.process(t.job);

    expect(t.executionQueue.enqueueRetry).not.toHaveBeenCalled();
    const [sql] = callsOf(t.prisma.$queryRaw, 'encerrar');
    expect(sql.values).toContain('PROJECT_BUSY_EXHAUSTED');
    expect(t.eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'execution.failed',
      expect.objectContaining({
        reason: 'PROJECT_BUSY_EXHAUSTED',
        errorCode: 'PROJECT_BUSY_EXHAUSTED',
      }),
      'corr',
      expect.anything(),
    );
  });

  it('devolverParaFila não aplica (callback/sweeper venceu) → não re-enfileira', async () => {
    const t = build({ executeImpl: busy(), devolverApplied: false });

    await t.processor.process(t.job);

    expect(t.executionQueue.enqueueRetry).not.toHaveBeenCalled();
    expect(callsOf(t.prisma.$queryRaw, 'encerrar')).toHaveLength(0);
  });

  it('enqueueRetry falha (Redis) → FAILED (não fica QUEUED para sempre)', async () => {
    const t = build({
      executeImpl: busy(),
      enqueueRetryImpl: jest.fn().mockRejectedValue(new Error('redis down')),
    });

    await t.processor.process(t.job);

    const [sql] = callsOf(t.prisma.$queryRaw, 'encerrar');
    expect(sql.values.some((v) => typeof v === 'string' && v.includes('redis down'))).toBe(true);
  });
});

describe('ExecutionRunProcessor — Ciclo 2 (M1 lock, L1 started após ACK)', () => {
  it('M1: markRunning adquire pg_advisory_xact_lock(exec-task:<taskId>) na MESMA transação, ANTES do UPDATE', async () => {
    const t = build();

    await t.processor.process(t.job);

    expect(t.prisma.$transaction).toHaveBeenCalledTimes(1);
    const sqls = t.prisma.$executeRaw.mock.calls.map((c) => (c[0] as string[]).join('?'));
    expect(sqls[0]).toContain('pg_advisory_xact_lock(hashtext(');
    expect(t.prisma.$executeRaw.mock.calls[0][1]).toBe('exec-task:55');
    expect(sqls[1]).toContain('UPDATE "DPedido"');
  });

  it('M1: execução sem task não pega lock (só o UPDATE)', async () => {
    const t = build({
      pedidoDados: {
        statusCode: '-514',
        prompt: 'p',
        audit: { projectId: '20', agentId: '30', correlationId: 'corr' },
      },
    });

    await t.processor.process(t.job);

    const sqls = t.prisma.$executeRaw.mock.calls.map((c) => (c[0] as string[]).join('?'));
    expect(sqls.some((q) => q.includes('pg_advisory_xact_lock'))).toBe(false);
    expect(sqls).toHaveLength(1);
  });

  it('L1: 409 PROJECT_BUSY não emite execution.started (só após ACK)', async () => {
    const t = build({
      executeImpl: jest
        .fn()
        .mockRejectedValue(new RemoteAgentHttpError(409, 'PROJECT_BUSY', 'HTTP 409 (PROJECT_BUSY)')),
    });

    await t.processor.process(t.job);

    expect(eventTypes(t.eventProducer)).not.toContain('execution.started');
  });
});

describe('ExecutionRunProcessor — Ciclo 3: TODA falha sistêmica grava código canônico', () => {
  /** Códigos canônicos presentes nos valores do UPDATE de encerramento. */
  function canonicalReasons(t: ReturnType<typeof build>): string[] {
    const [sql] = callsOf(t.prisma.$queryRaw, 'encerrar');
    return [...new Set(sql.values.filter((v) => isExecutionFailureReason(v)) as string[])];
  }

  const busy = () =>
    jest.fn().mockRejectedValue(new RemoteAgentHttpError(409, 'PROJECT_BUSY', 'HTTP 409 (PROJECT_BUSY)'));

  it.each<[string, Scenario, string]>([
    ['projeto/agente não encontrado', { project: null }, 'DISPATCH_FAILED'],
    ['túnel indisponível (probe ECONNREFUSED)', { probeOk: false }, 'TUNNEL_UNAVAILABLE'],
    ['contrato runtime incompleto', { agentDados: { tunnelPort: 20000 } }, 'DISPATCH_FAILED'],
    ['slug ausente', { project: { automation: {} } }, 'DISPATCH_FAILED'],
    [
      'ACK timeout / erro de rede',
      { executeImpl: jest.fn().mockRejectedValue(new Error('This operation was aborted')) },
      'DISPATCH_FAILED',
    ],
    [
      'HTTP 500 do agente',
      { executeImpl: jest.fn().mockRejectedValue(new RemoteAgentHttpError(500, 'X', 'HTTP 500')) },
      'DISPATCH_FAILED',
    ],
    ['409 esgotado', { executeImpl: busy(), busyAttempt: 10 }, 'PROJECT_BUSY_EXHAUSTED'],
    [
      'falha ao re-enfileirar após 409',
      { executeImpl: busy(), enqueueRetryImpl: jest.fn().mockRejectedValue(new Error('redis')) },
      'DISPATCH_FAILED',
    ],
    [
      'duplicata (outra RUNNING da task)',
      { markRunningCount: 0, otherRunning: { chave: BigInt(99) } },
      'DUPLICATE_TASK_EXECUTION',
    ],
  ])('%s → audit.outcome.reason = %s', async (_label, scenario, expected) => {
    const t = build(scenario);

    await t.processor.process(t.job);

    expect(canonicalReasons(t)).toEqual([expected]);
    expect(t.eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'execution.failed',
      expect.objectContaining({ reason: expected, errorCode: expected }),
      'corr',
      expect.anything(),
    );
  });
});

