import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';
import { UserProjectService } from './user-project.service';
import { ProjectRefService } from './project-ref.service';

describe('UserProjectService', () => {
  let service: UserProjectService;
  let prisma: {
    dVincula: { findMany: jest.Mock };
    dProject: { findFirst: jest.Mock };
  };

  const USER_ID = BigInt(100);
  const PROJECT_ID = BigInt(10);

  beforeEach(async () => {
    prisma = {
      dVincula: { findMany: jest.fn() },
      dProject: { findFirst: jest.fn() },
    };

    // ADR-V2-058/059: refsToProjectIds mapeia handles → projectIds. No teste,
    // passthrough legacy (handle já é o projectId) — converte BigInt → string.
    const projectRefMock = {
      refsToProjectIds: jest.fn((handles: Array<bigint | null>) =>
        Promise.resolve(
          Array.from(new Set(handles.filter((h): h is bigint => h !== null).map((h) => h.toString()))),
        ),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserProjectService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectRefService, useValue: projectRefMock },
      ],
    }).compile();

    service = module.get(UserProjectService);
  });

  it('deve retornar projeto mais recente associado por DVincula de membership', async () => {
    prisma.dVincula.findMany.mockResolvedValue([
      { idLocEscritu: PROJECT_ID },
      { idLocEscritu: BigInt(9) },
    ]);
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID });

    const result = await service.getDefaultProject(USER_ID);

    expect(result).toBe(PROJECT_ID);
    expect(prisma.dVincula.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          idEntidade: USER_ID,
          idClasse: { in: [BigInt(-171), BigInt(-172), BigInt(-173)] },
          excluido: false,
        }),
      }),
    );
    expect(prisma.dProject.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chave: { in: [PROJECT_ID, BigInt(9)] }, excluido: false },
      }),
    );
  });

  it('deve retornar null sem fallback global quando usuario nao tem projeto', async () => {
    prisma.dVincula.findMany.mockResolvedValue([]);

    const result = await service.getDefaultProject(USER_ID);

    expect(result).toBeNull();
    expect(prisma.dProject.findFirst).not.toHaveBeenCalled();
  });
});
