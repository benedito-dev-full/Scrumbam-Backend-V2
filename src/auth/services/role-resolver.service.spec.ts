import { Test, TestingModule } from '@nestjs/testing';
import { RoleResolverService } from './role-resolver.service';
import { PrismaService } from '../../prisma.service';

const makePrismaMock = () => ({
  dVincula: {
    findFirst: jest.fn(),
  },
});

describe('RoleResolverService', () => {
  let service: RoleResolverService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleResolverService,
        { provide: PrismaService, useValue: prisma },
      ],
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
});
