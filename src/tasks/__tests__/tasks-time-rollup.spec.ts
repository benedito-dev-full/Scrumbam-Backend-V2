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
 * Specs Frente 2 (Task 1) — Rollup de tempo on-read das filhas DIRETAS.
 *
 * Uma task MÃE (≥1 filha direta) exibe a SOMA do tempo manual das filhas
 * diretas em `timeSpentLabel` (own-time suprimido) + `hasChildren=true` +
 * `timeSpentIsRollup=true`. Folha mantém own-time + `hasChildren=false`.
 *
 * Regras travadas pelo usuário:
 *  - 100% LEITURA: o timer próprio (start/close) NUNCA recebe guard novo;
 *    folha inicia timer normalmente (caso 7);
 *  - 1 nível, NÃO recursivo (caso 12);
 *  - ZERO N+1: 1 query agregada `idPai IN (lote)` (caso 13).
 *
 * @see workspace/plans/plan-entidades-heranca-timer-filhas-task1.md (§6, §8)
 */

const PROJECT_ID = BigInt(1);
const TWO_HOURS_MS = 2 * 60 * 60 * 1000; // 7_200_000
const FORTY_FIVE_MIN_MS = 45 * 60 * 1000; // 2_700_000
const ONE_HOUR_MS = 60 * 60 * 1000; // 3_600_000

/** Linha DTask com manualTimers fechados somando `durationMs`. */
function taskWithTimer(chave: bigint, idPai: bigint | null, durationMs: number | null) {
  const manualTimers =
    durationMs === null
      ? []
      : [
          {
            userId: '100',
            startedAt: '2026-06-18T00:00:00Z',
            endedAt: '2026-06-18T02:00:00Z',
            durationMs,
          },
        ];
  return {
    chave,
    idClasse: BigInt(-154),
    idProject: PROJECT_ID,
    idPai,
    nome: `Task ${chave.toString()}`,
    descricao: null,
    idStatus: null,
    idPriority: null,
    idAssignee: null,
    dueDate: null,
    dados: { v3: { state: 'INBOX' }, telemetry: { manualTimers } },
    excluido: false,
    criadoEm: new Date('2026-06-18T00:00:00Z'),
    atualizadoEm: new Date('2026-06-18T00:00:00Z'),
  };
}

