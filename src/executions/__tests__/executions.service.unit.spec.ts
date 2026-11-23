/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ExecutionsService, parseExecutionInProgressConflict } from '../executions.service';
import { ExecuteCommandDto } from '../dto/execute-command.dto';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

function buildRiskGateScript(riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'): string {
  return `(async function riskGateValidator(op) {
    if (!op.dados) op.dados = {};
    op.dados.risk = {
      level: '${riskLevel}',
      explanation: 'Mock: ${riskLevel}',
      matchedPatterns: [],
      classifiedAt: new Date().toISOString()
    };
  })`;
}

function buildService(
  overrides: {
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
    projectExists?: boolean;
    membershipExists?: boolean;
    agentId?: string | null;
  } = {},
) {
  const {
    riskLevel = 'LOW',
    projectExists = true,
    membershipExists = true,
    agentId = '100',
  } = overrides;

  const mockPrisma = {
    dProject: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          projectExists ? { chave: BigInt(100), dados: {}, excluido: false } : null,
        ),
    },
    dVincula: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: any }) => {
        if (where?.idClasse === BigInt(-185)) {
          return Promise.resolve(
            agentId !== null
              ? {
                  chave: BigInt(900),
                  entidade: {
                    chave: BigInt(agentId),
                    dados: { statusCode: '-510', tunnelPort: 20000 },
                  },
                }
              : null,
          );
        }

        return Promise.resolve(membershipExists ? { idClasse: BigInt(-171) } : null);
      }),
    },
    dPedido: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({
        chave: BigInt(1000001),
        dados: {},
        criadoEm: new Date(),
        atualizadoEm: new Date(),
      }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(1000001) }]),
    $transaction: jest.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) =>
      fn({
        // tx.$executeRaw: advisory lock por task (Ciclo 2 / M1)
        $executeRaw: jest.fn().mockResolvedValue(1),
        dPedido: {
          create: jest.fn().mockResolvedValue({ chave: BigInt(1000001) }),
        },
      }),
    ),
    dVFS: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: any }) => {
        const scripts: Record<number, string> = {
          3: buildRiskGateScript(riskLevel),
          4: '(async function commandValidator(op) {})',
          5: '(async function posCalculo(op) {})',
          6: '(async function preGravacao(op) {})',
          7: '(async function posGravacao(op) {})',
        };
        const conteudo = scripts[where.chaveScript];
        return conteudo
          ? Promise.resolve({
              chave: BigInt(100),
              chaveScript: where.chaveScript,
              conteudo,
              ativo: true,
            })
          : Promise.resolve(null);
      }),
    },
    dEvento: {
      create: jest.fn().mockResolvedValue({ chave: BigInt(200) }),
    },
  };

  const mockEntidade = {
    getEntidadeIdFromUserGroup: jest.fn().mockResolvedValue(BigInt(42)),
  };
  const mockClaude = {
    runClaudeCode: jest.fn().mockResolvedValue({
      exitCode: 0,
      headBefore: 'abc1234',
      headAfter: 'abc1234',
      stdout: '[STUB] done',
      stderr: '',
    }),
  };
  const mockEventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
  const mockCommandValidator = { validate: jest.fn(), validateText: jest.fn() };
  const mockAgentTunnel = {
    probe: jest.fn().mockResolvedValue({ tunnelOk: true, latencyMs: 1 }),
  };
  const mockExecutionQueue = {
    enqueueExecution: jest.fn().mockResolvedValue(undefined),
  };
  // ADR-V2-049: PromptBuilder mockado — testes deste arquivo usam modo COMMAND
  // (passam command literal). `buildFromTaskId` retorna stub previsível
  // caso algum cenário evolua para modo PROMPT.
  const mockPromptBuilder = {
    buildFromTaskId: jest.fn().mockResolvedValue({
      prompt: 'mocked prompt',
      taskType: 'code',
      taskName: 'mocked task',
    }),
  };

  const service = new ExecutionsService(
    mockPrisma as any,
    mockEntidade as any,
    mockClaude as any,
    mockEventProducer as any,
    mockCommandValidator as any,
    mockAgentTunnel as any,
    mockExecutionQueue as any,
    mockPromptBuilder as any,
    // ProjectRefService (ADR-V2-058) — 9º parâmetro; drift corrigido na Task 2 (ADR-V2-082).
    { resolveEntidadeRef: jest.fn().mockImplementation((id: bigint) => Promise.resolve(id)) } as any,
  );

  return {
    service,
    mockPrisma,
    mockCommandValidator,
    mockAgentTunnel,
    mockExecutionQueue,
    mockPromptBuilder,
  };
}

