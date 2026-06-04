import { Test } from '@nestjs/testing';
import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OrgAdminGuard } from './org-admin.guard';
import { PrismaService } from '../../prisma.service';

/** Monta um ExecutionContext fake com o `req.user` informado. */
function ctxWithUser(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('OrgAdminGuard', () => {
  let guard: OrgAdminGuard;
  let prisma: { dVincula: { findFirst: jest.Mock } };

  beforeEach(async () => {
    prisma = { dVincula: { findFirst: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [OrgAdminGuard, { provide: PrismaService, useValue: prisma }],
    }).compile();
    guard = module.get(OrgAdminGuard);
  });

  it('permite quando ha vinculo ADMIN (-161) usuario↔org', async () => {
    prisma.dVincula.findFirst.mockResolvedValue({ chave: BigInt(1) });
    const ctx = ctxWithUser({ entidadeId: '900', organizationId: '152' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    // Direcao EXATA: idLocEscritu=org, idEntidade=user, idClasse=-161.
    expect(prisma.dVincula.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          idLocEscritu: BigInt(152),
          idEntidade: BigInt(900),
          idClasse: BigInt(-161),
          excluido: false,
        }),
      }),
    );
  });

  it('nega (403) membro sem vinculo ADMIN', async () => {
    prisma.dVincula.findFirst.mockResolvedValue(null);
    const ctx = ctxWithUser({ entidadeId: '901', organizationId: '152' });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejeita (400) quando JWT nao tem org ativa', async () => {
    const ctx = ctxWithUser({ entidadeId: '900' });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.dVincula.findFirst).not.toHaveBeenCalled();
  });

  it('rejeita (403) quando nao ha req.user', async () => {
    const ctx = ctxWithUser(undefined);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
