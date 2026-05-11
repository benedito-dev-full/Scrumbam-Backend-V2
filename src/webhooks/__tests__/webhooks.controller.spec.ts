import { WebhooksController } from '../webhooks.controller';

describe('WebhooksController', () => {
  let service: {
    create: jest.Mock;
    list: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let redrive: {
    test: jest.Mock;
    redrive: jest.Mock;
    listAttempts: jest.Mock;
  };
  let controller: WebhooksController;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      list: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    redrive = {
      test: jest.fn(),
      redrive: jest.fn(),
      listAttempts: jest.fn(),
    };
    controller = new WebhooksController(service as never, redrive as never);
  });

  it('delega endpoints ao service sem regra de negocio no controller', async () => {
    const created = { id: '1', secret: 's'.repeat(64) };
    service.create.mockResolvedValue(created);
    service.list.mockResolvedValue({ items: [], pagination: { hasMore: false, nextCursor: null } });
    service.findOne.mockResolvedValue({ id: '1' });
    service.update.mockResolvedValue({ id: '1', url: 'https://hooks.example.com/b' });
    service.delete.mockResolvedValue(undefined);
    redrive.test.mockResolvedValue({ deliveryId: 'test-1', success: true });
    redrive.redrive.mockResolvedValue({ id: '1', disabled: false, failureCount: 0 });
    redrive.listAttempts.mockResolvedValue({
      items: [],
      pagination: { hasMore: false, nextCursor: null },
    });

    await expect(
      controller.create({
        projectId: '100',
        url: 'https://hooks.example.com/a',
        events: ['task.created'],
      }),
    ).resolves.toBe(created);
    await expect(controller.list({ projectId: '100', limit: 20 })).resolves.toEqual({
      items: [],
      pagination: { hasMore: false, nextCursor: null },
    });
    await expect(controller.findOne('1')).resolves.toEqual({ id: '1' });
    await expect(controller.test('1', { eventType: 'task.created' })).resolves.toEqual({
      deliveryId: 'test-1',
      success: true,
    });
    await expect(controller.redrive('1')).resolves.toEqual({
      id: '1',
      disabled: false,
      failureCount: 0,
    });
    await expect(controller.listAttempts('1', { limit: 20 })).resolves.toEqual({
      items: [],
      pagination: { hasMore: false, nextCursor: null },
    });
    await expect(controller.update('1', { url: 'https://hooks.example.com/b' })).resolves.toEqual({
      id: '1',
      url: 'https://hooks.example.com/b',
    });
    await expect(controller.delete('1')).resolves.toBeUndefined();

    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.list).toHaveBeenCalledWith({ projectId: '100', limit: 20 });
    expect(service.findOne).toHaveBeenCalledWith('1');
    expect(redrive.test).toHaveBeenCalledWith('1', { eventType: 'task.created' });
    expect(redrive.redrive).toHaveBeenCalledWith('1');
    expect(redrive.listAttempts).toHaveBeenCalledWith('1', { limit: 20 });
    expect(service.update).toHaveBeenCalledWith('1', { url: 'https://hooks.example.com/b' });
    expect(service.delete).toHaveBeenCalledWith('1');
  });
});
