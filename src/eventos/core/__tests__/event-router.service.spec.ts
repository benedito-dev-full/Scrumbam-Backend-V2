import { EventRouterService } from '../event-router.service';
import type { IEvent } from '../../interfaces/event.interface';
import type { IEventConsumer } from '../../interfaces/consumer.interface';

function event(type: string): IEvent {
  return {
    type,
    payload: {},
    correlationId: 'corr-1',
    metadata: {
      source: 'spec',
      timestamp: '2026-05-10T00:00:00.000Z',
      correlationId: 'corr-1',
    },
  };
}

function consumer(name: string): IEventConsumer {
  return { name, handle: jest.fn() };
}

describe('EventRouterService', () => {
  const audit = consumer('audit-log');
  const notification = consumer('notification');
  const webhook = consumer('webhook');
  const router = new EventRouterService(audit as never, notification as never, webhook as never);

  it('sempre retorna audit', () => {
    expect(router.route(event('email.sent')).map((item) => item.name)).toEqual(['audit-log']);
  });

  it('adiciona notification para trigger configurado', () => {
    expect(router.route(event('execution.completed')).map((item) => item.name)).toEqual([
      'audit-log',
      'notification',
      'webhook',
    ]);
  });

  it('adiciona webhook para trigger permitido', () => {
    expect(router.route(event('project.updated')).map((item) => item.name)).toEqual([
      'audit-log',
      'webhook',
    ]);
  });

  it('adiciona notification e webhook quando ambos aplicam', () => {
    expect(router.route(event('task.status.changed')).map((item) => item.name)).toEqual([
      'audit-log',
      'notification',
      'webhook',
    ]);
  });

  it('blacklist nao chama webhook', () => {
    expect(router.route(event('webhook.attempted')).map((item) => item.name)).toEqual([
      'audit-log',
    ]);
  });
});