describe('TasksService — Frente 2: rollup de tempo das filhas diretas', () => {
  let service: TasksService;
  let timerService: TaskTimerService;
  let prisma: {
    dTask: { findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    dTabela: { findMany: jest.Mock; findFirst: jest.Mock };
    dPedido: { findMany: jest.Mock };
    dEntidade: { findMany: jest.Mock; findFirst: jest.Mock };
  };

  beforeEach(async () => {
    const prismaMock = {
      dTask: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      dTabela: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      dPedido: { findMany: jest.fn().mockResolvedValue([]) },
      dEntidade: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
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
            validateNoCycle: jest.fn(),
            validateProjectConsistency: jest.fn(),
          },
        },
        { provide: PhaseMetricsService, useValue: { compute: jest.fn() } },
        {
          provide: ProjectRefService,
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
    timerService = module.get<TaskTimerService>(TaskTimerService);
    prisma = module.get(PrismaService) as typeof prisma;
  });

  afterEach(() => jest.clearAllMocks());

  /**
   * Configura `dTask.findMany` para responder dois usos distintos:
   *  - sem `where.idPai` (page query do findMany) → `pageRows`;
   *  - com `where.idPai.in` (buildChildrenTimeRollupMap) → `childrenByParent`.
   */
  function mockTaskFindMany(
    pageRows: ReturnType<typeof taskWithTimer>[],
    childrenByParent: Record<string, ReturnType<typeof taskWithTimer>[]>,
  ) {
    prisma.dTask.findMany.mockImplementation(
      ({ where }: { where: { idPai?: { in?: bigint[] } } }) => {
        const idPaiIn = where?.idPai?.in;
        if (idPaiIn) {
          const out: ReturnType<typeof taskWithTimer>[] = [];
          for (const pid of idPaiIn) {
            out.push(...(childrenByParent[pid.toString()] ?? []));
          }
          return Promise.resolve(out);
        }
        return Promise.resolve(pageRows);
      },
    );
  }

  // ── Caso 7: ANTI-BUG — folha inicia timer normalmente (sem guard) ─────────
  it('7. folha (sem filhas) inicia timer → start() NÃO lança', async () => {
    const leaf = taskWithTimer(BigInt(10), null, null);
    prisma.dTask.findFirst.mockResolvedValue(leaf);

    await expect(timerService.start('10', BigInt(100), ['1'], 'start')).resolves.toBeDefined();
    // Persistiu a sessão (start abriu o timer) — prova que não há bloqueio.
    expect(prisma.dTask.update).toHaveBeenCalled();
  });

  // ── Caso 8: mãe com 2 filhas (2h + 45min) → "2h 45min", hasChildren ───────
  it('8. mãe com filhas A=2h e B=45min → timeSpentLabel="2h 45min", hasChildren=true', async () => {
    const mother = taskWithTimer(BigInt(7), null, null);
    mockTaskFindMany([mother], {
      '7': [
        taskWithTimer(BigInt(70), BigInt(7), TWO_HOURS_MS),
        taskWithTimer(BigInt(71), BigInt(7), FORTY_FIVE_MIN_MS),
      ],
    });

    const { items } = await service.findMany({}, ['1']);
    const m = items.find((t) => t.id === '7')!;

    expect(m.hasChildren).toBe(true);
    expect(m.timeSpentIsRollup).toBe(true);
    expect(m.timeSpentLabel).toBe('2h 45min');
  });

  // ── Caso 9: mãe com own-time mas filhas com tempo → soma das filhas ───────
  it('9. mãe com own-time é ignorado; mostra SÓ a soma das filhas', async () => {
    // Mãe tem 10h próprios (deveria ser ignorado).
    const mother = taskWithTimer(BigInt(7), null, 10 * ONE_HOUR_MS);
    mockTaskFindMany([mother], {
      '7': [taskWithTimer(BigInt(70), BigInt(7), TWO_HOURS_MS)],
    });

    const { items } = await service.findMany({}, ['1']);
    const m = items.find((t) => t.id === '7')!;

    // own-time (10h) suprimido → mostra 2h da filha.
    expect(m.timeSpentLabel).toBe('2h');
    expect(m.timeSpentIsRollup).toBe(true);
  });

  // ── Caso 10: mãe com filhas SEM timer → hasChildren=true, label "—" ───────
  it('10. mãe com filhas sem timer → hasChildren=true, label "—"', async () => {
    const mother = taskWithTimer(BigInt(7), null, null);
    mockTaskFindMany([mother], {
      '7': [taskWithTimer(BigInt(70), BigInt(7), null), taskWithTimer(BigInt(71), BigInt(7), null)],
    });

    const { items } = await service.findMany({}, ['1']);
    const m = items.find((t) => t.id === '7')!;

    expect(m.hasChildren).toBe(true);
    expect(m.timeSpentLabel).toBe('—');
  });

  // ── Caso 11: folha com own-time → hasChildren=false, own-time exibido ─────
  it('11. folha com tempo próprio → hasChildren=false, label = own-time', async () => {
    const leaf = taskWithTimer(BigInt(10), null, FORTY_FIVE_MIN_MS);
    mockTaskFindMany([leaf], {}); // sem filhas

    const { items } = await service.findMany({}, ['1']);
    const l = items.find((t) => t.id === '10')!;

    expect(l.hasChildren).toBe(false);
    expect(l.timeSpentIsRollup).toBe(false);
    expect(l.timeSpentLabel).toBe('45min');
  });

  // ── Caso 12: rollup NÃO é recursivo — mãe ignora neto ─────────────────────
  it('12. mãe→filha→neto: mãe soma só a filha direta (não inclui o neto)', async () => {
    // findOne da mãe (7). Filha direta = 71 (own-time 1h). Neto = 710 (own-time
    // 5h) é filho de 71, NÃO de 7 → não deve entrar na soma da mãe.
    const mother = taskWithTimer(BigInt(7), null, null);
    prisma.dTask.findFirst.mockResolvedValue(mother);
    // buildChildrenTimeRollupMap([7]) deve retornar SÓ a filha direta 71 (1h).
    prisma.dTask.findMany.mockImplementation(
      ({ where }: { where: { idPai?: { in?: bigint[] } } }) => {
        const idPaiIn = where?.idPai?.in;
        if (idPaiIn?.some((p) => p === BigInt(7))) {
          return Promise.resolve([taskWithTimer(BigInt(71), BigInt(7), ONE_HOUR_MS)]);
        }
        return Promise.resolve([]);
      },
    );

    const m = await service.findOne('7', ['1']);

    // 1h da filha direta; o neto (5h) NÃO entra.
    expect(m.hasChildren).toBe(true);
    expect(m.timeSpentLabel).toBe('1h');
  });

  // ── Caso 13: ZERO N+1 — 1 query agregada para todo o lote ─────────────────
  it('13. findMany com lote misto (mães + folhas) → 1 única query de rollup', async () => {
    const mother = taskWithTimer(BigInt(7), null, null);
    const leaf = taskWithTimer(BigInt(10), null, FORTY_FIVE_MIN_MS);
    mockTaskFindMany([mother, leaf], {
      '7': [taskWithTimer(BigInt(70), BigInt(7), TWO_HOURS_MS)],
    });

    await service.findMany({}, ['1']);

    // dTask.findMany chamado exatamente 2x: (1) page query, (2) rollup batch.
    // NUNCA em loop por task → ZERO N+1.
    const rollupCalls = prisma.dTask.findMany.mock.calls.filter(
      ([arg]: [{ where?: { idPai?: { in?: bigint[] } } }]) => !!arg?.where?.idPai?.in,
    );
    expect(rollupCalls).toHaveLength(1);
    // A única chamada de rollup cobre TODO o lote em 1 `idPai IN [...]`.
    expect(rollupCalls[0][0].where.idPai.in).toEqual([BigInt(7), BigInt(10)]);
  });
});
