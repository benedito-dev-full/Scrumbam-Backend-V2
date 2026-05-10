import { NotificationConsumer } from '../notification.consumer';
import type { IEvent } from '../../interfaces/event.interface';

function event(type: string, payload: Record<string, unknown>): IEvent {
  return {
    type,
    payload,
    correlationId: 'corr-1',
    metadata: {
      source: 'spec',
      timestamp: '2026-05-10T00:00:00.000Z',
      correlationId: 'corr-1',
    },
  };
}

describe('NotificationConsumer', () => {
  const prisma = {
    dTask: { findFirst: jest.fn() },
    dProject: { findFirst: jest.fn() },
    dVincula: { findMany: jest.fn() },
    dEvento: { findMany: jest.fn(), createMany: jest.fn() },
  };

  let consumer: NotificationConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    consumer = new NotificationConsumer(prisma as never);
    prisma.dEvento.findMany.mockResolvedValue([]);
    prisma.dEvento.createMany.mockResolvedValue({ count: 0 });
  });

  it('cria notificacoes para creator e assignee de task.status.changed', async () => {
    prisma.dTask.findFirst.mockResolvedValue({
      chave: BigInt(10),
      nome: 'Implementar F7',
      idCreator: BigInt(1),
      idAssignee: BigInt(2),
      idProject: BigInt(7),
    });

    await consumer.handle(event('task.status.changed', { taskId: '10' }));

    expect(prisma.dTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chave: BigInt(10), excluido: false } }),
    );
    expect(prisma.dEvento.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ idClasse: BigInt(-490), idEntidade: BigInt(1) }),
        expect.objectContaining({ idClasse: BigInt(-490), idEntidade: BigInt(2) }),
      ]),
    });
  });

  it('deduplica creator igual ao assignee', async () => {
    prisma.dTask.findFirst.mockResolvedValue({
      chave: BigInt(10),
      nome: 'Task',
      idCreator: BigInt(1),
      idAssignee: BigInt(1),
      idProject: null,
    });

    await consumer.handle(event('task.assigned', { taskId: '10' }));

    expect(prisma.dEvento.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ idEntidade: BigInt(1) })],
    });
  });

  it('cria notificacoes para managers e admins em execution.awaiting_approval', async () => {
    prisma.dProject.findFirst.mockResolvedValue({
      chave: BigInt(7),
      nome: 'Projeto',
      idEstab: BigInt(3),
    });
    prisma.dVincula.findMany.mockResolvedValue([
      { idEntidade: BigInt(1) },
      { idEntidade: BigInt(2) },
      { idEntidade: BigInt(1) },
    ]);

    await consumer.handle(
      event('execution.awaiting_approval', { projectId: '7', executionId: '99' }),
    );

    expect(prisma.dVincula.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          excluido: false,
          OR: expect.arrayContaining([
            { idLocEscritu: BigInt(7), idClasse: BigInt(-171) },
            { idLocEscritu: BigInt(3), idClasse: BigInt(-161) },
          ]),
        }),
      }),
    );
    expect(prisma.dEvento.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ idEntidade: BigInt(1) }),
        expect.objectContaining({ idEntidade: BigInt(2) }),
      ]),
    });
    expect(prisma.dEvento.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it('nao cria para trigger fora do set', async () => {
    await consumer.handle(event('task.created', { taskId: '10' }));

    expect(prisma.dEvento.createMany).not.toHaveBeenCalled();
  });

  it('mantem idempotencia por identificador externo', async () => {
    prisma.dTask.findFirst.mockResolvedValue({
      chave: BigInt(10),
      nome: 'Task',
      idCreator: BigInt(1),
      idAssignee: null,
      idProject: null,
    });
    prisma.dEvento.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          identificadorExterno: 'corr-1:notification:task.status.changed:1',
        },
      ]);

    await consumer.handle(event('task.status.changed', { taskId: '10' }));
    await consumer.handle(event('task.status.changed', { taskId: '10' }));

    expect(prisma.dEvento.createMany).toHaveBeenCalledTimes(1);
  });

  it('relanca erro do Prisma', async () => {
    prisma.dTask.findFirst.mockResolvedValue({
      chave: BigInt(10),
      nome: 'Task',
      idCreator: BigInt(1),
      idAssignee: null,
      idProject: null,
    });
    prisma.dEvento.createMany.mockRejectedValue(new Error('db down'));

    await expect(consumer.handle(event('task.status.changed', { taskId: '10' }))).rejects.toThrow(
      'db down',
    );
  });
});