describe('ExecutionsService.execute()', () => {
  const baseDto: ExecuteCommandDto = {
    command: {
      executable: 'npm',
      args: ['test'],
      cwd: '.',
      timeoutMs: 600000,
    },
  };

  it('deve lancar NotFoundException se projeto nao existe', async () => {
    const { service } = buildService({ projectExists: false });

    await expect(service.execute('100', baseDto, '1')).rejects.toThrow(NotFoundException);
  });

  it('deve lancar ForbiddenException se user nao e membro', async () => {
    const { service } = buildService({ membershipExists: false });

    await expect(service.execute('100', baseDto, '1')).rejects.toThrow(ForbiddenException);
  });

  it('deve lancar UnprocessableEntityException se agent primary nao existe', async () => {
    const { service } = buildService({ agentId: null });

    await expect(service.execute('100', baseDto, '1')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('deve criar execution LOW como queued e enfileirar job', async () => {
    const { service, mockPrisma, mockExecutionQueue } = buildService({ riskLevel: 'LOW' });
    mockPrisma.dPedido.findFirst.mockResolvedValue({
      chave: BigInt(1000001),
      idClasse: BigInt(-301),
      idPessoa: BigInt(42),
      dados: {
        approval: { status: 'queued' },
        command: { text: 'npm test', executable: 'npm', args: ['test'] },
        audit: { projectId: '100', triggeredBy: '42', agentId: '100', correlationId: 'test' },
        risk: { level: 'LOW', matchedPatterns: [] },
        riskLevelCode: '-525',
      },
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    });

    const result = await service.execute('100', baseDto, '1');

    expect(result.riskLevel).toBe('LOW');
    expect(result.approval.status).toBe('queued');
    expect(mockExecutionQueue.enqueueExecution).toHaveBeenCalledWith({
      executionId: '1000001',
      projectId: '100',
      agentId: '100',
    });
  });

  it('deve persistir MEDIUM como awaiting_approval', async () => {
    const { service, mockPrisma } = buildService({ riskLevel: 'MEDIUM' });
    mockPrisma.dPedido.findFirst.mockResolvedValue({
      chave: BigInt(1000002),
      idClasse: BigInt(-302),
      idPessoa: BigInt(42),
      dados: {
        approval: { status: 'awaiting_approval' },
        command: { text: 'npm test', executable: 'npm', args: ['test'] },
        audit: { projectId: '100', triggeredBy: '42', agentId: '100', correlationId: 'test' },
        risk: { level: 'MEDIUM', matchedPatterns: [] },
        riskLevelCode: '-526',
      },
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    });

    const result = await service.execute('100', baseDto, '1');

    expect(result.riskLevel).toBe('MEDIUM');
    expect(result.approval.status).toBe('awaiting_approval');
    expect(result.approval.approvedBy).toBeUndefined();
  });

  it('deve persistir HIGH como awaiting_approval', async () => {
    const { service, mockPrisma } = buildService({ riskLevel: 'HIGH' });
    mockPrisma.dPedido.findFirst.mockResolvedValue({
      chave: BigInt(1000003),
      idClasse: BigInt(-303),
      idPessoa: BigInt(42),
      dados: {
        approval: { status: 'awaiting_approval' },
        command: { text: 'npm test', executable: 'npm', args: ['test'] },
        audit: { projectId: '100', triggeredBy: '42', agentId: '100', correlationId: 'test' },
        risk: { level: 'HIGH', matchedPatterns: [] },
        riskLevelCode: '-527',
      },
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    });

    const result = await service.execute('100', baseDto, '1');

    expect(result.riskLevel).toBe('HIGH');
    expect(result.approval.status).toBe('awaiting_approval');
  });

  it('deve validar comando antes do Engine', async () => {
    const { service, mockCommandValidator } = buildService({ riskLevel: 'LOW' });

    await service.execute('100', baseDto, '1');

    expect(mockCommandValidator.validate).toHaveBeenCalledWith(baseDto.command);
  });

  it('nao deve criar DPedido quando validator rejeita comando', async () => {
    const { service, mockPrisma, mockCommandValidator } = buildService({ riskLevel: 'LOW' });
    mockCommandValidator.validate.mockImplementation(() => {
      throw new UnprocessableEntityException('comando rejeitado');
    });

    await expect(service.execute('100', baseDto, '1')).rejects.toThrow(
      UnprocessableEntityException,
    );

    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

/**
 * Captura o `dados` gravado pelo Engine no INSERT (`tx.dPedido.create`).
 */
function captureInsert(mockPrisma: any): { dados: any } {
  const captured: { dados: any } = { dados: null };
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) =>
    fn({
      // tx.$executeRaw: advisory lock por task (Ciclo 2 / M1)
      $executeRaw: jest.fn().mockResolvedValue(1),
      dPedido: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          captured.dados = data?.dados ?? null;
          return Promise.resolve({ chave: BigInt(1000001) });
        }),
      },
    }),
  );
  return captured;
}

describe('ExecutionsService.execute() — ADR-V2-082 (timeout fonte única + anti-duplicata)', () => {
  const persistedRow = {
    chave: BigInt(1000001),
    idClasse: BigInt(-301),
    idPessoa: BigInt(42),
    dados: {
      approval: { status: 'queued' },
      command: { text: 'x' },
      audit: { projectId: '100', triggeredBy: '42', agentId: '100', correlationId: 't' },
      risk: { level: 'LOW', matchedPatterns: [] },
    },
    criadoEm: new Date(),
    atualizadoEm: new Date(),
  };

  it('grava dados.timeoutSec = clamp(command.timeoutMs/1000) no modo COMMAND', async () => {
    const { service, mockPrisma } = buildService({ riskLevel: 'LOW' });
    const captured = captureInsert(mockPrisma);
    mockPrisma.dPedido.findFirst.mockResolvedValue(persistedRow);

    await service.execute(
      '100',
      { command: { executable: 'npm', args: ['test'], timeoutMs: 600000 } },
      '1',
    );

    expect(captured.dados.timeoutSec).toBe(600);
  });

  it('modo PROMPT: timeoutSec=1800 e placeholder timeoutMs coerente (1.800.000)', async () => {
    const { service, mockPrisma, mockPromptBuilder } = buildService({ riskLevel: 'LOW' });
    const captured = captureInsert(mockPrisma);
    // 1ª leitura = guard anti-duplicata (nenhuma ativa); depois = releitura pós-grava.
    mockPrisma.dPedido.findFirst.mockResolvedValueOnce(null).mockResolvedValue(persistedRow);

    await service.execute('100', { taskId: '55' }, '1');

    expect(mockPromptBuilder.buildFromTaskId).toHaveBeenCalled();
    expect(captured.dados.timeoutSec).toBe(1800);
    expect(captured.dados.command.timeoutMs).toBe(1800000);
  });

  it('task com execução RUNNING → 409 execution_in_progress ANTES de montar prompt/Engine', async () => {
    const { service, mockPrisma, mockPromptBuilder } = buildService({ riskLevel: 'LOW' });
    mockPrisma.dPedido.findFirst.mockResolvedValueOnce({
      chave: BigInt(777),
      dados: { task: { id: '55' }, statusCode: '-518' },
    });

    const err = await service.execute('100', { taskId: '55' }, '1').catch((e) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toEqual(
      expect.objectContaining({
        statusCode: 409,
        code: 'EXECUTION_IN_PROGRESS',
        details: { reason: 'execution_in_progress', executionId: '777', status: 'running' },
      }),
    );
    expect(parseExecutionInProgressConflict(err)).toEqual({
      executionId: '777',
      status: 'running',
    });
    expect(mockPromptBuilder.buildFromTaskId).not.toHaveBeenCalled();
    // Única transação = a do advisory lock (Ciclo 2 / M1); nenhum INSERT do Engine.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$transaction.mock.calls[0][1]).toEqual({ maxWait: 10000, timeout: 60000 });

    // Query única, filtrando baixado=false + task.id + status não-terminal
    const where = mockPrisma.dPedido.findFirst.mock.calls[0][0].where;
    expect(where.baixado).toBe(false);
    expect(where.AND[0]).toEqual({ dados: { path: ['task', 'id'], equals: '55' } });
    expect(where.AND[1].OR).toHaveLength(4);
  });

  it.each([
    ['-514', 'queued'],
    ['-515', 'awaiting_approval'],
    ['-516', 'queued'],
  ])('statusCode %s também bloqueia (status=%s)', async (code, status) => {
    const { service, mockPrisma } = buildService({ riskLevel: 'LOW' });
    mockPrisma.dPedido.findFirst.mockResolvedValueOnce({
      chave: BigInt(778),
      dados: { task: { id: '55' }, statusCode: code },
    });

    const err = await service.execute('100', { taskId: '55' }, '1').catch((e) => e);
    expect(parseExecutionInProgressConflict(err)).toEqual({ executionId: '778', status });
  });

  it('zumbi legado (baixado=false + statusCode terminal) NÃO bloqueia', async () => {
    const { service, mockPrisma } = buildService({ riskLevel: 'LOW' });
    const captured = captureInsert(mockPrisma);
    mockPrisma.dPedido.findFirst
      .mockResolvedValueOnce({ chave: BigInt(700), dados: { task: { id: '55' }, statusCode: '-519' } })
      .mockResolvedValue(persistedRow);

    await expect(service.execute('100', { taskId: '55' }, '1')).resolves.toBeDefined();
    // Nova execução criada (INSERT via Engine). Obs.: o nível final pode subir
    // para MEDIUM pela guarda da ADR-V2-081 (mock sem scannedSources) — irrelevante aqui.
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(captured.dados.task).toEqual({ id: '55' });
  });

  it('modo COMMAND sem taskId não consulta trava de duplicata', async () => {
    const { service, mockPrisma } = buildService({ riskLevel: 'LOW' });
    mockPrisma.dPedido.findFirst.mockResolvedValue(persistedRow);

    await service.execute('100', { command: { executable: 'npm', args: ['test'] } }, '1');

    const guardCalls = mockPrisma.dPedido.findFirst.mock.calls.filter(
      (c: any[]) => c[0]?.where?.baixado === false,
    );
    expect(guardCalls).toHaveLength(0);
  });
});

describe('ExecutionsService.execute() — Ciclo 2 / M1 (advisory lock por task)', () => {
  const row = (chave: number, taskId: string) => ({
    chave: BigInt(chave),
    idClasse: BigInt(-301),
    idPessoa: BigInt(42),
    dados: {
      task: { id: taskId },
      statusCode: '-514',
      approval: { status: 'queued' },
      command: { text: 'x' },
      audit: { projectId: '100', triggeredBy: '42', agentId: '100', correlationId: 't' },
      risk: { level: 'LOW', matchedPatterns: [] },
    },
    criadoEm: new Date(),
    atualizadoEm: new Date(),
  });

  it('com taskId: adquire pg_advisory_xact_lock(exec-task:<id>) ANTES da trava anti-duplicata', async () => {
    const { service, mockPrisma } = buildService({ riskLevel: 'LOW' });
    const order: string[] = [];
    const lockExec = jest.fn().mockImplementation(async () => {
      order.push('lock');
      return 1;
    });
    mockPrisma.$transaction.mockImplementation(async (fn: any, opts?: unknown) =>
      fn(
        opts
          ? { $executeRaw: lockExec }
          : { dPedido: { create: jest.fn().mockResolvedValue({ chave: BigInt(1) }) } },
      ),
    );
    mockPrisma.dPedido.findFirst.mockImplementation(async ({ where }: any) => {
      if (where?.baixado === false) order.push('guard');
      return where?.baixado === false ? null : row(1000001, '55');
    });

    await service.execute('100', { taskId: '55' }, '1');

    const [strings, key] = lockExec.mock.calls[0];
    expect((strings as string[]).join('?')).toContain('pg_advisory_xact_lock(hashtext(');
    expect(key).toBe('exec-task:55');
    expect(order.slice(0, 2)).toEqual(['lock', 'guard']);
  });

  it('modo COMMAND sem taskId não abre transação de lock', async () => {
    const { service, mockPrisma } = buildService({ riskLevel: 'LOW' });
    mockPrisma.dPedido.findFirst.mockResolvedValue(row(1000001, '55'));

    await service.execute('100', { command: { executable: 'npm', args: ['test'] } }, '1');

    const lockCalls = mockPrisma.$transaction.mock.calls.filter((c: any[]) => c[1] !== undefined);
    expect(lockCalls).toHaveLength(0);
  });

  it('2 requests SIMULTÂNEOS da mesma task: lock serializa → o 2º recebe 409 (sem write skew)', async () => {
    const { service, mockPrisma } = buildService({ riskLevel: 'LOW' });
    const db: any[] = [];
    let chain: Promise<unknown> = Promise.resolve();
    let nextKey = 2000;

    // Lock fake: transações com `opts` (advisory lock) rodam em fila; as do
    // Engine (INSERT) commitam na hora, como no Postgres.
    mockPrisma.$transaction.mockImplementation((fn: any, opts?: unknown) => {
      if (opts) {
        const run = chain.then(() => fn({ $executeRaw: jest.fn().mockResolvedValue(1) }));
        chain = run.catch(() => undefined);
        return run;
      }
      return fn({
        dPedido: {
          create: jest.fn().mockImplementation(async ({ data }: any) => {
            const chave = BigInt(nextKey++);
            db.push({ ...row(Number(chave), '55'), chave, dados: data.dados });
            return { chave };
          }),
        },
      });
    });
    mockPrisma.$queryRaw.mockImplementation(async () => [{ nextval: BigInt(nextKey) }]);
    mockPrisma.dPedido.findFirst.mockImplementation(async ({ where }: any) => {
      if (where?.baixado === false) {
        // Engine grava statusCode -514/-515: ambos não-terminais
        return db.find((r) => r.dados?.task?.id === '55') ?? null;
      }
      return db[db.length - 1] ?? null;
    });

    const results = await Promise.allSettled([
      service.execute('100', { taskId: '55' }, '1'),
      service.execute('100', { taskId: '55' }, '1'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(parseExecutionInProgressConflict(rejected[0].reason)).not.toBeNull();
    expect(db).toHaveLength(1);
  });
});

