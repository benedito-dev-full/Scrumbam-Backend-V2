import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';
import { ProjectMembersService } from './project-members.service';
import { ProjectRefService } from './project-ref.service';

/**
 * Cobertura da herança ORG_ADMIN → MANAGER nas operações de membros
 * (addMember / updateMember / removeMember). Admin da workspace (-161) gere
 * membros de qualquer projeto DA PRÓPRIA ORG, com guarda de tenant
 * (idEstab === organizationId) para evitar escalonamento cross-org.
 */
describe('ProjectMembersService — herança ORG_ADMIN → MANAGER', () => {
  let service: ProjectMembersService;
  let prisma: {
    dVincula: { findFirst: jest.Mock; create: jest.Mock };
    dProject: { findFirst: jest.Mock };
    dEntidade: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    const prismaMock = {
      dVincula: { findFirst: jest.fn(), create: jest.fn() },
      dProject: { findFirst: jest.fn() },
      dEntidade: { findFirst: jest.fn() },
    };
    const projectRefMock = {
      resolveEntidadeRef: jest.fn((id: bigint) => Promise.resolve(id)),
      ensureEntidadeRefById: jest.fn((id: bigint) => Promise.resolve(id)),
    };

    const module = await Test.createTestingModule({
      providers: [
        ProjectMembersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ProjectRefService, useValue: projectRefMock },
      ],
    }).compile();

    service = module.get(ProjectMembersService);
    prisma = module.get(PrismaService);
  });

  it('addMember: permite ORG_ADMIN (-161) da org dona, sem DVincula MANAGER (-171)', async () => {
    prisma.dVincula.findFirst
      .mockResolvedValueOnce(null) // MANAGER check → não é manager
      .mockResolvedValueOnce({ chave: BigInt(7) }) // ORG_ADMIN check → é admin da org
      .mockResolvedValueOnce(null); // membership existente → não duplicado
    prisma.dProject.findFirst.mockResolvedValueOnce({ idEstab: BigInt(50) }); // projeto pertence à org 50
    prisma.dEntidade.findFirst.mockResolvedValueOnce({ chave: BigInt(200) }); // target user existe
    prisma.dVincula.create.mockResolvedValueOnce({ chave: BigInt(999) });

    await service.addMember('1', { userId: '200', role: 'MEMBER' }, BigInt(999), '50');

    expect(prisma.dVincula.create).toHaveBeenCalledTimes(1);
  });

  it('addMember: REJEITA quando não é MANAGER nem ORG_ADMIN da org (Forbidden, sem mutação)', async () => {
    prisma.dVincula.findFirst
      .mockResolvedValueOnce(null) // MANAGER check → null
      .mockResolvedValueOnce(null); // ORG_ADMIN check → null
    prisma.dProject.findFirst.mockResolvedValueOnce({ idEstab: BigInt(50) });

    await expect(
      service.addMember('1', { userId: '200', role: 'MEMBER' }, BigInt(999), '50'),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.dVincula.create).not.toHaveBeenCalled();
  });

  it('removeMember: REJEITA ORG_ADMIN de OUTRA org (cross-tenant) — Forbidden', async () => {
    prisma.dVincula.findFirst.mockResolvedValueOnce(null); // MANAGER check → null
    // Projeto pertence à org 50, mas o requester alega ser admin da org 999.
    prisma.dProject.findFirst.mockResolvedValueOnce({ idEstab: BigInt(50) });

    await expect(service.removeMember('1', '200', BigInt(999), '999')).rejects.toThrow(
      ForbiddenException,
    );
    // Guarda de tenant barra ANTES de checar vínculo de org-admin.
    expect(prisma.dVincula.findFirst).toHaveBeenCalledTimes(1);
  });
});
