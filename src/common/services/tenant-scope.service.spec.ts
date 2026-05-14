import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { TenantScopeService } from './tenant-scope.service';

interface MockPrisma {
  dVincula: { findMany: jest.Mock };
  dProject: { findFirst: jest.Mock; findMany: jest.Mock };
  dTask: { findFirst: jest.Mock };
  dEntidade: { findFirst: jest.Mock };
}

describe('TenantScopeService', () => {
  let service: TenantScopeService;
  let prisma: MockPrisma;

  beforeEach(async () => {
    prisma = {
      dVincula: { findMany: jest.fn() },
      dProject: { findFirst: jest.fn(), findMany: jest.fn() },
      dTask: { findFirst: jest.fn() },
      dEntidade: { findFirst: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [TenantScopeService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(TenantScopeService);
  });

  describe('scopeProjectIdsToOrg', () => {
    it('happy path — retorna apenas projects cruzando DVincula + idEstab=orgId', async () => {
      prisma.dVincula.findMany.mockResolvedValue([
        { idLocEscritu: BigInt(10) },
        { idLocEscritu: BigInt(20) },
        { idLocEscritu: BigInt(30) },
      ]);
      prisma.dProject.findMany.mockResolvedValue([{ chave: BigInt(10) }, { chave: BigInt(30) }]);

      const ids = await service.scopeProjectIdsToOrg(BigInt(100), '50');

      expect(ids).toEqual([BigInt(10), BigInt(30)]);
      expect(prisma.dProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            idEstab: BigInt(50),
            excluido: false,
            chave: { in: [BigInt(10), BigInt(20), BigInt(30)] },
          }),
        }),
      );
    });

    it('user sem membership — retorna lista vazia sem hit em DProject', async () => {
      prisma.dVincula.findMany.mockResolvedValue([]);
      const ids = await service.scopeProjectIdsToOrg(BigInt(100), '50');
      expect(ids).toEqual([]);
      expect(prisma.dProject.findMany).not.toHaveBeenCalled();
    });

    it('mismatch — memberships em outra org → lista vazia', async () => {
      prisma.dVincula.findMany.mockResolvedValue([{ idLocEscritu: BigInt(10) }]);
      prisma.dProject.findMany.mockResolvedValue([]); // nenhum casa com idEstab=50
      const ids = await service.scopeProjectIdsToOrg(BigInt(100), '50');
      expect(ids).toEqual([]);
    });

    it('organizationId invalido (string nao numerica) — retorna vazio sem queries', async () => {
      const ids = await service.scopeProjectIdsToOrg(BigInt(100), 'abc');
      expect(ids).toEqual([]);
      expect(prisma.dVincula.findMany).not.toHaveBeenCalled();
    });

    it('N+1 ZERO — usa exatamente 2 queries independente do volume', async () => {
      const memberships = Array.from({ length: 50 }, (_, i) => ({ idLocEscritu: BigInt(i + 1) }));
      prisma.dVincula.findMany.mockResolvedValue(memberships);
      prisma.dProject.findMany.mockResolvedValue(
        memberships.map((m) => ({ chave: m.idLocEscritu })),
      );

      await service.scopeProjectIdsToOrg(BigInt(100), '50');

      expect(prisma.dVincula.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.dProject.findMany).toHaveBeenCalledTimes(1);
    });

    it('dedupe — memberships duplicados nao geram duplicatas no batch', async () => {
      prisma.dVincula.findMany.mockResolvedValue([
        { idLocEscritu: BigInt(10) },
        { idLocEscritu: BigInt(10) },
        { idLocEscritu: BigInt(20) },
      ]);
      prisma.dProject.findMany.mockResolvedValue([{ chave: BigInt(10) }, { chave: BigInt(20) }]);

      await service.scopeProjectIdsToOrg(BigInt(100), '50');

      const call = prisma.dProject.findMany.mock.calls[0][0];
      expect((call.where.chave.in as bigint[]).length).toBe(2);
    });
  });

  describe('assertProjectInOrg', () => {
    it('happy path — projeto na org → nao lanca', async () => {
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(50) });
      await expect(service.assertProjectInOrg('10', '50')).resolves.toBeUndefined();
    });

    it('projeto inexistente — 404', async () => {
      prisma.dProject.findFirst.mockResolvedValue(null);
      await expect(service.assertProjectInOrg('10', '50')).rejects.toThrow(NotFoundException);
    });

    it('projeto em outra org — 404 (anti enumeration)', async () => {
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(99) });
      await expect(service.assertProjectInOrg('10', '50')).rejects.toThrow(NotFoundException);
    });

    it('projeto com idEstab=null — 404 (legado nao acessivel)', async () => {
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: null });
      await expect(service.assertProjectInOrg('10', '50')).rejects.toThrow(NotFoundException);
    });

    it('projectId invalido — 404 sem query', async () => {
      await expect(service.assertProjectInOrg('xyz', '50')).rejects.toThrow(NotFoundException);
      expect(prisma.dProject.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('assertTaskInOrg', () => {
    it('happy path — task pertence a projeto na org', async () => {
      prisma.dTask.findFirst.mockResolvedValue({ idProject: BigInt(10) });
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(50) });
      await expect(service.assertTaskInOrg('77', '50')).resolves.toBeUndefined();
    });

    it('task inexistente — 404', async () => {
      prisma.dTask.findFirst.mockResolvedValue(null);
      await expect(service.assertTaskInOrg('77', '50')).rejects.toThrow(NotFoundException);
    });

    it('task em projeto de outra org — 404', async () => {
      prisma.dTask.findFirst.mockResolvedValue({ idProject: BigInt(10) });
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(99) });
      await expect(service.assertTaskInOrg('77', '50')).rejects.toThrow(NotFoundException);
    });

    it('task sem idProject — 404', async () => {
      prisma.dTask.findFirst.mockResolvedValue({ idProject: null });
      await expect(service.assertTaskInOrg('77', '50')).rejects.toThrow(NotFoundException);
    });
  });

  describe('assertAgentInOrg', () => {
    it('happy path — agente da org', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue({ idEstab: BigInt(50) });
      await expect(service.assertAgentInOrg('5', '50')).resolves.toBeUndefined();
    });

    it('agente inexistente — 404', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue(null);
      await expect(service.assertAgentInOrg('5', '50')).rejects.toThrow(NotFoundException);
    });

    it('agente standalone (idEstab=null) — 404 nao listado por orgs', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue({ idEstab: null });
      await expect(service.assertAgentInOrg('5', '50')).rejects.toThrow(NotFoundException);
    });

    it('agente em outra org — 404', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue({ idEstab: BigInt(99) });
      await expect(service.assertAgentInOrg('5', '50')).rejects.toThrow(NotFoundException);
    });
  });

  describe('assertWorkspace', () => {
    it('organizationId presente — nao lanca', () => {
      expect(() => service.assertWorkspace('50')).not.toThrow();
    });

    it('organizationId vazio — 403 NO_WORKSPACE', () => {
      expect(() => service.assertWorkspace(undefined)).toThrow(ForbiddenException);
      expect(() => service.assertWorkspace(null)).toThrow(ForbiddenException);
      expect(() => service.assertWorkspace('')).toThrow(ForbiddenException);
    });
  });
});
