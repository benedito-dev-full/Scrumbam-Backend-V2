import { WebhookConsumer } from '../webhook.consumer';
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

describe('WebhookConsumer', () => {
  const prisma = {
    dProject: { findFirst: jest.fn() },
    dTask: { findFirst: jest.fn() },
    dTabela: { findMany: jest.fn() },
  };
  const dispatcher = { dispatch: jest.fn() };

  let consumer: WebhookConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    consumer = new WebhookConsumer(prisma as never, dispatcher);
    prisma.dTabela.findMany.mockResolvedValue([]);
    dispatcher.dispatch.mockResolvedValue({ skipped: true, reason: 'stub' });
  });

  it('resolve org por orgId e chama dispatcher para match exato', async () => {
    prisma.dTabela.findMany.mockResolvedValue([
      {
        chave: BigInt(1),
        nome: 'Hook',
        idLocEscrituracao: BigInt(3),
        metaDados: { events: ['task.created'], active: true },
      },
    ]);

    await consumer.handle(event('task.created', { orgId: '3' }));

    expect(prisma.dTabela.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          idClasse: BigInt(-470),
          idLocEscrituracao: BigInt(3),
          excluido: false,
          inativo: false,
        },
      }),
    );
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });

  it('resolve org por projectId', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(3) });
    prisma.dTabela.findMany.mockResolvedValue([
      {
        chave: BigInt(1),
        nome: 'Hook',
        idLocEscrituracao: BigInt(3),
        metaDados: { events: ['project.*'] },
      },
    ]);

    await consumer.handle(event('project.updated', { projectId: '7' }));

    expect(prisma.dProject.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chave: BigInt(7), excluido: false } }),
    );
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });

  it('resolve org por taskId', async () => {
    prisma.dTask.findFirst.mockResolvedValue({ project: { idEstab: BigInt(3) } });
    prisma.dTabela.findMany.mockResolvedValue([
      {
        chave: BigInt(1),
        nome: 'Hook',
        idLocEscrituracao: BigInt(3),
        metaDados: { events: ['*'] },
      },
    ]);

    await consumer.handle(event('task.status.changed', { taskId: '10' }));

    expect(prisma.dTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chave: BigInt(10), excluido: false } }),
    );
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });

  it('faz skip sem org', async () => {
    await consumer.handle(event('task.created', {}));

    expect(prisma.dTabela.findMany).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('aplica matching *, prefixo e exato, ignorando nao-match e inactive meta', async () => {
    prisma.dTabela.findMany.mockResolvedValue([
      { chave: BigInt(1), nome: 'Any', idLocEscrituracao: BigInt(3), metaDados: { events: ['*'] } },
      {
        chave: BigInt(2),
        nome: 'Prefix',
        idLocEscrituracao: BigInt(3),
        metaDados: { events: ['task.*'] },
      },
      {
        chave: BigInt(3),
        nome: 'Exact',
        idLocEscrituracao: BigInt(3),
        metaDados: { events: ['task.created'] },
      },
      {
        chave: BigInt(4),
        nome: 'NoMatch',
        idLocEscrituracao: BigInt(3),
        metaDados: { events: ['project.*'] },
      },
      {
        chave: BigInt(5),
        nome: 'Inactive',
        idLocEscrituracao: BigInt(3),
        metaDados: { events: ['task.*'], active: false },
      },
    ]);

    await consumer.handle(event('task.created', { orgId: '3' }));

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(3);
  });

  it('nao chama dispatcher para config sem events valido', async () => {
    prisma.dTabela.findMany.mockResolvedValue([
      { chave: BigInt(1), nome: 'Hook', idLocEscrituracao: BigInt(3), metaDados: {} },
    ]);

    await consumer.handle(event('task.created', { orgId: '3' }));

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('relanca erro do dispatcher', async () => {
    prisma.dTabela.findMany.mockResolvedValue([
      {
        chave: BigInt(1),
        nome: 'Hook',
        idLocEscrituracao: BigInt(3),
        metaDados: { events: ['task.*'] },
      },
    ]);
    dispatcher.dispatch.mockRejectedValue(new Error('dispatcher failed'));

    await expect(consumer.handle(event('task.created', { orgId: '3' }))).rejects.toThrow(
      'dispatcher failed',
    );
  });

  it('bloqueia tipos de integracao interna', async () => {
    await consumer.handle(event('webhook.attempted', { orgId: '3' }));

    expect(prisma.dTabela.findMany).not.toHaveBeenCalled();
  });
});
