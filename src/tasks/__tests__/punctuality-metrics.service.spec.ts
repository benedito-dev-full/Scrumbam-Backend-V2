import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PunctualityMetricsService } from '../services/punctuality-metrics.service';
import { PrismaService } from '../../prisma.service';

/**
 * Unit tests do `PunctualityMetricsService` — Task 8 (Pontualidade / Margem de atraso).
 *
 * A média em si é calculada no PostgreSQL (`AVG`), portanto os testes NÃO
 * recomputam a agregação em JS — mockam a linha retornada por `$queryRaw` e
 * validam:
 *  - mapeamento correto row → DTO (null vs 0, sinal, conversão numérica);
 *  - que a query carrega os filtros/guards de negócio (dueDate NOT NULL,
 *    doneAt presente+parseável, status terminal -444/-449) — garantindo que
 *    tasks sem dueDate são excluídas pela própria query;
 *  - que `computeForProject` restringe por `idProject` e `computeForUser`
 *    por `idAssignee` (+ scope opcional).
 *
 * Casos do plano (Fase 1, passo 4):
 *  1. projeto sem tasks concluídas → { averageDelayDays: null, sampleSize: 0 }
 *  2. mix atraso/adiantamento → repassa o AVG (sinal preservado)
 *  3. tasks sem dueDate excluídas → asseverado via cláusulas da query
 */
describe('PunctualityMetricsService (Task 8 — Pontualidade)', () => {
  let service: PunctualityMetricsService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PunctualityMetricsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(PunctualityMetricsService);
  });

  afterEach(() => jest.clearAllMocks());

  /** Extrai o texto SQL do `Prisma.Sql` passado ao `$queryRaw` (chamada por função). */
  const sqlTextOf = (mock: jest.Mock): string => {
    const arg = mock.mock.calls[0][0] as Prisma.Sql;
    // Prisma.Sql expõe `.strings` (fragmentos literais) — concatenar dá o texto.
    return (arg.strings ?? []).join(' ');
  };

  // ─── Caso 1: projeto sem amostras ─────────────────────────────────────────

  it('1. projeto sem tasks concluídas com dueDate → averageDelayDays null, sampleSize 0', async () => {
    // AVG sobre zero linhas → null; COUNT → 0n.
    prisma.$queryRaw.mockResolvedValueOnce([{ averageDelayDays: null, sampleSize: BigInt(0) }]);

    const result = await service.computeForProject(BigInt(5));

    expect(result.averageDelayDays).toBeNull();
    expect(result.sampleSize).toBe(0);
    expect(typeof result.computedAt).toBe('string');
  });

  it('1b. array vazio do driver (defensivo) → também null/0', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const result = await service.computeForProject(BigInt(5));

    expect(result.averageDelayDays).toBeNull();
    expect(result.sampleSize).toBe(0);
  });

  // ─── Caso 2: mix de atraso e adiantamento (sinal preservado) ──────────────

  it('2. mix atraso/adiantamento → repassa a média com o sinal correto (positivo=atraso)', async () => {
    // Ex.: tasks com +5, +3, -2 dias → AVG = 2. Driver entrega numeric como string.
    prisma.$queryRaw.mockResolvedValueOnce([{ averageDelayDays: '2', sampleSize: BigInt(3) }]);

    const result = await service.computeForProject(BigInt(5));

    expect(result.averageDelayDays).toBe(2);
    expect(result.sampleSize).toBe(3);
  });

  it('2b. média negativa (projeto adianta em média) NÃO é clampada a zero', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ averageDelayDays: '-1.5', sampleSize: BigInt(4) }]);

    const result = await service.computeForProject(BigInt(5));

    expect(result.averageDelayDays).toBe(-1.5);
    expect(result.sampleSize).toBe(4);
  });

  // ─── Caso 3: exclusões de negócio embutidas na query ──────────────────────

  it('3. a query exclui tasks sem dueDate, sem doneAt e fora do status terminal', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ averageDelayDays: '0', sampleSize: BigInt(1) }]);

    await service.computeForProject(BigInt(5));

    const sql = sqlTextOf(prisma.$queryRaw);
    // dueDate obrigatório (task sem prazo NÃO entra).
    expect(sql).toContain('"dueDate" IS NOT NULL');
    // doneAt (completedAt) obrigatório.
    expect(sql).toContain("'doneAt') IS NOT NULL");
    // Guard anti-500 no cast de timestamp malformado.
    expect(sql).toContain('doneAt');
    // Status terminal DONE(-444)/VALIDATED(-449) via JOIN DTabela.idClasse.
    expect(sql).toContain('"idClasse" IN (');
    // Soft-delete respeitado.
    expect(sql).toContain('t.excluido = false');
  });

  it('3b. computeForProject filtra por idProject (parâmetro vinculado)', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ averageDelayDays: '0', sampleSize: BigInt(1) }]);

    await service.computeForProject(BigInt(42));

    const arg = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    // O valor do projeto entra como bind param → aparece em `.values`.
    expect(arg.values).toContain(BigInt(42));
    expect((arg.strings ?? []).join(' ')).toContain('"idProject"');
  });

  // ─── computeForUser (reservado, sem rota) ─────────────────────────────────

  it('4. computeForUser filtra por idAssignee', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ averageDelayDays: '1', sampleSize: BigInt(2) }]);

    const result = await service.computeForUser(BigInt(100));

    const arg = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(arg.values).toContain(BigInt(100));
    expect((arg.strings ?? []).join(' ')).toContain('"idAssignee"');
    expect(result.averageDelayDays).toBe(1);
  });

  it('4b. computeForUser com scope vazio → null/0 sem tocar o banco', async () => {
    const result = await service.computeForUser(BigInt(100), []);

    expect(result.averageDelayDays).toBeNull();
    expect(result.sampleSize).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('4c. computeForUser com scope restringe por idProject IN', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ averageDelayDays: '0', sampleSize: BigInt(1) }]);

    await service.computeForUser(BigInt(100), [BigInt(7), BigInt(8)]);

    const arg = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(arg.values).toContain(BigInt(7));
    expect(arg.values).toContain(BigInt(8));
  });
});
