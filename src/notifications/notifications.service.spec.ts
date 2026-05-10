import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const prisma = {
    dEvento: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationsService(prisma as never);
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(prisma),
    );
  });

  it('lista apenas notificacoes DEvento -490 do usuario e filtra excluido=false', async () => {
    prisma.dEvento.findMany.mockResolvedValue([
      {
        chave: BigInt(10),
        idClasse: BigInt(-490),
        idEntidade: BigInt(150),
        descricao: 'Mensagem',
        metaDados: { eventType: 'task.status.changed', title: 'Titulo', read: false },
        criadoEm: new Date('2026-05-10T12:00:00.000Z'),
      },
    ]);

    const result = await service.findMany(BigInt(150), { limit: 20 });

    expect(prisma.dEvento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          idClasse: BigInt(-490),
          idEntidade: BigInt(150),
          excluido: false,
        },
        orderBy: { chave: 'desc' },
        take: 21,
      }),
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: '10',
        idClasse: '-490',
        recipientId: '150',
        read: false,
      }),
    );
  });

  it('aplica cursor e limita take em 100', async () => {
    prisma.dEvento.findMany.mockResolvedValue([]);

    await service.findMany(BigInt(150), { cursor: '99', limit: 100 });

    expect(prisma.dEvento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ chave: { lt: BigInt(99) } }),
        take: 101,
      }),
    );
  });

  it('lista unreadOnly por raw SQL para tratar metaDados.read ausente como unread', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await service.findMany(BigInt(150), { unreadOnly: 'true', cursor: '99', limit: 10 });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.dEvento.findMany).not.toHaveBeenCalled();
  });

  it('conta nao lidas filtrando excluido=false', async () => {
    prisma.$queryRaw.mockResolvedValue([{ count: BigInt(3) }]);

    await expect(service.getUnreadCount(BigInt(150))).resolves.toEqual({ count: 3 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('marca uma notificacao como lida com ownership e excluido=false', async () => {
    prisma.dEvento.findFirst.mockResolvedValue({
      chave: BigInt(10),
      metaDados: { title: 'Titulo', read: false },
    });
    prisma.dEvento.update.mockResolvedValue({
      chave: BigInt(10),
      idClasse: BigInt(-490),
      idEntidade: BigInt(150),
      descricao: 'Mensagem',
      metaDados: { title: 'Titulo', read: true, readAt: '2026-05-10T12:00:00.000Z' },
      criadoEm: new Date('2026-05-10T12:00:00.000Z'),
    });

    const result = await service.markAsRead(BigInt(10), BigInt(150));

    expect(prisma.dEvento.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          chave: BigInt(10),
          idClasse: BigInt(-490),
          idEntidade: BigInt(150),
          excluido: false,
        },
      }),
    );
    expect(prisma.dEvento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { metaDados: expect.objectContaining({ read: true, readAt: expect.any(String) }) },
      }),
    );
    expect(result.read).toBe(true);
  });

  it('retorna 404 ao marcar lida se nao encontrar ownership', async () => {
    prisma.dEvento.findFirst.mockResolvedValue(null);

    await expect(service.markAsRead(BigInt(10), BigInt(150))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('marca todas como lidas em lote sem loop', async () => {
    prisma.$executeRaw.mockResolvedValue(5);

    await expect(service.markAllAsRead(BigInt(150))).resolves.toEqual({ updated: 5 });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.dEvento.findMany).not.toHaveBeenCalled();
    expect(prisma.dEvento.update).not.toHaveBeenCalled();
  });

  it('faz soft delete com excluido=true e ownership', async () => {
    prisma.dEvento.updateMany.mockResolvedValue({ count: 1 });

    await service.delete(BigInt(10), BigInt(150));

    expect(prisma.dEvento.updateMany).toHaveBeenCalledWith({
      where: {
        chave: BigInt(10),
        idClasse: BigInt(-490),
        idEntidade: BigInt(150),
        excluido: false,
      },
      data: { excluido: true },
    });
  });

  it('retorna 404 no delete se updateMany nao afetar linha', async () => {
    prisma.dEvento.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.delete(BigInt(10), BigInt(150))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
