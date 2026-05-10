import { UnauthorizedException } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  const service = {
    findMany: jest.fn(),
    getUnreadCount: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    delete: jest.fn(),
  };

  let controller: NotificationsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new NotificationsController(service as unknown as NotificationsService);
  });

  it('usa user.entidadeId autenticado na listagem', async () => {
    service.findMany.mockResolvedValue({ items: [], pagination: { hasMore: false, nextCursor: null } });

    await controller.findMany({ user: { entidadeId: '150' } }, { limit: 20 });

    expect(service.findMany).toHaveBeenCalledWith(BigInt(150), { limit: 20 });
  });

  it('usa user.entidadeId no unread-count', async () => {
    service.getUnreadCount.mockResolvedValue({ count: 2 });

    await controller.getUnreadCount({ user: { entidadeId: '150' } });

    expect(service.getUnreadCount).toHaveBeenCalledWith(BigInt(150));
  });

  it('converte id para BigInt em markAsRead', async () => {
    service.markAsRead.mockResolvedValue({});

    await controller.markAsRead(BigInt(10), { user: { entidadeId: '150' } });

    expect(service.markAsRead).toHaveBeenCalledWith(BigInt(10), BigInt(150));
  });

  it('delega read-all ao service', async () => {
    service.markAllAsRead.mockResolvedValue({ updated: 5 });

    await controller.markAllAsRead({ user: { entidadeId: '150' } });

    expect(service.markAllAsRead).toHaveBeenCalledWith(BigInt(150));
  });

  it('delega delete ao service', async () => {
    service.delete.mockResolvedValue(undefined);

    await controller.delete(BigInt(10), { user: { entidadeId: '150' } });

    expect(service.delete).toHaveBeenCalledWith(BigInt(10), BigInt(150));
  });

  it('rejeita request sem entidadeId', async () => {
    await expect(controller.findMany({}, {})).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
