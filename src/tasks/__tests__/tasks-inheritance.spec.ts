import { Test, TestingModule } from '@nestjs/testing';
import { TasksService } from '../tasks.service';
import { TasksIdentifierService } from '../tasks-identifier.service';
import { PhaseHierarchyService } from '../services/phase-hierarchy.service';
import { PhaseMetricsService } from '../services/phase-metrics.service';
import { TaskTimerService } from '../services/task-timer.service';
import { ProjectRefService } from '../../projects/project-ref.service';
import { PrismaService } from '../../prisma.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../common/services/correlation-id.service';
import { TimezoneService } from '../../common/services/timezone.service';

/**
 * Specs Frente 1 (Task 1) — Herança de campos do pai no `TasksService.create()`.
 *
 * Quando `create()` recebe `idPai`, copia do pai 4 campos (`idAssignee`,
 * `dueDate`, `idPriority`, `idStatus`) sempre que o DTO NÃO trouxer o valor
 * (DTO-vence-pai). Tabela de decisão de `idStatus` na §7 do plano:
 *  - task SEM pai → INBOX (-441) (anti-regressão crítica);
 *  - task COM pai E `pai.idStatus != null` → herda o status do pai;
 *  - pai PHASE (idStatus null) → cai no INBOX padrão.
 *
 * Isolado em arquivo próprio (plano §4) para não tocar o spec principal.
 *
 * @see workspace/plans/plan-entidades-heranca-timer-filhas-task1.md (§6, §7)
 */

const PROJECT_ID = BigInt(1);
const INBOX_CHAVE = BigInt(900);

/** Linha DTask retornada pelo `tx.dTask.create` (default ramo TASK). */
function makeTaskRow(
  overrides: Partial<{
    chave: bigint;
    idClasse: bigint;
    nome: string;
    idProject: bigint | null;
    idPai: bigint | null;
    idStatus: bigint | null;
    idPriority: bigint | null;
    idAssignee: bigint | null;
    dueDate: Date | null;
    dados: Record<string, unknown> | null;
    criadoEm: Date;
    atualizadoEm: Date;
  }> = {},
) {
  return {
    chave: BigInt(50),
    idClasse: BigInt(-154),
    nome: 'Filha',
    descricao: null,
    idProject: PROJECT_ID,
    idPai: BigInt(42),
    idStatus: INBOX_CHAVE,
    idPriority: null,
    idAssignee: null,
    dueDate: null,
    dados: { identifier: 'DEV-2', v3: { state: 'INBOX' } },
    excluido: false,
    criadoEm: new Date('2026-06-18T00:00:00Z'),
    atualizadoEm: new Date('2026-06-18T00:00:00Z'),
    ...overrides,
  };
}

