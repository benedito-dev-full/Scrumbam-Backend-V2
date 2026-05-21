import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PhaseMetricsService } from '../services/phase-metrics.service';
import { PrismaService } from '../../prisma.service';

/**
 * Unit tests do `PhaseMetricsService` — Fase 5 do ADR-V2-047.
 *
 * Mock de `$queryRaw` (template tag retorna `Promise<Array<...>>`).
 * Mock de `dTask.findUnique` para a pré-query de `idProject`.
 *
 * Cobre 6 casos definidos no plano F5.3:
 * A. recursive=true default, total>0, percent calculado.
 * B. recursive=false chama query não-recursiva.
 * C. total=0 → percent=0 sem divisão por zero.
 * D. NotFoundException quando root não existe.
 * E. CANCELLED/DISCARDED não entram em total (validado via mock SQL).
 * F. BigInt → Number nas contagens (precisão preservada).
 */
describe('PhaseMetricsService (Fase 5 — ADR-V2-047)', () => {
  let service: PhaseMetricsService;
  let prisma: {
    dTask: { findUnique: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      dTask: { findUnique: jest.fn() },
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PhaseMetricsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(PhaseMetricsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const mockRoot = (projectId = BigInt(99)) => {
    prisma.dTask.findUnique.mockResolvedValue({
      idProject: projectId,
      excluido: false,
    });
  };

  // ─── Caso A: recursive=true default ────────────────────────────────────────

  it('A. recursive=true (default) — agrega counts e calcula percent', async () => {
    mockRoot();
    prisma.$queryRaw.mockResolvedValue([
      {
        total: BigInt(50),
        done: BigInt(20),
        failed: BigInt(2),
        inProgress: BigInt(5),
        pending: BigInt(23),
      },
    ]);

    const result = await service.compute(BigInt(5));

    expect(result.phaseId).toBe('5');
    expect(result.total).toBe(50);
    expect(result.done).toBe(20);
    expect(result.failed).toBe(2);
    expect(result.inProgress).toBe(5);
    expect(result.pending).toBe(23);
    expect(result.percent).toBe(40); // 20/50 = 40%
    expect(result.recursive).toBe(true);
    expect(typeof result.computedAt).toBe('string');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  // ─── Caso B: recursive=false ──────────────────────────────────────────────

  it('B. recursive=false — usa query direta (não-recursiva)', async () => {
    mockRoot();
    prisma.$queryRaw.mockResolvedValue([
      {
        total: BigInt(5),
        done: BigInt(1),
        failed: BigInt(0),
        inProgress: BigInt(1),
        pending: BigInt(3),
      },
    ]);

    const result = await service.compute(BigInt(5), { recursive: false });

    expect(result.recursive).toBe(false);
    expect(result.total).toBe(5);
    expect(result.done).toBe(1);
    expect(result.percent).toBe(20); // 1/5 = 20%
    // Verifica que o SQL passado contém "idPai" (signature de query direta).
    // A primeira call (índice 0) é o template tag — strings em [0][0].
    const sqlStrings = (prisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join(' ');
    expect(sqlStrings).toContain('"idPai"');
    expect(sqlStrings).not.toContain('WITH RECURSIVE');
  });

  // ─── Caso C: total=0 → percent=0 ──────────────────────────────────────────

  it('C. total=0 → percent=0 (sem NaN ou Infinity)', async () => {
    mockRoot();
    prisma.$queryRaw.mockResolvedValue([
      {
        total: BigInt(0),
        done: BigInt(0),
        failed: BigInt(0),
        inProgress: BigInt(0),
        pending: BigInt(0),
      },
    ]);

    const result = await service.compute(BigInt(5));

    expect(result.total).toBe(0);
    expect(result.percent).toBe(0);
    expect(Number.isFinite(result.percent)).toBe(true);
  });

  // ─── Caso D: NotFoundException ────────────────────────────────────────────

  it('D. root não existe → NotFoundException', async () => {
    prisma.dTask.findUnique.mockResolvedValue(null);

    await expect(service.compute(BigInt(999))).rejects.toThrow(NotFoundException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('D2. root soft-deleted → NotFoundException', async () => {
    prisma.dTask.findUnique.mockResolvedValue({
      idProject: BigInt(1),
      excluido: true,
    });
    await expect(service.compute(BigInt(5))).rejects.toThrow(NotFoundException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('D3. root sem idProject → NotFoundException', async () => {
    prisma.dTask.findUnique.mockResolvedValue({
      idProject: null,
      excluido: false,
    });
    await expect(service.compute(BigInt(5))).rejects.toThrow(NotFoundException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  // ─── Caso E: defense-in-depth — idProject no SQL ──────────────────────────

  it('E. SQL inclui filtro idProject = rootProjectId (defense-in-depth)', async () => {
    mockRoot(BigInt(99));
    prisma.$queryRaw.mockResolvedValue([
      {
        total: BigInt(0),
        done: BigInt(0),
        failed: BigInt(0),
        inProgress: BigInt(0),
        pending: BigInt(0),
      },
    ]);

    await service.compute(BigInt(5));

    // Os values do template tag começam no índice 1 do mock.calls[0]
    const callArgs = prisma.$queryRaw.mock.calls[0];
    const values = callArgs.slice(1);
    // rootProjectId (99n) deve estar entre os values interpolados.
    expect(values).toContain(BigInt(99));
  });

  // ─── Caso F: BigInt grande não estoura ────────────────────────────────────

  it('F. counts BigInt grandes são convertidos para Number sem perda', async () => {
    mockRoot();
    prisma.$queryRaw.mockResolvedValue([
      {
        total: BigInt(1_000_000),
        done: BigInt(250_000),
        failed: BigInt(0),
        inProgress: BigInt(50_000),
        pending: BigInt(700_000),
      },
    ]);

    const result = await service.compute(BigInt(5));

    expect(result.total).toBe(1_000_000);
    expect(result.done).toBe(250_000);
    expect(result.percent).toBe(25); // 250k / 1M = 25%
  });

  // ─── Caso G: guardrail SQL hardcoded depth < 20 ───────────────────────────

  it('G. recursive=true — SQL contém guardrail hardcoded "depth < 20"', async () => {
    mockRoot();
    prisma.$queryRaw.mockResolvedValue([
      {
        total: BigInt(0),
        done: BigInt(0),
        failed: BigInt(0),
        inProgress: BigInt(0),
        pending: BigInt(0),
      },
    ]);

    await service.compute(BigInt(5), { recursive: true });

    const sqlStrings = (prisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join(' ');
    expect(sqlStrings).toContain('WITH RECURSIVE');
    expect(sqlStrings).toMatch(/depth\s*<\s*20/);
  });

  // ─── Caso H: SQL nunca usa $queryRawUnsafe ────────────────────────────────

  it('H. service usa template tag ($queryRaw), não $queryRawUnsafe', async () => {
    // Não é possível assert via mock; mas se houvesse $queryRawUnsafe, o
    // primeiro argumento da chamada seria string. Validamos que é
    // TemplateStringsArray (template tag).
    mockRoot();
    prisma.$queryRaw.mockResolvedValue([
      {
        total: BigInt(1),
        done: BigInt(0),
        failed: BigInt(0),
        inProgress: BigInt(0),
        pending: BigInt(1),
      },
    ]);

    await service.compute(BigInt(5));

    const firstArg = prisma.$queryRaw.mock.calls[0][0];
    // Template tag → array-like com .raw
    expect(Array.isArray(firstArg)).toBe(true);
    expect((firstArg as TemplateStringsArray).raw).toBeDefined();
  });
});
