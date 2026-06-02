import { Test, TestingModule } from '@nestjs/testing';
import { RoleResolverService } from './role-resolver.service';
import { PrismaService } from '../../prisma.service';
import { ProjectRefService } from '../../projects/project-ref.service';

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
      providers: [
        RoleResolverService,
        { provide: PrismaService, useValue: prisma },
        {
          // resolveEntidadeRef passthrough (P→P) — ADR-V2-058 DI debt.
          provide: ProjectRefService,
          useValue: {
            resolveEntidadeRef: jest.fn((id: bigint) => Promise.resolve(id)),
          },
        },
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
        .mockResolvedValueOnce(null) // não é membro da org (public space)
        .mockResolvedValueOnce(null); // não é ADMIN da org (fallback org-admin)
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(50) });
      prisma.$queryRaw.mockResolvedValue([
        { chave: BigInt(10), idClasse: BigInt(-350), privado: false },
      ]);

      const role = await service.getProjectRole(BigInt(999), BigInt(500));

      expect(role).toBeNull();
    });

    it('deve retornar MANAGER por herança quando ADMIN da org dona, projeto PRIVADO e sem DVincula (ORG_ADMIN → MANAGER)', async () => {
      // 1ª findFirst: DVincula de projeto = null.
      // SPACE privado → resolvePublicSpaceRole retorna null sem checar org.
      // 2ª findFirst (getOrgRole no fallback org-admin): ADMIN da org (-161).
      prisma.dVincula.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ idClasse: BigInt(-161) });
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(50) });
      prisma.$queryRaw.mockResolvedValue([
        { chave: BigInt(10), idClasse: BigInt(-350), privado: true },
        { chave: BigInt(500), idClasse: BigInt(-352), privado: false },
      ]);

      const role = await service.getProjectRole(BigInt(2), BigInt(500));

      expect(role).toBe('MANAGER');
    });

    it('NÃO deve herdar MANAGER quando usuário é MEMBER (não ADMIN) da org e projeto privado', async () => {
      prisma.dVincula.findFirst
        .mockResolvedValueOnce(null) // sem DVincula de projeto
        .mockResolvedValueOnce({ idClasse: BigInt(-162) }); // MEMBER da org, não ADMIN
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(50) });
      prisma.$queryRaw.mockResolvedValue([
        { chave: BigInt(10), idClasse: BigInt(-350), privado: true },
      ]);

      const role = await service.getProjectRole(BigInt(3), BigInt(500));

      expect(role).toBeNull();
    });
  });
});
