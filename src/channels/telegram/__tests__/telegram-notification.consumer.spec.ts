import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TelegramNotificationConsumer } from '../telegram-notification.consumer';
import { PrismaService } from '../../../prisma.service';
import { AccountLinkService } from '../../core/account-link.service';
import { TelegramSendService } from '../telegram-send.service';
import { EventRouterService } from '../../../eventos/core/event-router.service';
import type { IEvent } from '../../../eventos/interfaces/event.interface';

function makeEvent(overrides?: Partial<IEvent>): IEvent {
  return {
    type: 'phase.completed',
    payload: { phaseId: '42', projectId: '123', percent: 100, total: 5, done: 5 },
    correlationId: 'corr-xyz',
    metadata: {
      source: 'tasks.service',
      timestamp: '2026-05-21T00:00:00.000Z',
      correlationId: 'corr-xyz',
    },
    ...overrides,
  };
}

describe('TelegramNotificationConsumer', () => {
  let consumer: TelegramNotificationConsumer;
  let prisma: {
    dTask: { findUnique: jest.Mock; findMany: jest.Mock };
    dVincula: { findMany: jest.Mock };
    dEvento: { findMany: jest.Mock; createMany: jest.Mock };
  };
  let accountLink: { findChatByUser: jest.Mock };
  let telegramSend: { sendMessage: jest.Mock };
  let configService: { get: jest.Mock };
  let eventRouter: { registerConsumer: jest.Mock };

  beforeEach(async () => {
    prisma = {
      dTask: { findUnique: jest.fn(), findMany: jest.fn() },
      dVincula: { findMany: jest.fn() },
      dEvento: { findMany: jest.fn(), createMany: jest.fn() },
    };
    accountLink = { findChatByUser: jest.fn() };
    telegramSend = { sendMessage: jest.fn() };
    configService = { get: jest.fn() };
    eventRouter = { registerConsumer: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramNotificationConsumer,
        { provide: PrismaService, useValue: prisma },
        { provide: AccountLinkService, useValue: accountLink },
        { provide: TelegramSendService, useValue: telegramSend },
        { provide: ConfigService, useValue: configService },
        { provide: EventRouterService, useValue: eventRouter },
      ],
    }).compile();

    consumer = module.get(TelegramNotificationConsumer);
  });

  it('deve auto-registrar no EventRouter em onModuleInit', () => {
    consumer.onModuleInit();
    expect(eventRouter.registerConsumer).toHaveBeenCalledTimes(1);
    const [match, registered] = eventRouter.registerConsumer.mock.calls[0];
    expect(typeof match).toBe('function');
    expect(match('phase.completed')).toBe(true);
    expect(match('task.created')).toBe(false);
    expect(registered).toBe(consumer);
  });

  it('deve ignorar eventos que não sejam phase.completed', async () => {
    await consumer.handle(makeEvent({ type: 'task.created' }));
    expect(prisma.dTask.findUnique).not.toHaveBeenCalled();
    expect(telegramSend.sendMessage).not.toHaveBeenCalled();
  });

  it('deve enviar mensagem e persistir DEvento -494 para destinatário pareado', async () => {
    prisma.dTask.findUnique.mockResolvedValue({
      chave: BigInt(42),
      nome: 'Fase Discovery',
      idCreator: BigInt(1),
      idProject: BigInt(123),
      project: { chave: BigInt(123), idEstab: BigInt(999), nome: 'Projeto X' },
    });
    prisma.dTask.findMany.mockResolvedValue([{ idAssignee: BigInt(2) }]);
    prisma.dVincula.findMany.mockResolvedValue([
      { idEntidade: BigInt(1) },
      { idEntidade: BigInt(2) },
    ]);
    prisma.dEvento.findMany.mockResolvedValue([]);
    accountLink.findChatByUser
      .mockResolvedValueOnce(BigInt(1001))
      .mockResolvedValueOnce(BigInt(1002));
    configService.get.mockImplementation((k: string) =>
      k === 'TELEGRAM_BOT_TOKEN' ? 'fake-token' : undefined,
    );
    telegramSend.sendMessage.mockResolvedValue(undefined);
    prisma.dEvento.createMany.mockResolvedValue({ count: 2 });

    await consumer.handle(makeEvent());

    expect(telegramSend.sendMessage).toHaveBeenCalledTimes(2);
    expect(prisma.dEvento.createMany).toHaveBeenCalledTimes(1);
    const data = prisma.dEvento.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
    expect(data[0].idClasse).toBe(BigInt(-494));
    expect((data[0].metaDados as Record<string, unknown>).success).toBe(true);
  });

  it('deve ser idempotente — destinatários já enviados são pulados', async () => {
    prisma.dTask.findUnique.mockResolvedValue({
      chave: BigInt(42),
      nome: 'Fase X',
      idCreator: BigInt(1),
      idProject: BigInt(123),
      project: { chave: BigInt(123), idEstab: BigInt(999), nome: 'P' },
    });
    prisma.dTask.findMany.mockResolvedValue([]);
    prisma.dVincula.findMany.mockResolvedValue([{ idEntidade: BigInt(1) }]);
    // Já tem DEvento -494 para esse correlationId+recipient
    prisma.dEvento.findMany.mockResolvedValue([
      { identificadorExterno: 'corr-xyz:phase.completed:1' },
    ]);

    await consumer.handle(makeEvent());

    expect(telegramSend.sendMessage).not.toHaveBeenCalled();
    expect(prisma.dEvento.createMany).not.toHaveBeenCalled();
  });

  it('deve fazer skip silencioso quando TELEGRAM_BOT_TOKEN ausente', async () => {
    prisma.dTask.findUnique.mockResolvedValue({
      chave: BigInt(42),
      nome: 'Fase X',
      idCreator: BigInt(1),
      idProject: BigInt(123),
      project: { chave: BigInt(123), idEstab: BigInt(999), nome: 'P' },
    });
    prisma.dTask.findMany.mockResolvedValue([]);
    prisma.dVincula.findMany.mockResolvedValue([{ idEntidade: BigInt(1) }]);
    prisma.dEvento.findMany.mockResolvedValue([]);
    accountLink.findChatByUser.mockResolvedValue(BigInt(1001));
    configService.get.mockReturnValue(undefined); // token ausente
    prisma.dEvento.createMany.mockResolvedValue({ count: 1 });

    await consumer.handle(makeEvent());

    expect(telegramSend.sendMessage).not.toHaveBeenCalled();
    // Mas persiste DEvento com error='token_missing'
    expect(prisma.dEvento.createMany).toHaveBeenCalledTimes(1);
    const data = prisma.dEvento.createMany.mock.calls[0][0].data;
    expect((data[0].metaDados as Record<string, unknown>).error).toBe('token_missing');
    expect((data[0].metaDados as Record<string, unknown>).success).toBe(false);
  });

  it('deve filtrar destinatários fora da org (tenant scope ADR-V2-042)', async () => {
    prisma.dTask.findUnique.mockResolvedValue({
      chave: BigInt(42),
      nome: 'F',
      idCreator: BigInt(1),
      idProject: BigInt(123),
      project: { chave: BigInt(123), idEstab: BigInt(999), nome: 'P' },
    });
    prisma.dTask.findMany.mockResolvedValue([
      { idAssignee: BigInt(2) },
      { idAssignee: BigInt(99) }, // fora da org
    ]);
    // DVincula só retorna 1 e 2 — 99 não tem membership
    prisma.dVincula.findMany.mockResolvedValue([
      { idEntidade: BigInt(1) },
      { idEntidade: BigInt(2) },
    ]);
    prisma.dEvento.findMany.mockResolvedValue([]);
    accountLink.findChatByUser.mockResolvedValue(BigInt(1001));
    configService.get.mockImplementation((k: string) =>
      k === 'TELEGRAM_BOT_TOKEN' ? 'token' : undefined,
    );
    telegramSend.sendMessage.mockResolvedValue(undefined);
    prisma.dEvento.createMany.mockResolvedValue({ count: 2 });

    await consumer.handle(makeEvent());

    // Apenas 2 destinatários enviados (1 e 2), não 3
    expect(telegramSend.sendMessage).toHaveBeenCalledTimes(2);
    const data = prisma.dEvento.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
  });

  it('deve persistir DEvento com error=timeout quando sendMessage estoura timeout', async () => {
    jest.useFakeTimers();
    try {
      prisma.dTask.findUnique.mockResolvedValue({
        chave: BigInt(42),
        nome: 'F',
        idCreator: BigInt(1),
        idProject: BigInt(123),
        project: { chave: BigInt(123), idEstab: BigInt(999), nome: 'P' },
      });
      prisma.dTask.findMany.mockResolvedValue([]);
      prisma.dVincula.findMany.mockResolvedValue([{ idEntidade: BigInt(1) }]);
      prisma.dEvento.findMany.mockResolvedValue([]);
      accountLink.findChatByUser.mockResolvedValue(BigInt(1001));
      configService.get.mockImplementation((k: string) =>
        k === 'TELEGRAM_BOT_TOKEN' ? 'token' : undefined,
      );
      // sendMessage NUNCA resolve — Promise.race deve preferir o timeout 3s
      telegramSend.sendMessage.mockImplementation(() => new Promise(() => {}));
      prisma.dEvento.createMany.mockResolvedValue({ count: 1 });

      const handlePromise = consumer.handle(makeEvent());
      // Avança 3001ms para disparar o setTimeout do timer interno
      await jest.advanceTimersByTimeAsync(3001);
      await handlePromise;

      expect(prisma.dEvento.createMany).toHaveBeenCalledTimes(1);
      const data = prisma.dEvento.createMany.mock.calls[0][0].data;
      expect((data[0].metaDados as Record<string, unknown>).error).toBe('timeout');
      expect((data[0].metaDados as Record<string, unknown>).success).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('deve persistir DEvento com error=no_chat_link quando usuário não pareou Telegram', async () => {
    prisma.dTask.findUnique.mockResolvedValue({
      chave: BigInt(42),
      nome: 'F',
      idCreator: BigInt(1),
      idProject: BigInt(123),
      project: { chave: BigInt(123), idEstab: BigInt(999), nome: 'P' },
    });
    prisma.dTask.findMany.mockResolvedValue([]);
    prisma.dVincula.findMany.mockResolvedValue([{ idEntidade: BigInt(1) }]);
    prisma.dEvento.findMany.mockResolvedValue([]);
    accountLink.findChatByUser.mockResolvedValue(null); // não pareou
    configService.get.mockImplementation((k: string) =>
      k === 'TELEGRAM_BOT_TOKEN' ? 'token' : undefined,
    );
    prisma.dEvento.createMany.mockResolvedValue({ count: 1 });

    await consumer.handle(makeEvent());

    expect(telegramSend.sendMessage).not.toHaveBeenCalled();
    const data = prisma.dEvento.createMany.mock.calls[0][0].data;
    expect((data[0].metaDados as Record<string, unknown>).error).toBe('no_chat_link');
  });

  it('deve retornar silenciosamente quando phaseId payload é inválido', async () => {
    await consumer.handle(makeEvent({ payload: { phaseId: 'not-a-number' } }));
    expect(prisma.dTask.findUnique).not.toHaveBeenCalled();
  });

  it('NÃO deve relançar erro quando handlePhaseCompleted falha (defensivo)', async () => {
    prisma.dTask.findUnique.mockRejectedValue(new Error('db offline'));

    await expect(consumer.handle(makeEvent())).resolves.toBeUndefined();
  });
});
