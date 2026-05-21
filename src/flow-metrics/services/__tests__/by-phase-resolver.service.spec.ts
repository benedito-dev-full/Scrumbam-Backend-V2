import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ByPhaseResolverService } from '../by-phase-resolver.service';
import { PhaseDescendantsService } from '../phase-descendants.service';
import { PrismaService } from '../../../prisma.service';
import { JwtPayload } from '../../../auth/decorators/current-user.decorator';

describe('ByPhaseResolverService', () => {
  let service: ByPhaseResolverService;
  let prisma: { dTask: { findUnique: jest.Mock } };
  let descendants: { findDescendantTaskIds: jest.Mock };

  const baseUser: JwtPayload = {
    sub: '1',
    entidadeId: '1',
    organizationId: '999',
    email: 'test@test.com',
  } as JwtPayload;

  beforeEach(async () => {
    prisma = { dTask: { findUnique: jest.fn() } };
    descendants = { findDescendantTaskIds: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ByPhaseResolverService,
        { provide: PrismaService, useValue: prisma },
        { provide: PhaseDescendantsService, useValue: descendants },
      ],
    }).compile();

    service = module.get(ByPhaseResolverService);
  });

  it('deve resolver projectId + taskIds para fase válida', async () => {
    prisma.dTask.findUnique.mockResolvedValue({
      chave: BigInt(7),
      idClasse: BigInt(-200),
      idProject: BigInt(123),
      excluido: false,
      project: { chave: BigInt(123), idEstab: BigInt(999) },
    });
    descendants.findDescendantTaskIds.mockResolvedValue([BigInt(10), BigInt(11)]);

    const result = await service.resolve('7', baseUser);
    expect(result.projectId).toBe(BigInt(123));
    expect(result.taskIds).toEqual([BigInt(10), BigInt(11)]);
  });

  it('deve lançar NotFoundException quando phaseId inválido (não-numérico)', async () => {
    await expect(service.resolve('abc', baseUser)).rejects.toThrow(NotFoundException);
    expect(prisma.dTask.findUnique).not.toHaveBeenCalled();
  });

  it('deve lançar NotFoundException quando fase não existe', async () => {
    prisma.dTask.findUnique.mockResolvedValue(null);
    await expect(service.resolve('7', baseUser)).rejects.toThrow(NotFoundException);
  });

  it('deve lançar NotFoundException quando fase está soft-deleted', async () => {
    prisma.dTask.findUnique.mockResolvedValue({
      chave: BigInt(7),
      idClasse: BigInt(-200),
      idProject: BigInt(123),
      excluido: true,
      project: { chave: BigInt(123), idEstab: BigInt(999) },
    });
    await expect(service.resolve('7', baseUser)).rejects.toThrow(NotFoundException);
  });

  it('deve lançar NotFoundException quando idClasse não é -200 (anti-enumeration)', async () => {
    prisma.dTask.findUnique.mockResolvedValue({
      chave: BigInt(7),
      idClasse: BigInt(-154), // SCRUMBAN_TASK, não PHASE
      idProject: BigInt(123),
      excluido: false,
      project: { chave: BigInt(123), idEstab: BigInt(999) },
    });
    await expect(service.resolve('7', baseUser)).rejects.toThrow(NotFoundException);
  });

  it('deve lançar ForbiddenException quando fase é de outra org', async () => {
    prisma.dTask.findUnique.mockResolvedValue({
      chave: BigInt(7),
      idClasse: BigInt(-200),
      idProject: BigInt(123),
      excluido: false,
      project: { chave: BigInt(123), idEstab: BigInt(888) }, // org diferente
    });
    await expect(service.resolve('7', baseUser)).rejects.toThrow(ForbiddenException);
  });

  it('deve retornar taskIds vazio quando fase não tem descendentes', async () => {
    prisma.dTask.findUnique.mockResolvedValue({
      chave: BigInt(7),
      idClasse: BigInt(-200),
      idProject: BigInt(123),
      excluido: false,
      project: { chave: BigInt(123), idEstab: BigInt(999) },
    });
    descendants.findDescendantTaskIds.mockResolvedValue([]);

    const result = await service.resolve('7', baseUser);
    expect(result.taskIds).toEqual([]);
    expect(result.projectId).toBe(BigInt(123));
  });
});
