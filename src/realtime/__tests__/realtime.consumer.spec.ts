import { EventRouterService } from '../../eventos/core/event-router.service';
import type { IEvent } from '../../eventos/interfaces/event.interface';
import { RealtimeGateway } from '../realtime.gateway';
import { RealtimeConsumer, __REALTIME_TYPE_TO_WS_EVENT } from '../realtime.consumer';

describe('RealtimeConsumer', () => {
  let consumer: RealtimeConsumer;
  let gateway: { broadcast: jest.Mock };
  let eventRouter: { registerConsumer: jest.Mock };

  /** Monta um IEvent canônico mínimo com o payload informado. */
  function makeEvent(type: string, payload: Record<string, unknown>): IEvent {
    return {
      type,
      payload,
      correlationId: 'corr-1',
      metadata: { source: 'tasks.service', timestamp: '2026-06-04T00:00:00.000Z', correlationId: 'corr-1' },
    };
  }

  beforeEach(() => {
    gateway = { broadcast: jest.fn() };
    eventRouter = { registerConsumer: jest.fn() };
    consumer = new RealtimeConsumer(
      gateway as unknown as RealtimeGateway,
      eventRouter as unknown as EventRouterService,
    );
  });

  describe('onModuleInit', () => {
    it('registra o consumer no EventRouter via registerConsumer (dinâmico)', () => {
      consumer.onModuleInit();

      expect(eventRouter.registerConsumer).toHaveBeenCalledTimes(1);
      const [match, registered] = eventRouter.registerConsumer.mock.calls[0];
      expect(registered).toBe(consumer);
      // a match function cobre task.* e phase.*, mas não outros domínios
      expect(match('task.updated')).toBe(true);
      expect(match('phase.created')).toBe(true);
      expect(match('project.created')).toBe(false);
      expect(match('execution.low.created')).toBe(false);
    });
  });

  describe('handle — tasks normais', () => {
    it.each([
      ['task.created', 'task.created'],
      ['task.updated', 'task.updated'],
      ['task.status.changed', 'task.status.changed'],
      ['task.deleted', 'task.deleted'],
    ])('%s → broadcast com wsEvent %s, room list:{projectId} e envelope correto', async (type, wsEvent) => {
      await consumer.handle(
        makeEvent(type, { projectId: '7', taskId: '42', actorId: '99' }),
      );

      expect(gateway.broadcast).toHaveBeenCalledTimes(1);
      expect(gateway.broadcast).toHaveBeenCalledWith('list:7', wsEvent, {
        listId: '7',
        entityId: '42',
        actorId: '99',
      });
    });
  });

  describe('handle — fases (phase.* → block.*)', () => {
    it.each([
      ['phase.created', 'block.created'],
      ['phase.updated', 'block.updated'],
      ['phase.deleted', 'block.deleted'],
    ])('%s → broadcast com wsEvent %s e entityId de phaseId', async (type, wsEvent) => {
      await consumer.handle(
        makeEvent(type, { projectId: '7', phaseId: '500', actorId: '12' }),
      );

      expect(gateway.broadcast).toHaveBeenCalledWith('list:7', wsEvent, {
        listId: '7',
        entityId: '500',
        actorId: '12',
      });
    });
  });

  describe('handle — skips seguros', () => {
    it('NÃO faz broadcast quando falta projectId', async () => {
      await consumer.handle(makeEvent('task.updated', { taskId: '42', actorId: '99' }));
      expect(gateway.broadcast).not.toHaveBeenCalled();
    });

    it('NÃO faz broadcast quando falta entityId (sem taskId/phaseId)', async () => {
      await consumer.handle(makeEvent('task.updated', { projectId: '7', actorId: '99' }));
      expect(gateway.broadcast).not.toHaveBeenCalled();
    });

    it.each(['task.assigned', 'phase.completed', 'task.comment.created'])(
      'IGNORA evento não mapeado: %s',
      async (type) => {
        await consumer.handle(makeEvent(type, { projectId: '7', taskId: '42', actorId: '99' }));
        expect(gateway.broadcast).not.toHaveBeenCalled();
      },
    );
  });

  describe('handle — actorId vazio', () => {
    it('broadcast com actorId "" quando payload não tem actor/user/movedBy', async () => {
      await consumer.handle(makeEvent('task.updated', { projectId: '7', taskId: '42' }));

      expect(gateway.broadcast).toHaveBeenCalledWith('list:7', 'task.updated', {
        listId: '7',
        entityId: '42',
        actorId: '',
      });
    });

    it('usa userId como actorId quando actorId ausente', async () => {
      await consumer.handle(makeEvent('task.status.changed', { projectId: '7', taskId: '42', userId: '55' }));

      expect(gateway.broadcast).toHaveBeenCalledWith('list:7', 'task.status.changed', {
        listId: '7',
        entityId: '42',
        actorId: '55',
      });
    });

    it('usa movedBy como actorId quando actorId e userId ausentes', async () => {
      await consumer.handle(makeEvent('task.status.changed', { projectId: '7', taskId: '42', movedBy: '77' }));

      expect(gateway.broadcast).toHaveBeenCalledWith('list:7', 'task.status.changed', {
        listId: '7',
        entityId: '42',
        actorId: '77',
      });
    });
  });

  describe('mapa exportado', () => {
    it('cobre exatamente os 7 eventos do contrato', () => {
      expect(Object.keys(__REALTIME_TYPE_TO_WS_EVENT).sort()).toEqual(
        [
          'phase.created',
          'phase.deleted',
          'phase.updated',
          'task.created',
          'task.deleted',
          'task.status.changed',
          'task.updated',
        ].sort(),
      );
    });
  });
});
