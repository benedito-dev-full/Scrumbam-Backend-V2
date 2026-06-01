import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, Logger } from '@nestjs/common';
import { TasksService } from '../tasks.service';
import { TasksIdentifierService } from '../tasks-identifier.service';
import { PhaseHierarchyService } from '../services/phase-hierarchy.service';
import { PhaseMetricsService } from '../services/phase-metrics.service';
import { TaskTimerService } from '../services/task-timer.service';
import { PrismaService } from '../../prisma.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../common/services/correlation-id.service';
import { TimezoneService } from '../../common/services/timezone.service';

/**
 * Specs ADR-V2-050 — Criação de FASE via POST /tasks (idClasse=-200).
 *
 * Cobre o ramo `isPhase` introduzido em `TasksService.create()`:
 * - pula identifier DEV-N (sequence intacta)
 * - pula lookup de status INBOX
 * - pula resolvePriorityId
 * - ignora silenciosamente assignee/sprint/priority/taskType (logger.warn)
 * - persiste `dados = { kind: 'phase', createdBy }`
 * - valida sub-fase (pai deve ser PHASE) — 400 se TASK
 * - emite `phase.created` em adição ao `task.created`
 * - backward compat: omitir idClasse mantém comportamento legado
 *
 * Isolado em arquivo próprio para deixar o spec principal
 * (`tasks.service.spec.ts`) intocado e facilitar leitura do delta.
 *
 * @see ADR-V2-050 docs/decisions/ADR-V2-050-post-tasks-aceita-idclasse-phase.md
 * @see plano workspace/plans/plan-tasks-criar-fase-via-http-task2.md
 */

function makePhaseRow(
  overrides: Partial<{
    chave: bigint;
    idClasse: bigint;
    nome: string;
    descricao: string | null;
    idProject: bigint | null;
    idPai: bigint | null;
    idStatus: bigint | null;
    idPriority: bigint | null;
    idAssignee: bigint | null;
    idSprint: bigint | null;
    dados: Record<string, unknown> | null;
    excluido: boolean;
    criadoEm: Date;
    atualizadoEm: Date;
  }> = {},
) {
  return {
    chave: BigInt(50),
    idClasse: BigInt(-200),
    nome: 'Fase X',
    descricao: null,
    idProject: BigInt(1),
    idPai: null,
    idStatus: null,
    idPriority: null,
    idAssignee: null,
    idSprint: null,
    dados: { kind: 'phase', createdBy: '100' },
    excluido: false,
    criadoEm: new Date('2026-05-22T00:00:00Z'),
    atualizadoEm: new Date('2026-05-22T00:00:00Z'),
    ...overrides,
  };
}

