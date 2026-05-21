import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PhaseTreeService } from '../services/phase-tree.service';
import { PrismaService } from '../../prisma.service';

/**
 * Unit tests do `PhaseTreeService` — Fase 5 do ADR-V2-047.
 *
 * Mocks: `dTask.findUnique` (pré-query idProject) e `$queryRaw` (template tag).
 * Quando `includeMetrics=true`, `$queryRaw` é chamado 2× — controlamos via
 * `mockResolvedValueOnce` em ordem (tree primeiro, metrics depois).
 *
 * Cobre os 7 casos do plano F5.3:
 * A. árvore simples 3 níveis (fase→fase→task)
 * B. árvore vazia (root sem filhos, depth=0)
 * C. rootId inexistente → NotFoundException
 * D. cross-project descendente excluído (validado via filtro idProject no SQL)
 * E. maxDepth limita profundidade (depth_cap no SQL)
 * F. includeMetrics=true injeta metrics em nós PHASE
 * G. totalNodes e maxDepthReached corretos
 */
describe('PhaseTreeService (Fase 5 — ADR-V2-047)', () => {
  let service: PhaseTreeService;
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
      providers: [PhaseTreeService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(PhaseTreeService);
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

  // ─── Caso A: árvore 3 níveis ──────────────────────────────────────────────

  it('A. monta árvore 3 níveis (fase → fase → task) corretamente', async () => {
    mockRoot();
    // Anchor (depth 0) → sub-fase (depth 1) → task (depth 2)
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: '5', idPai: null, idClasse: '-200', nome: 'Fase Raiz', status: null, depth: 0 },
      { id: '10', idPai: '5', idClasse: '-200', nome: 'Sub-fase', status: null, depth: 1 },
      { id: '20', idPai: '10', idClasse: '-154', nome: 'Task 1', status: 'INBOX', depth: 2 },
    ]);

    const result = await service.buildTree(BigInt(5));

    expect(result.root.id).toBe('5');
    expect(result.root.children).toHaveLength(1);
    expect(result.root.children[0].id).toBe('10');
    expect(result.root.children[0].children).toHaveLength(1);
    expect(result.root.children[0].children[0].id).toBe('20');
    expect(result.root.children[0].children[0].status).toBe('INBOX');
    expect(result.totalNodes).toBe(3);
    expect(result.maxDepthReached).toBe(2);
  });

  // ─── Caso B: árvore vazia ─────────────────────────────────────────────────

  it('B. árvore com root sem filhos — depth=0, children=[]', async () => {
    mockRoot();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: '5', idPai: null, idClasse: '-200', nome: 'Fase', status: null, depth: 0 },
    ]);

    const result = await service.buildTree(BigInt(5));

    expect(result.root.children).toEqual([]);
    expect(result.totalNodes).toBe(1);
    expect(result.maxDepthReached).toBe(0);
  });

  // ─── Caso C: root inexistente ─────────────────────────────────────────────

  it('C. root inexistente → NotFoundException (pré-query)', async () => {
    prisma.dTask.findUnique.mockResolvedValue(null);

    await expect(service.buildTree(BigInt(999))).rejects.toThrow(NotFoundException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('C2. CTE retorna 0 rows → NotFoundException', async () => {
    mockRoot();
    prisma.$queryRaw.mockResolvedValueOnce([]); // CTE vazia

    await expect(service.buildTree(BigInt(5))).rejects.toThrow(NotFoundException);
  });

  // ─── Caso D: defense-in-depth — idProject no SQL ──────────────────────────

  it('D. SQL passa idProject como param para filtrar cross-project', async () => {
    mockRoot(BigInt(99));
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: '5', idPai: null, idClasse: '-200', nome: 'Fase', status: null, depth: 0 },
    ]);

    await service.buildTree(BigInt(5));

    // values do template tag começam no índice 1 do call
    const values = prisma.$queryRaw.mock.calls[0].slice(1);
    expect(values).toContain(BigInt(99));
  });

  // ─── Caso E: maxDepth ─────────────────────────────────────────────────────

  it('E. maxDepth=2 passa depthCap=1 (0-indexado) ao SQL', async () => {
    mockRoot();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: '5', idPai: null, idClasse: '-200', nome: 'Fase', status: null, depth: 0 },
    ]);

    await service.buildTree(BigInt(5), { maxDepth: 2 });

    const values = prisma.$queryRaw.mock.calls[0].slice(1);
    // depthCap = maxDepth - 1 = 1
    expect(values).toContain(1);
  });

  it('E2. maxDepth=undefined usa default 20 → depthCap=19', async () => {
    mockRoot();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: '5', idPai: null, idClasse: '-200', nome: 'Fase', status: null, depth: 0 },
    ]);

    await service.buildTree(BigInt(5));

    const values = prisma.$queryRaw.mock.calls[0].slice(1);
    expect(values).toContain(19);
  });

  it('E3. maxDepth>20 é truncado para 20 (cap defense-in-depth)', async () => {
    mockRoot();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: '5', idPai: null, idClasse: '-200', nome: 'Fase', status: null, depth: 0 },
    ]);

    await service.buildTree(BigInt(5), { maxDepth: 999 });

    const values = prisma.$queryRaw.mock.calls[0].slice(1);
    // Cap = min(999, 20) - 1 = 19
    expect(values).toContain(19);
  });

  // ─── Caso F: includeMetrics ───────────────────────────────────────────────

  it('F. includeMetrics=true anexa metrics em nós PHASE (-200) — 2 queries', async () => {
    mockRoot();
    // 1ª: árvore com 2 fases + 1 task
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: '5', idPai: null, idClasse: '-200', nome: 'Fase Raiz', status: null, depth: 0 },
      { id: '10', idPai: '5', idClasse: '-200', nome: 'Sub-fase', status: null, depth: 1 },
      { id: '20', idPai: '10', idClasse: '-154', nome: 'Task', status: 'INBOX', depth: 2 },
    ]);
    // 2ª: metrics por phase_root
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        phaseId: '5',
        total: BigInt(10),
        done: BigInt(4),
        failed: BigInt(0),
        inProgress: BigInt(1),
      },
      {
        phaseId: '10',
        total: BigInt(3),
        done: BigInt(3),
        failed: BigInt(0),
        inProgress: BigInt(0),
      },
    ]);

    const result = await service.buildTree(BigInt(5), { includeMetrics: true });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(result.root.metrics).toEqual({
      total: 10,
      done: 4,
      failed: 0,
      inProgress: 1,
      percent: 40,
    });
    expect(result.root.children[0].metrics).toEqual({
      total: 3,
      done: 3,
      failed: 0,
      inProgress: 0,
      percent: 100,
    });
    // Task (idClasse=-154) deve ter metrics=null
    expect(result.root.children[0].children[0].metrics).toBeNull();
  });

  it('F2. includeMetrics=true sem dados → fase recebe emptyMetrics (zeros)', async () => {
    mockRoot();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: '5', idPai: null, idClasse: '-200', nome: 'Fase', status: null, depth: 0 },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([]); // sem descendentes

    const result = await service.buildTree(BigInt(5), { includeMetrics: true });

    expect(result.root.metrics).toEqual({
      total: 0,
      done: 0,
      failed: 0,
      inProgress: 0,
      percent: 0,
    });
  });

  it('F3. includeMetrics=false (default) → apenas 1 query, metrics=null', async () => {
    mockRoot();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: '5', idPai: null, idClasse: '-200', nome: 'Fase', status: null, depth: 0 },
    ]);

    const result = await service.buildTree(BigInt(5));

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result.root.metrics).toBeNull();
  });

  // ─── Caso G: totalNodes / maxDepthReached ─────────────────────────────────

  it('G. totalNodes e maxDepthReached refletem rows da CTE', async () => {
    mockRoot();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: '5', idPai: null, idClasse: '-200', nome: 'F1', status: null, depth: 0 },
      { id: '6', idPai: '5', idClasse: '-200', nome: 'F2', status: null, depth: 1 },
      { id: '7', idPai: '5', idClasse: '-154', nome: 'T1', status: 'DONE', depth: 1 },
      { id: '8', idPai: '6', idClasse: '-154', nome: 'T2', status: 'INBOX', depth: 2 },
      { id: '9', idPai: '6', idClasse: '-154', nome: 'T3', status: 'INBOX', depth: 2 },
    ]);

    const result = await service.buildTree(BigInt(5));

    expect(result.totalNodes).toBe(5);
    expect(result.maxDepthReached).toBe(2);
    expect(result.root.children).toHaveLength(2);
    expect(result.root.children.find((c) => c.id === '6')!.children).toHaveLength(2);
    expect(result.root.children.find((c) => c.id === '7')!.children).toEqual([]);
  });

  // ─── Caso H: SQL guardrail + template tag ─────────────────────────────────

  it('H. SQL contém guardrail hardcoded "depth < 20" e WITH RECURSIVE', async () => {
    mockRoot();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: '5', idPai: null, idClasse: '-200', nome: 'Fase', status: null, depth: 0 },
    ]);

    await service.buildTree(BigInt(5));

    const sqlStrings = (prisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join(' ');
    expect(sqlStrings).toContain('WITH RECURSIVE');
    expect(sqlStrings).toMatch(/depth\s*<\s*20/);
  });

  it('H2. service usa template tag ($queryRaw), não $queryRawUnsafe', async () => {
    mockRoot();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: '5', idPai: null, idClasse: '-200', nome: 'Fase', status: null, depth: 0 },
    ]);

    await service.buildTree(BigInt(5));

    const firstArg = prisma.$queryRaw.mock.calls[0][0];
    expect(Array.isArray(firstArg)).toBe(true);
    expect((firstArg as TemplateStringsArray).raw).toBeDefined();
  });

  // ─── Caso I: orphan descendant ───────────────────────────────────────────

  it('I. descendente com idPai não-presente no Map é silenciosamente descartado', async () => {
    // Em produção a CTE garante consistência, mas se uma row órfã aparecer
    // (idPai não presente nas rows), não devemos quebrar — só ignorar.
    mockRoot();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: '5', idPai: null, idClasse: '-200', nome: 'Fase', status: null, depth: 0 },
      { id: '20', idPai: '999', idClasse: '-154', nome: 'Orfã', status: null, depth: 1 },
    ]);

    const result = await service.buildTree(BigInt(5));

    expect(result.root.children).toEqual([]); // órfã não anexada
    expect(result.totalNodes).toBe(2);
  });
});
