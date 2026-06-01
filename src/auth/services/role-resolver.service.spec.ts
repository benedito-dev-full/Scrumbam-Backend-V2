import { Test, TestingModule } from '@nestjs/testing';
import { RoleResolverService } from './role-resolver.service';
import { PrismaService } from '../../prisma.service';

const makePrismaMock = () => ({
  dVincula: {
    findFirst: jest.fn(),
  },
  dProject: {
    findFirst: jest.fn(),
  },
  $queryRaw: jest.fn(),
});

describe('RoleResolverService', () => {
  let service: RoleResolverService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [RoleResolverService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<RoleResolverService>(RoleResolverService);
  });

  describe('getOrgRole', () => {
    it('deve retornar ADMIN para DVincula idClasse=-161', async () => {
      prisma.dVincula.findFirst.mockResolvedValue({ idClasse: BigInt(-161) });

      const role = await service.getOrgRole(BigInt(1), BigInt(10));

      expect(role).toBe('ADMIN');
      expect(prisma.dVincula.findFirst).toHaveBeenCalledTimes(1);
    });

    it('deve retornar MEMBER para DVincula idClasse=-162', async () => {
      prisma.dVincula.findFirst.mockResolvedValue({ idClasse: BigInt(-162) });

      const role = await service.getOrgRole(BigInt(2), BigInt(10));
      expect(role).toBe('MEMBER');
    });

    it('deve retornar VIEWER para DVincula idClasse=-163', async () => {
      prisma.dVincula.findFirst.mockResolvedValue({ idClasse: BigInt(-163) });

      const role = await service.getOrgRole(BigInt(3), BigInt(10));
      expect(role).toBe('VIEWER');
    });

    it('deve retornar null se usuário sem vínculo na org', async () => {
      prisma.dVincula.findFirst.mockResolvedValue(null);

      const role = await service.getOrgRole(BigInt(99), BigInt(10));
      expect(role).toBeNull();
    });

    it('deve usar LRU cache na segunda chamada (N+1 ZERO)', async () => {
      prisma.dVincula.findFirst.mockResolvedValue({ idClasse: BigInt(-161) });

      await service.getOrgRole(BigInt(1), BigInt(10));
      await service.getOrgRole(BigInt(1), BigInt(10)); // deve usar cache

      expect(prisma.dVincula.findFirst).toHaveBeenCalledTimes(1); // só 1 query!
    });
  });

  describe('getProjectRole', () => {
    it('deve retornar MANAGER para DVincula idClasse=-171', async () => {
      prisma.dVincula.findFirst.mockResolvedValue({ idClasse: BigInt(-171) });

      const role = await service.getProjectRole(BigInt(1), BigInt(500));

      expect(role).toBe('MANAGER');
    });

    it('deve retornar MEMBER (fallback) quando sem DVincula mas SPACE raiz público e usuário é membro da org (ADR-V2-051 §8)', async () => {
      // 1ª findFirst: DVincula de projeto = null (sem vínculo direto).
      // 2ª findFirst (dentro de resolvePublicSpaceRole): membro da org.
      prisma.dVincula.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ chave: BigInt(77) });
      // Projeto pertence à org 50.
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(50) });
      // CTE: SPACE raiz público.
      prisma.$queryRaw.mockResolvedValue([
        { chave: BigInt(10), idClasse: BigInt(-350), privado: false },
        { chave: BigInt(500), idClasse: BigInt(-352), privado: false },
      ]);

      const role = await service.getProjectRole(BigInt(999), BigInt(500));

      expect(role).toBe('MEMBER');
    });

    it('deve retornar null quando sem DVincula e SPACE raiz é privado', async () => {
      prisma.dVincula.findFirst.mockResolvedValueOnce(null);
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(50) });
      prisma.$queryRaw.mockResolvedValue([
        { chave: BigInt(10), idClasse: BigInt(-350), privado: true },
        { chave: BigInt(500), idClasse: BigInt(-352), privado: false },
      ]);

      const role = await service.getProjectRole(BigInt(999), BigInt(500));

      expect(role).toBeNull();
    });

    it('deve retornar null quando SPACE público mas usuário NÃO é membro da org', async () => {
      prisma.dVincula.findFirst
        .mockResolvedValueOnce(null) // sem DVincula de projeto
        .mockResolvedValueOnce(null); // não é membro da org
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(50) });
      prisma.$queryRaw.mockResolvedValue([
        { chave: BigInt(10), idClasse: BigInt(-350), privado: false },
      ]);

      const role = await service.getProjectRole(BigInt(999), BigInt(500));

      expect(role).toBeNull();
    });
  });
});