describe('TasksService.create() — ramo PHASE (ADR-V2-050)', () => {
  let service: TasksService;
  let prisma: {
    dProject: { findFirst: jest.Mock };
    dTask: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    dTabela: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
    dEntidade: { findFirst: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let identifierService: { getNextIdentifier: jest.Mock };
  let eventProducer: { addInternalEvent: jest.Mock };
  let phaseHierarchy: {
    maxDepth: number;
    validateNoCycle: jest.Mock;
    validateProjectConsistency: jest.Mock;
    softDeleteCascade: jest.Mock;
  };

  beforeEach(async () => {
    const prismaMock = {
      dProject: { findFirst: jest.fn() },
      dTask: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      dTabela: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      dEntidade: {
        findFirst: jest.fn().mockResolvedValue({ nome: 'Tester' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(),
    };

    const identifierMock = { getNextIdentifier: jest.fn() };
    const eventProducerMock = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
    const correlationIdMock = { getOrGenerate: jest.fn().mockReturnValue('test-corr-id') };
    const phaseHierarchyMock = {
      maxDepth: 20,
      validateNoCycle: jest.fn().mockResolvedValue(undefined),
      validateProjectConsistency: jest.fn().mockResolvedValue(undefined),
      softDeleteCascade: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const phaseMetricsMock = {
      compute: jest.fn().mockResolvedValue({
        phaseId: '0',
        total: 0,
        done: 0,
        failed: 0,
        inProgress: 0,
        pending: 0,
        percent: 0,
        recursive: true,
        computedAt: new Date().toISOString(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        TaskTimerService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TasksIdentifierService, useValue: identifierMock },
        { provide: EventProducerService, useValue: eventProducerMock },
        { provide: CorrelationIdService, useValue: correlationIdMock },
        { provide: PhaseHierarchyService, useValue: phaseHierarchyMock },
        { provide: PhaseMetricsService, useValue: phaseMetricsMock },
        {
          provide: TimezoneService,
          useValue: {
            getPeriodDates: jest.fn().mockReturnValue({ gte: new Date(), lte: new Date() }),
            toStartOfDayBrazil: jest.fn().mockImplementation((d: Date) => d),
            toEndOfDayBrazil: jest.fn().mockImplementation((d: Date) => d),
            applyDateFilters: jest.fn().mockReturnValue({ gte: new Date(), lte: new Date() }),
          },
        },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    prisma = module.get(PrismaService) as typeof prisma;
    identifierService = module.get(TasksIdentifierService) as typeof identifierService;
    eventProducer = module.get(EventProducerService) as typeof eventProducer;
    phaseHierarchy = module.get(PhaseHierarchyService) as typeof phaseHierarchy;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────
  // Setup auxiliar: encapsula o pattern $transaction(cb) → captura `data`
  // ───────────────────────────────────────────────────────────────────────
  function mockTransactionReturning(taskRow: ReturnType<typeof makePhaseRow>) {
    const captured: { data: Record<string, unknown> | null } = { data: null };
    prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const txMock = {
        dTask: {
          create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            captured.data = data;
            return Promise.resolve(taskRow);
          }),
        },
        dTabela: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      return cb(txMock);
    });
    return captured;
  }

  // ── Cenário 1: PHASE root cria DTask polimorfico sem identifier ───────────
  it('1. cria fase com idClasse=-200, idStatus=null, sem identifier (sequence intacta)', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ dados: { prefix: 'DEV' } });
    const captured = mockTransactionReturning(makePhaseRow());

    const result = await service.create(
      { nome: 'Fase X', projectId: '1', idClasse: '-200' },
      BigInt(100),
    );

    // identifierService NÃO chamado — sequence DEV-N intacta
    expect(identifierService.getNextIdentifier).not.toHaveBeenCalled();

    // Persistência: idClasse=-200, idStatus=null, idPriority=null,
    // idAssignee=null, idSprint=null, dados.kind='phase'
    expect(captured.data).not.toBeNull();
    expect(captured.data!.idClasse).toEqual(BigInt(-200));
    expect(captured.data!.idStatus).toBeNull();
    expect(captured.data!.idPriority).toBeNull();
    expect(captured.data!.idAssignee).toBeNull();
    expect(captured.data!.idSprint).toBeNull();
    expect(captured.data!.idPai).toBeNull();
    const dadosPersistido = captured.data!.dados as Record<string, unknown>;
    expect(dadosPersistido.kind).toBe('phase');
    expect(dadosPersistido.createdBy).toBe('100');

    // Response: idClasse exposto ao frontend, identifier vazio
    expect(result.idClasse).toBe('-200');
    expect(result.identifier).toBe('');
  });

  // ── Cenário 2: backward compat — omitir idClasse mantém ramo TASK ──────
  it('2. sem idClasse no DTO → comportamento legado (-154) preservado', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ dados: { prefix: 'DEV' } });
    identifierService.getNextIdentifier.mockResolvedValue('DEV-1');

    const taskRow = makePhaseRow({
      idClasse: BigInt(-154),
      idStatus: BigInt(900), // INBOX retornado pelo lookup
      dados: { identifier: 'DEV-1', v3: { state: 'INBOX' } },
    });
    const captured: { data: Record<string, unknown> | null } = { data: null };
    prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const txMock = {
        dTask: {
          create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            captured.data = data;
            return Promise.resolve(taskRow);
          }),
        },
        // INBOX lookup retorna chave 900
        dTabela: { findFirst: jest.fn().mockResolvedValue({ chave: BigInt(900) }) },
      };
      return cb(txMock);
    });

    const result = await service.create({ nome: 'Task normal', projectId: '1' }, BigInt(100));

    expect(identifierService.getNextIdentifier).toHaveBeenCalled();
    expect(captured.data!.idClasse).toEqual(BigInt(-154));
    expect(captured.data!.idStatus).toEqual(BigInt(900));
    expect(result.idClasse).toBe('-154');
    expect(result.identifier).toBe('DEV-1');
  });

  // ── Cenário 3: sub-fase com pai TASK → 400 BadRequest ───────────────────
  it('3. cria PHASE com idPai apontando para TASK → BadRequestException', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ dados: { prefix: 'DEV' } });
    // Pai existe, mesmo projeto, MAS é TASK (-154) — não PHASE
    prisma.dTask.findFirst.mockResolvedValue({
      idProject: BigInt(1),
      idClasse: BigInt(-154),
    });

    await expect(
      service.create(
        { nome: 'Sub-fase', projectId: '1', idClasse: '-200', idPai: '42' },
        BigInt(100),
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.create(
        { nome: 'Sub-fase', projectId: '1', idClasse: '-200', idPai: '42' },
        BigInt(100),
      ),
    ).rejects.toThrow(/Sub-fase requer pai com idClasse=-200/);

    // Nada chega a $transaction (rejeitado antes)
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ── Cenário 4: sub-fase com pai PHASE → criada com sucesso ─────────────
  it('4. cria PHASE com idPai apontando para PHASE → sub-fase válida', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ dados: { prefix: 'DEV' } });
    prisma.dTask.findFirst.mockResolvedValue({
      idProject: BigInt(1),
      idClasse: BigInt(-200), // pai é PHASE — OK
    });
    const captured = mockTransactionReturning(
      makePhaseRow({ chave: BigInt(60), idPai: BigInt(42) }),
    );

    const result = await service.create(
      { nome: 'Sub-fase', projectId: '1', idClasse: '-200', idPai: '42' },
      BigInt(100),
    );

    expect(phaseHierarchy.validateNoCycle).toHaveBeenCalledWith(BigInt(0), BigInt(42));
    expect(captured.data!.idPai).toEqual(BigInt(42));
    expect(result.idClasse).toBe('-200');
  });

  // ── Cenário 5: campos ignorados → logger.warn + persiste null ──────────
  it('5. PHASE com assigneeId/sprintId/priority/taskType → ignora e loga warn', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ dados: { prefix: 'DEV' } });
    const captured = mockTransactionReturning(makePhaseRow());

    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    await service.create(
      {
        nome: 'Fase com lixo',
        projectId: '1',
        idClasse: '-200',
        assigneeId: '999',
        sprintId: '888',
        priority: 'HIGH',
        taskType: 'BUG',
      },
      BigInt(100),
    );

    // Todos os campos enviados foram IGNORADOS (persistidos como null)
    expect(captured.data!.idAssignee).toBeNull();
    expect(captured.data!.idSprint).toBeNull();
    expect(captured.data!.idPriority).toBeNull();
    const dados = captured.data!.dados as Record<string, unknown>;
    expect(dados.taskType).toBeUndefined();

    // resolvePriorityId NUNCA chamado (pula totalmente)
    expect(prisma.dTabela.findFirst).not.toHaveBeenCalled();

    // logger.warn registrou o telemetry
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('create_phase_ignored_fields'));

    warnSpy.mockRestore();
  });

  // ── Cenário 6: emite phase.created (+ task.created) após commit ────────
  it('6. emite phase.created E task.created após persistência', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ dados: { prefix: 'DEV' } });
    mockTransactionReturning(makePhaseRow({ chave: BigInt(50) }));

    await service.create({ nome: 'Fase Y', projectId: '1', idClasse: '-200' }, BigInt(100));

    const events = eventProducer.addInternalEvent.mock.calls.map((c) => c[0]);
    expect(events).toContain('task.created');
    expect(events).toContain('phase.created');

    const phaseCall = eventProducer.addInternalEvent.mock.calls.find(
      (c) => c[0] === 'phase.created',
    );
    expect(phaseCall?.[1]).toMatchObject({
      phaseId: '50',
      nome: 'Fase Y',
      projectId: '1',
      idPai: null,
      // identifier null em fase (sem DEV-N) — não asserto presença para
      // não acoplar a estrutura interna do payload.
    });
  });

  // ── Cenário 7: cross-project parent → BadRequest (guarda existente) ────
  it('7. PHASE com pai cross-project → BadRequestException (guarda compartilhada)', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ dados: { prefix: 'DEV' } });
    // Pai está em projeto 999, criamos no projeto 1
    prisma.dTask.findFirst.mockResolvedValue({
      idProject: BigInt(999),
      idClasse: BigInt(-200),
    });

    await expect(
      service.create(
        { nome: 'Sub-fase', projectId: '1', idClasse: '-200', idPai: '42' },
        BigInt(100),
      ),
    ).rejects.toThrow(/Cross-project parent/);
  });

  // ── Cenário 8: MAX_PHASE_DEPTH excedido → BadRequest via phaseHierarchy ─
  it('8. PHASE com profundidade excedida → BadRequestException de validateNoCycle', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ dados: { prefix: 'DEV' } });
    prisma.dTask.findFirst.mockResolvedValue({
      idProject: BigInt(1),
      idClasse: BigInt(-200),
    });
    phaseHierarchy.validateNoCycle.mockRejectedValue(
      new BadRequestException('Profundidade maxima (20) excedida na hierarquia de fases'),
    );

    await expect(
      service.create(
        { nome: 'Fase profunda', projectId: '1', idClasse: '-200', idPai: '42' },
        BigInt(100),
      ),
    ).rejects.toThrow(/Profundidade maxima/);
  });

  // ── Cenário 9: scope tenant — projectId fora do scope → 404 anti-enum ──
  it('9. PHASE com projectId fora do accessibleProjectIds → NotFoundException', async () => {
    await expect(
      service.create(
        { nome: 'Fase X', projectId: '999', idClasse: '-200' },
        BigInt(100),
        ['1', '2'], // 999 não está aqui
      ),
    ).rejects.toThrow(/Projeto 999 não encontrado/);

    expect(prisma.dProject.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ── Cenário 10: TASK filha de PHASE (não-recíproco) → permitida ────────
  it('10. TASK (-154) com idPai apontando para PHASE → permitida (não-recíproco)', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ dados: { prefix: 'DEV' } });
    prisma.dTask.findFirst.mockResolvedValue({
      idProject: BigInt(1),
      idClasse: BigInt(-200), // pai PHASE
    });
    identifierService.getNextIdentifier.mockResolvedValue('DEV-5');

    const captured: { data: Record<string, unknown> | null } = { data: null };
    prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const txMock = {
        dTask: {
          create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            captured.data = data;
            return Promise.resolve(
              makePhaseRow({
                chave: BigInt(70),
                idClasse: BigInt(-154),
                idPai: BigInt(42),
                dados: { identifier: 'DEV-5', v3: { state: 'INBOX' } },
              }),
            );
          }),
        },
        dTabela: { findFirst: jest.fn().mockResolvedValue({ chave: BigInt(900) }) },
      };
      return cb(txMock);
    });

    // SEM idClasse no DTO → default '-154' (TASK)
    const result = await service.create(
      { nome: 'Task dentro de fase', projectId: '1', idPai: '42' },
      BigInt(100),
    );

    expect(captured.data!.idClasse).toEqual(BigInt(-154));
    expect(captured.data!.idPai).toEqual(BigInt(42));
    expect(result.idClasse).toBe('-154');
    expect(result.identifier).toBe('DEV-5');
  });
});
