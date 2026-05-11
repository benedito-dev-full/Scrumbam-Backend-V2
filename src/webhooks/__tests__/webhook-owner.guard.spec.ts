import { ForbiddenException } from '@nestjs/common';
import { WebhookOwnerGuard } from '../guards/webhook-owner.guard';
import { WEBHOOK_CLASS_ID } from '../services/webhooks.service';

describe('WebhookOwnerGuard', () => {
  let prisma: {
    dTabela: { findFirst: jest.Mock };
    dVincula: { findFirst: jest.Mock };
  };
  let entidadeService: { getEntidadeIdFromUserGroup: jest.Mock };
  let guard: WebhookOwnerGuard;

  beforeEach(() => {
    prisma = {
      dTabela: { findFirst: jest.fn() },
      dVincula: { findFirst: jest.fn() },
    };
    entidadeService = {
      getEntidadeIdFromUserGroup: jest.fn().mockResolvedValue(BigInt(900)),
    };
    guard = new WebhookOwnerGuard(prisma as never, entidadeService as never);
  });

  it('usa EntidadeService para converter DUserGroup e valida vinculo do projeto do body', async () => {
    prisma.dVincula.findFirst.mockResolvedValue({ chave: BigInt(1) });

    await expect(guard.canActivate(context({ body: { projectId: '100' } }))).resolves.toBe(true);

    expect(entidadeService.getEntidadeIdFromUserGroup).toHaveBeenCalledWith(BigInt(10));
    expect(prisma.dVincula.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          idLocEscritu: BigInt(100),
          idEntidade: BigInt(900),
        }),
      }),
    );
  });

  it('resolve projeto pelo webhook id em rotas de detalhe/update/delete', async () => {
    prisma.dTabela.findFirst.mockResolvedValue({ dEntidadeId: BigInt(100) });
    prisma.dVincula.findFirst.mockResolvedValue({ chave: BigInt(1) });

    await expect(guard.canActivate(context({ params: { id: '200' } }))).resolves.toBe(true);

    expect(prisma.dTabela.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          chave: BigInt(200),
          idClasse: WEBHOOK_CLASS_ID,
        }),
      }),
    );
  });

  it('nega acesso sem vinculo ao projeto', async () => {
    prisma.dVincula.findFirst.mockResolvedValue(null);

    await expect(guard.canActivate(context({ query: { projectId: '100' } }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  function context(request: {
    params?: Record<string, string>;
    query?: Record<string, string>;
    body?: Record<string, unknown>;
  }) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { sub: '10' },
          ...request,
        }),
      }),
    } as never;
  }
});

