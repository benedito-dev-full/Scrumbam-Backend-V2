import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PhaseDescendantsService } from '../phase-descendants.service';
import { PrismaService } from '../../../prisma.service';

describe('PhaseDescendantsService', () => {
  let service: PhaseDescendantsService;
  let prisma: { dTask: { findUnique: jest.Mock }; $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = {
      dTask: { findUnique: jest.fn() },
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PhaseDescendantsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(PhaseDescendantsService);
  });

  it('deve lançar NotFoundException quando raiz não existe', async () => {
    prisma.dTask.findUnique.mockResolvedValue(null);

    await expect(service.findDescendantTaskIds(BigInt(7))).rejects.toThrow(NotFoundException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('deve lançar NotFoundException quando raiz está soft-deleted', async () => {
    prisma.dTask.findUnique.mockResolvedValue({
      idProject: BigInt(123),
      excluido: true,
    });

    await expect(service.findDescendantTaskIds(BigInt(7))).rejects.toThrow(NotFoundException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('deve lançar NotFoundException quando raiz não tem idProject', async () => {
    prisma.dTask.findUnique.mockResolvedValue({ idProject: null, excluido: false });

    await expect(service.findDescendantTaskIds(BigInt(7))).rejects.toThrow(NotFoundException);
  });

  it('deve retornar array vazio quando fase não tem descendentes', async () => {
    prisma.dTask.findUnique.mockResolvedValue({ idProject: BigInt(123), excluido: false });
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await service.findDescendantTaskIds(BigInt(7));
    expect(result).toEqual([]);
  });

  it('deve retornar lista de chaves de folhas descendentes', async () => {
    prisma.dTask.findUnique.mockResolvedValue({ idProject: BigInt(123), excluido: false });
    prisma.$queryRaw.mockResolvedValue([
      { chave: BigInt(10) },
      { chave: BigInt(11) },
      { chave: BigInt(12) },
    ]);

    const result = await service.findDescendantTaskIds(BigInt(7));
    expect(result).toEqual([BigInt(10), BigInt(11), BigInt(12)]);
  });

  it('deve aplicar idProject no filtro (defense-in-depth)', async () => {
    prisma.dTask.findUnique.mockResolvedValue({ idProject: BigInt(123), excluido: false });
    prisma.$queryRaw.mockResolvedValue([]);

    await service.findDescendantTaskIds(BigInt(7));

    // Inspeciona o template tag e os valores interpolados.
    // $queryRaw recebe (TemplateStringsArray, ...values)
    const calls = prisma.$queryRaw.mock.calls;
    expect(calls).toHaveLength(1);
    const args = calls[0];
    // Primeiro argumento é o template, demais são valores. phaseId + rootProjectId
    // aparecem múltiplas vezes (anchor + recursivo + filter idProject).
    const values = args.slice(1);
    expect(values).toContain(BigInt(7)); // phaseId
    expect(values).toContain(BigInt(123)); // rootProjectId
  });
});
