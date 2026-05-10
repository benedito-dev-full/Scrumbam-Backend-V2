import { Test, TestingModule } from '@nestjs/testing';
import { StatusHandler } from '../status.handler';
import { CommandRegistryService } from '../../../core/command-registry.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { PrismaService } from '../../../../prisma.service';

const makeEmptyResult = () => ({
  items: [],
  pagination: { hasMore: false, nextCursor: null },
});

const makeResultWith = (count: number, hasMore = false) => ({
  items: Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    identifier: `DEV-${i + 1}`,
    nome: `Task ${i + 1}`,
    status: 'INBOX',
    projectId: '1',
    descricao: null,
    priority: null,
    assigneeId: '100',
    sprintId: null,
    dados: null,
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  })),
  pagination: { hasMore, nextCursor: hasMore ? '99' : null },
});

describe('StatusHandler', () => {
  let handler: StatusHandler;
  let commandRegistry: jest.Mocked<CommandRegistryService>;
  let tasksService: jest.Mocked<TasksService>;
  let prisma: { dVincula: { findFirst: jest.Mock } };

  const USER_ID = BigInt(100);
  const CHAT_ID = BigInt(123456789);

  beforeEach(async () => {
    prisma = {
      dVincula: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatusHandler,
        {
          provide: CommandRegistryService,
          useValue: { register: jest.fn() },
        },
        {
          provide: TasksService,
          useValue: { findMany: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    handler = module.get(StatusHandler);
    commandRegistry = module.get(CommandRegistryService);
    tasksService = module.get(TasksService);
  });

  it('deve instanciar corretamente', () => {
    expect(handler).toBeDefined();
  });

  it('deve ter commandName = "status"', () => {
    expect(handler.commandName).toBe('status');
  });

  it('deve se registrar no CommandRegistryService em onModuleInit', () => {
    handler.onModuleInit();
    expect(commandRegistry.register).toHaveBeenCalledWith(handler);
  });

  describe('handle()', () => {
    it('deve exibir status de pareamento e contagens', async () => {
      tasksService.findMany
        .mockResolvedValueOnce(makeResultWith(5))  // INBOX
        .mockResolvedValueOnce(makeResultWith(2));  // EXECUTING

      prisma.dVincula.findFirst.mockResolvedValue({
        metaDados: {
          channelName: 'telegram',
          chatId: CHAT_ID.toString(),
          linkedAt: new Date('2026-05-01').toISOString(),
        },
      });

      const reply = await handler.handle(CHAT_ID, USER_ID, []);

      expect(reply).toContain('pareado');
      expect(reply).toContain('5');
      expect(reply).toContain('2');
    });

    it('deve mostrar "data desconhecida" quando link não encontrado', async () => {
      tasksService.findMany.mockResolvedValue(makeEmptyResult());
      prisma.dVincula.findFirst.mockResolvedValue(null);

      const reply = await handler.handle(CHAT_ID, USER_ID, []);

      expect(reply).toContain('data desconhecida');
    });

    it('deve executar as queries de INBOX e EXECUTING em paralelo', async () => {
      tasksService.findMany.mockResolvedValue(makeEmptyResult());
      prisma.dVincula.findFirst.mockResolvedValue(null);

      await handler.handle(CHAT_ID, USER_ID, []);

      // findMany deve ter sido chamado duas vezes (INBOX + EXECUTING)
      expect(tasksService.findMany).toHaveBeenCalledTimes(2);

      const calls = tasksService.findMany.mock.calls;
      const statuses = calls.map((c) => c[0].status);
      expect(statuses).toContain('INBOX');
      expect(statuses).toContain('EXECUTING');
    });

    it('deve exibir "100+" quando hasMore=true', async () => {
      tasksService.findMany
        .mockResolvedValueOnce(makeResultWith(1, true))  // INBOX com hasMore
        .mockResolvedValueOnce(makeEmptyResult());

      prisma.dVincula.findFirst.mockResolvedValue(null);

      const reply = await handler.handle(CHAT_ID, USER_ID, []);

      expect(reply).toContain('100+');
    });

    it('deve retornar erro amigável quando service falha', async () => {
      tasksService.findMany.mockRejectedValue(new Error('DB offline'));

      const reply = await handler.handle(CHAT_ID, USER_ID, []);

      expect(reply).toContain('Não foi possível');
    });

    it('deve ignorar args extras', async () => {
      tasksService.findMany.mockResolvedValue(makeEmptyResult());
      prisma.dVincula.findFirst.mockResolvedValue(null);

      const reply = await handler.handle(CHAT_ID, USER_ID, ['arg-ignorado']);

      expect(typeof reply).toBe('string');
      expect(reply).toContain('pareado');
    });
  });
});
