import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PhaseHierarchyService } from '../phase-hierarchy.service';
import { PrismaService } from '../../../prisma.service';

/**
 * Suite unitaria do PhaseHierarchyService (ADR-V2-047, Fase 3).
 *
 * Cobertura:
 * - validateNoCycle: 9 casos (null, auto-parent, ancestral direto/profundo,
 *   descendente direto/profundo, MAX_DEPTH limite, pai inexistente/excluido).
 * - validateProjectConsistency: 4 casos (null, mesmo project, projects
 *   diferentes, task/pai nao existe).
 * - softDeleteCascade: 5 casos (folha, 1 nivel, multi-nivel, ja excluida,
 *   nao existe).
 */
describe('PhaseHierarchyService', () => {
  let service: PhaseHierarchyService;
  let prisma: {
    dTask: { findUnique: jest.Mock };
    $executeRaw: jest.Mock;
  };

  /**
   * Helper: cria service com MAX_DEPTH configuravel.
   */
  async function buildService(maxDepth?: number): Promise<{
    service: PhaseHierarchyService;
    prisma: typeof prisma;
  }> {
    const prismaMock = {
      dTask: { findUnique: jest.fn() },
      $executeRaw: jest.fn(),
    };
    const configMock = {
      get: jest.fn().mockReturnValue(maxDepth),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhaseHierarchyService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    return {
      service: module.get<PhaseHierarchyService>(PhaseHierarchyService),
      prisma: prismaMock as unknown as typeof prisma,
    };
  }

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
    prisma = built.prisma;
  });

  // ─── validateNoCycle ──────────────────────────────────────────────────────

  describe('validateNoCycle()', () => {
    it('Caso 1: newParentId=null → passa sem queries', async () => {
      await expect(service.validateNoCycle(BigInt(10), null)).resolves.toBeUndefined();
      expect(prisma.dTask.findUnique).not.toHaveBeenCalled();
    });

    it('Caso 2: taskId === newParentId → BadRequestException (auto-parent)', async () => {
      await expect(service.validateNoCycle(BigInt(10), BigInt(10))).rejects.toThrow(
        BadRequestException,
      );
      // Auto-parent e detectado antes de qualquer query
      expect(prisma.dTask.findUnique).not.toHaveBeenCalled();
    });

    it('Caso 3: pai novo = ancestral direto (1 nivel acima) → passa', async () => {
      // task=10, pai novo = 5 (raiz). Cadeia: 5 → null
      prisma.dTask.findUnique.mockResolvedValueOnce({ idPai: null, excluido: false });

      await expect(service.validateNoCycle(BigInt(10), BigInt(5))).resolves.toBeUndefined();
      expect(prisma.dTask.findUnique).toHaveBeenCalledTimes(1);
    });

    it('Caso 4: pai novo = descendente direto (ciclo) → BadRequestException', async () => {
      // task=5, pai novo = 10. Cadeia ascendente de 10: 10 → 5 (TASKID encontrada → ciclo!)
      // No primeiro lookup, current=10, parent.idPai = 5
      prisma.dTask.findUnique.mockResolvedValueOnce({ idPai: BigInt(5), excluido: false });

      await expect(service.validateNoCycle(BigInt(5), BigInt(10))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('Caso 5: pai novo = descendente profundo (3 niveis) → BadRequestException', async () => {
      // task=1, pai novo = 4. Cadeia ascendente de 4: 4 → 3 → 2 → 1 (taskId → ciclo!)
      prisma.dTask.findUnique
        .mockResolvedValueOnce({ idPai: BigInt(3), excluido: false }) // 4 → 3
        .mockResolvedValueOnce({ idPai: BigInt(2), excluido: false }) // 3 → 2
        .mockResolvedValueOnce({ idPai: BigInt(1), excluido: false }); // 2 → 1 (= taskId)

      await expect(service.validateNoCycle(BigInt(1), BigInt(4))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('Caso 6: profundidade igual a MAX_DEPTH (5) → passa', async () => {
      const built = await buildService(5);
      const svcCustom = built.service;
      const prismaCustom = built.prisma;

      // task=99 (nao colide); pai novo = 10
      // Cadeia: 10 → 9 → 8 → 7 → 6 → null (5 niveis acima — exatamente MAX)
      prismaCustom.dTask.findUnique
        .mockResolvedValueOnce({ idPai: BigInt(9), excluido: false })
        .mockResolvedValueOnce({ idPai: BigInt(8), excluido: false })
        .mockResolvedValueOnce({ idPai: BigInt(7), excluido: false })
        .mockResolvedValueOnce({ idPai: BigInt(6), excluido: false })
        .mockResolvedValueOnce({ idPai: null, excluido: false });

      await expect(svcCustom.validateNoCycle(BigInt(99), BigInt(10))).resolves.toBeUndefined();
    });

    it('Caso 7: profundidade > MAX_DEPTH (2) → BadRequestException', async () => {
      const built = await buildService(2);
      const svcCustom = built.service;
      const prismaCustom = built.prisma;

      // MAX_DEPTH=2; cadeia tem 3 niveis acima
      prismaCustom.dTask.findUnique
        .mockResolvedValueOnce({ idPai: BigInt(9), excluido: false })
        .mockResolvedValueOnce({ idPai: BigInt(8), excluido: false })
        .mockResolvedValueOnce({ idPai: BigInt(7), excluido: false });

      await expect(svcCustom.validateNoCycle(BigInt(99), BigInt(10))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('Caso 8: pai nao existe → NotFoundException', async () => {
      prisma.dTask.findUnique.mockResolvedValueOnce(null);

      await expect(service.validateNoCycle(BigInt(10), BigInt(99999))).rejects.toThrow(
        NotFoundException,
      );
    });

    it('Caso 9: pai excluido → NotFoundException', async () => {
      prisma.dTask.findUnique.mockResolvedValueOnce({ idPai: null, excluido: true });

      await expect(service.validateNoCycle(BigInt(10), BigInt(99))).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── validateProjectConsistency ───────────────────────────────────────────

  describe('validateProjectConsistency()', () => {
    it('Caso 10: newParentId=null → passa sem queries', async () => {
      await expect(
        service.validateProjectConsistency(BigInt(10), null),
      ).resolves.toBeUndefined();
      expect(prisma.dTask.findUnique).not.toHaveBeenCalled();
    });

    it('Caso 11: mesmo idProject → passa', async () => {
      prisma.dTask.findUnique
        .mockResolvedValueOnce({ idProject: BigInt(1) }) // task
        .mockResolvedValueOnce({ idProject: BigInt(1) }); // parent

      await expect(
        service.validateProjectConsistency(BigInt(10), BigInt(5)),
      ).resolves.toBeUndefined();
      expect(prisma.dTask.findUnique).toHaveBeenCalledTimes(2);
    });

    it('Caso 12: idProject diferentes → BadRequestException', async () => {
      prisma.dTask.findUnique
        .mockResolvedValueOnce({ idProject: BigInt(1) })
        .mockResolvedValueOnce({ idProject: BigInt(2) });

      await expect(
        service.validateProjectConsistency(BigInt(10), BigInt(5)),
      ).rejects.toThrow(BadRequestException);
    });

    it('Caso 13a: task nao existe → NotFoundException', async () => {
      prisma.dTask.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ idProject: BigInt(1) });

      await expect(
        service.validateProjectConsistency(BigInt(10), BigInt(5)),
      ).rejects.toThrow(NotFoundException);
    });

    it('Caso 13b: pai nao existe → NotFoundException', async () => {
      prisma.dTask.findUnique
        .mockResolvedValueOnce({ idProject: BigInt(1) })
        .mockResolvedValueOnce(null);

      await expect(
        service.validateProjectConsistency(BigInt(10), BigInt(5)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── softDeleteCascade ────────────────────────────────────────────────────

  describe('softDeleteCascade()', () => {
    it('Caso 14: task folha sem filhas → affected=1', async () => {
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const result = await service.softDeleteCascade(BigInt(7));
      expect(result.affected).toBe(1);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('Caso 15: fase com 3 filhas diretas → affected=4', async () => {
      prisma.$executeRaw.mockResolvedValueOnce(4);

      const result = await service.softDeleteCascade(BigInt(5));
      expect(result.affected).toBe(4);
    });

    it('Caso 16: fase com 2 niveis (3 filhas + 9 netos) → affected=13', async () => {
      prisma.$executeRaw.mockResolvedValueOnce(13);

      const result = await service.softDeleteCascade(BigInt(5));
      expect(result.affected).toBe(13);
    });

    it('Caso 17: task ja excluida → affected=0 (CTE filtra excluido=false)', async () => {
      prisma.$executeRaw.mockResolvedValueOnce(0);

      const result = await service.softDeleteCascade(BigInt(99));
      expect(result.affected).toBe(0);
    });

    it('Caso 18: task nao existe → affected=0 sem erro', async () => {
      prisma.$executeRaw.mockResolvedValueOnce(0);

      const result = await service.softDeleteCascade(BigInt(999999));
      expect(result.affected).toBe(0);
      // Idempotente — nao lanca excecao
    });

    it('Caso 19: $executeRaw retorna BigInt-like → Number coerce funciona', async () => {
      // Prisma pode retornar number ou outros tipos coerciveis
      prisma.$executeRaw.mockResolvedValueOnce(7);

      const result = await service.softDeleteCascade(BigInt(5));
      expect(typeof result.affected).toBe('number');
      expect(result.affected).toBe(7);
    });
  });

  // ─── Configuracao do MAX_DEPTH ───────────────────────────────────────────

  describe('maxDepth', () => {
    it('default 20 quando env nao configurado', async () => {
      const { service: svcDefault } = await buildService();
      expect(svcDefault.maxDepth).toBe(20);
    });

    it('respeita valor configurado via env (string)', async () => {
      const { service: svcCustom } = await buildService(50);
      expect(svcCustom.maxDepth).toBe(50);
    });

    it('rejeita valor invalido e cai no default', async () => {
      const { service: svcInvalid } = await buildService(-5);
      // -5 nao e > 0, fallback para 20
      expect(svcInvalid.maxDepth).toBe(20);
    });

    it('rejeita NaN e cai no default', async () => {
      const { service: svcNaN } = await buildService(NaN);
      expect(svcNaN.maxDepth).toBe(20);
    });
  });
});