describe('TasksService.create() — Frente 1: herança de campos do pai', () => {
  let service: TasksService;
  let prisma: {
    dProject: { findFirst: jest.Mock };
    dTask: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    dTabela: { findFirst: jest.Mock; findMany: jest.Mock };
    dEntidade: { findFirst: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let identifierService: { getNextIdentifier: jest.Mock };

  beforeEach(async () => {
    const prismaMock = {
      dProject: { findFirst: jest.fn() },
      dTask: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      dTabela: { findFirst: jest.fn(), findMany: jest.fn() },
      dEntidade: {
        findFirst: jest.fn().mockResolvedValue({ nome: 'Tester' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        TaskTimerService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TasksIdentifierService, useValue: { getNextIdentifier: jest.fn() } },
        {
          provide: EventProducerService,
          useValue: { addInternalEvent: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: CorrelationIdService, useValue: { getOrGenerate: jest.fn(() => 'corr') } },
        {
          provide: PhaseHierarchyService,
          useValue: {
            maxDepth: 20,
            validateNoCycle: jest.fn().mockResolvedValue(undefined),
            validateProjectConsistency: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: PhaseMetricsService,
          useValue: { compute: jest.fn().mockResolvedValue({ percent: 0 }) },
        },
        {
          provide: ProjectRefService,
          // P→P passthrough nos testes (legacy-safe).
          useValue: { resolveEntidadeRef: jest.fn((id: bigint) => Promise.resolve(id)) },
        },
        {
          provide: TimezoneService,
          useValue: {
            getPeriodDates: jest.fn().mockReturnValue({ gte: new Date(), lte: new Date() }),
            applyDateFilters: jest.fn().mockReturnValue({ gte: new Date(), lte: new Date() }),
          },
        },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    prisma = module.get(PrismaService) as typeof prisma;
    identifierService = module.get(TasksIdentifierService) as typeof identifierService;
  });

  afterEach(() => jest.clearAllMocks());

  /**
   * Configura a transaction capturando o `data` passado ao `tx.dTask.create`.
   * O `tx.dTabela.findFirst` resolve o INBOX (chave 900) por padrão.
   */
  function mockTransactionReturning(
    taskRow: ReturnType<typeof makeTaskRow>,
    inboxChave: bigint | null = INBOX_CHAVE,
    priorityChave: bigint | null = null,
  ) {
    const captured: { data: Record<string, unknown> | null } = { data: null };
    identifierService.getNextIdentifier.mockResolvedValue('DEV-2');
    prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const txMock = {
        dTask: {
          create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            captured.data = data;
            return Promise.resolve(taskRow);
          }),
        },
        dTabela: {
          // O `tx.dTabela.findFirst` é chamado para o INBOX (idClasse=-441) e para
          // a priority do DTO (idClasse=-42X). Resolver por idClasse para não
          // confundir os dois lookups.
          findFirst: jest.fn().mockImplementation(({ where }: { where: { idClasse: bigint } }) => {
            if (where.idClasse === BigInt(-441)) {
              return Promise.resolve(inboxChave !== null ? { chave: inboxChave } : null);
            }
            return Promise.resolve(priorityChave !== null ? { chave: priorityChave } : null);
          }),
        },
      };
      return cb(txMock);
    });
    return captured;
  }

  // ── Caso 1: herda os 4 campos quando o DTO não os traz ────────────────────
  it('1. com idPai e DTO sem os 4 campos → filha herda assignee, dueDate, priority, status', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ dados: { prefix: 'DEV' } });
    // Pai existe, mesmo projeto, TASK, com os 4 campos preenchidos.
    prisma.dTask.findFirst.mockResolvedValue({
      idProject: PROJECT_ID,
      idClasse: BigInt(-154),
      idAssignee: BigInt(777),
      idStatus: BigInt(443), // EXECUTING-ish (não-null) → deve herdar
      idPriority: BigInt(421),
      dueDate: new Date('2026-07-01T00:00:00Z'),
    });
    const captured = mockTransactionReturning(makeTaskRow());

    await service.create({ nome: 'Filha', projectId: '1', idPai: '42' }, BigInt(100));

    expect(captured.data!.idAssignee).toEqual(BigInt(777));
    expect(captured.data!.idStatus).toEqual(BigInt(443)); // herdou do pai (não INBOX)
    expect(captured.data!.idPriority).toEqual(BigInt(421));
    expect(captured.data!.dueDate).toEqual(new Date('2026-07-01T00:00:00Z'));
  });

  // ── Caso 2: DTO explícito vence o pai ─────────────────────────────────────
  it('2. DTO trazendo assigneeId/priority/dueDate → DTO vence (não sobrescreve com o pai)', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ dados: { prefix: 'DEV' } });
    prisma.dTask.findFirst.mockResolvedValue({
      idProject: PROJECT_ID,
      idClasse: BigInt(-154),
      idAssignee: BigInt(777),
      idStatus: BigInt(443),
      idPriority: BigInt(421), // HIGH no pai
      dueDate: new Date('2026-07-01T00:00:00Z'),
    });
    // Priority do DTO resolve para chave 422 (MEDIUM) via tx.dTabela.findFirst.
    const captured = mockTransactionReturning(makeTaskRow(), INBOX_CHAVE, BigInt(422));

    await service.create(
      {
        nome: 'Filha',
        projectId: '1',
        idPai: '42',
        assigneeId: '555',
        priority: 'MEDIUM',
        dueDate: '2026-08-15T00:00:00.000Z',
      },
      BigInt(100),
    );

    expect(captured.data!.idAssignee).toEqual(BigInt(555)); // DTO, não 777
    expect(captured.data!.idPriority).toEqual(BigInt(422)); // DTO MEDIUM, não 421
    expect(captured.data!.dueDate).toEqual(new Date('2026-08-15T00:00:00.000Z')); // DTO
    // idStatus herda do pai (DTO não traz status no create) → 443
    expect(captured.data!.idStatus).toEqual(BigInt(443));
  });

  // ── Caso 3: pai com campos null → filha nasce com null (sem erro) ──────────
  it('3. pai com campos null → filha herda null e cai no INBOX para status', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ dados: { prefix: 'DEV' } });
    prisma.dTask.findFirst.mockResolvedValue({
      idProject: PROJECT_ID,
      idClasse: BigInt(-154),
      idAssignee: null,
      idStatus: null,
      idPriority: null,
      dueDate: null,
    });
    const captured = mockTransactionReturning(makeTaskRow());

    await service.create({ nome: 'Filha', projectId: '1', idPai: '42' }, BigInt(100));

    expect(captured.data!.idAssignee).toBeNull();
    expect(captured.data!.idPriority).toBeNull();
    // dueDate sem DTO e pai null → undefined (coluna não tocada).
    expect(captured.data!.dueDate).toBeUndefined();
    // pai.idStatus null → cai no INBOX (900).
    expect(captured.data!.idStatus).toEqual(INBOX_CHAVE);
  });

  // ── Caso 4: ANTI-REGRESSÃO — sem idPai → INBOX preservado ─────────────────
  it('4. SEM idPai → status = INBOX (-441) e comportamento legado intacto', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ dados: { prefix: 'DEV' } });
    const captured = mockTransactionReturning(makeTaskRow({ idPai: null }));

    await service.create({ nome: 'Task raiz', projectId: '1' }, BigInt(100));

    // Pai nunca consultado.
    expect(prisma.dTask.findFirst).not.toHaveBeenCalled();
    expect(captured.data!.idPai).toBeNull();
    expect(captured.data!.idStatus).toEqual(INBOX_CHAVE);
    expect(captured.data!.idPriority).toBeNull();
    expect(captured.data!.idAssignee).toBeNull();
  });

  // ── Caso 5: filha de PHASE (idStatus null) → INBOX padrão ─────────────────
  it('5. filha TASK de PHASE (pai idStatus null) → status herdado null → INBOX', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ dados: { prefix: 'DEV' } });
    // Pai é PHASE: idStatus null por design (ADR-V2-050).
    prisma.dTask.findFirst.mockResolvedValue({
      idProject: PROJECT_ID,
      idClasse: BigInt(-200),
      idAssignee: null,
      idStatus: null,
      idPriority: null,
      dueDate: null,
    });
    const captured = mockTransactionReturning(makeTaskRow());

    await service.create({ nome: 'Filha de bloco', projectId: '1', idPai: '42' }, BigInt(100));

    expect(captured.data!.idStatus).toEqual(INBOX_CHAVE);
  });

  // ── Caso 6: pai EXECUTING → filha herda EXECUTING (não força INBOX) ───────
  it('6. pai TASK em EXECUTING → filha herda o idStatus do pai, sem forçar INBOX', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ dados: { prefix: 'DEV' } });
    const EXECUTING_CHAVE = BigInt(443);
    prisma.dTask.findFirst.mockResolvedValue({
      idProject: PROJECT_ID,
      idClasse: BigInt(-154),
      idAssignee: null,
      idStatus: EXECUTING_CHAVE,
      idPriority: null,
      dueDate: null,
    });
    const captured = mockTransactionReturning(makeTaskRow({ idStatus: EXECUTING_CHAVE }));

    await service.create({ nome: 'Filha em andamento', projectId: '1', idPai: '42' }, BigInt(100));

    expect(captured.data!.idStatus).toEqual(EXECUTING_CHAVE);
    expect(captured.data!.idStatus).not.toEqual(INBOX_CHAVE);
  });
});
