import { Test, TestingModule } from '@nestjs/testing';
import { CreateTaskFromTextIntent } from '../create-task-from-text.intent';
import { MessageRouterService } from '../../../core/message-router.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { TelegramSendService } from '../../telegram-send.service';
import { PrismaService } from '../../../../prisma.service';
import { InboundMessage } from '../../../core/channel-adapter.interface';

const makeTaskResponse = () => ({
  id: '1',
  identifier: 'DEV-5',
  nome: 'Task criada via texto',
  status: 'INBOX',
  projectId: '10',
  descricao: null,
  priority: null,
  assigneeId: '100',
  sprintId: null,
  dados: null,
  criadoEm: new Date().toISOString(),
  atualizadoEm: new Date().toISOString(),
});

const makeMessage = (
  type: 'text' | 'command' | 'voice',
  text?: string,
): InboundMessage => ({
  chatId: BigInt(123456789),
  type,
  text,
  commandName: type === 'command' ? 'tasks' : undefined,
  commandArgs: type === 'command' ? [] : undefined,
});

describe('CreateTaskFromTextIntent', () => {
  let intent: CreateTaskFromTextIntent;
  let messageRouterService: jest.Mocked<Pick<MessageRouterService, 'registerIntentHandler'>>;
  let tasksService: jest.Mocked<Pick<TasksService, 'create'>>;
  let telegramSend: jest.Mocked<Pick<TelegramSendService, 'sendMessage'>>;
  let prisma: { dProject: { findFirst: jest.Mock } };

  const USER_ID = BigInt(100);
  const CHAT_ID = BigInt(123456789);
  const PROJECT_ID = BigInt(10);

  beforeEach(async () => {
    prisma = {
      dProject: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateTaskFromTextIntent,
        {
          provide: MessageRouterService,
          useValue: { registerIntentHandler: jest.fn() },
        },
        {
          provide: TasksService,
          useValue: { create: jest.fn() },
        },
        {
          provide: TelegramSendService,
          useValue: { sendMessage: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    intent = module.get(CreateTaskFromTextIntent);
    messageRouterService = module.get(MessageRouterService);
    tasksService = module.get(TasksService);
    telegramSend = module.get(TelegramSendService);
  });

  it('deve instanciar corretamente', () => {
    expect(intent).toBeDefined();
  });

  it('deve ter intentName = "create_task_from_text"', () => {
    expect(intent.intentName).toBe('create_task_from_text');
  });

  it('deve se registrar no MessageRouterService em onModuleInit', () => {
    intent.onModuleInit();
    expect(messageRouterService.registerIntentHandler).toHaveBeenCalledWith(intent);
  });

  describe('canHandle()', () => {
    it('deve retornar true para mensagem do tipo "text" com texto', () => {
      const message = makeMessage('text', 'Criar nova feature de login');
      expect(intent.canHandle(message)).toBe(true);
    });

    it('deve retornar false para mensagem do tipo "command"', () => {
      const message = makeMessage('command');
      expect(intent.canHandle(message)).toBe(false);
    });

    it('deve retornar false para mensagem do tipo "voice"', () => {
      const message = makeMessage('voice');
      expect(intent.canHandle(message)).toBe(false);
    });

    it('deve retornar false para text sem texto (undefined)', () => {
      const message = makeMessage('text', undefined);
      expect(intent.canHandle(message)).toBe(false);
    });

    it('deve retornar false para text vazio ""', () => {
      const message: InboundMessage = {
        chatId: CHAT_ID,
        type: 'text',
        text: '',
      };
      expect(intent.canHandle(message)).toBe(false);
    });
  });

  describe('handle()', () => {
    it('deve criar task com sucesso e enviar confirmação', async () => {
      prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID });
      (tasksService.create as jest.Mock).mockResolvedValue(makeTaskResponse());

      const message = makeMessage('text', 'Criar nova feature de login');
      await intent.handle(CHAT_ID, USER_ID, message);

      expect(tasksService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          nome: 'Criar nova feature de login',
          projectId: PROJECT_ID.toString(),
          source: 'telegram',
        }),
        USER_ID,
      );
      expect(telegramSend.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('Tarefa criada'),
      );
    });

    it('deve enviar erro para texto muito curto (< 3 chars)', async () => {
      const message = makeMessage('text', 'ab');
      await intent.handle(CHAT_ID, USER_ID, message);

      expect(tasksService.create).not.toHaveBeenCalled();
      expect(telegramSend.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('curta'),
      );
    });

    it('deve enviar erro para texto muito longo (> 512 chars)', async () => {
      const message = makeMessage('text', 'a'.repeat(513));
      await intent.handle(CHAT_ID, USER_ID, message);

      expect(tasksService.create).not.toHaveBeenCalled();
      expect(telegramSend.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('longa'),
      );
    });

    it('deve enviar instrução quando nenhum projeto encontrado', async () => {
      prisma.dProject.findFirst.mockResolvedValue(null);

      const message = makeMessage('text', 'Criar nova feature');
      await intent.handle(CHAT_ID, USER_ID, message);

      expect(tasksService.create).not.toHaveBeenCalled();
      expect(telegramSend.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('Nenhum projeto encontrado'),
      );
    });

    it('deve delegar ao TasksService sem duplicar lógica de negócio', async () => {
      prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID });
      (tasksService.create as jest.Mock).mockResolvedValue(makeTaskResponse());

      const message = makeMessage('text', 'Task via texto');
      await intent.handle(CHAT_ID, USER_ID, message);

      // create chamado exatamente uma vez com source=telegram
      expect(tasksService.create).toHaveBeenCalledTimes(1);
      const [dto, creatorId] = (tasksService.create as jest.Mock).mock.calls[0];
      expect(dto.source).toBe('telegram');
      expect(dto.rawText).toBe('Task via texto');
      expect(creatorId).toBe(USER_ID);
    });

    it('deve enviar erro amigável quando TasksService falha', async () => {
      prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID });
      (tasksService.create as jest.Mock).mockRejectedValue(new Error('DB offline'));

      const message = makeMessage('text', 'Task com falha');
      await intent.handle(CHAT_ID, USER_ID, message);

      expect(telegramSend.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('Não foi possível'),
      );
    });

    it('deve incluir identifier DEV-N na confirmação', async () => {
      prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID });
      (tasksService.create as jest.Mock).mockResolvedValue(makeTaskResponse());

      const message = makeMessage('text', 'Task com identifier');
      await intent.handle(CHAT_ID, USER_ID, message);

      expect(telegramSend.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('DEV-5'),
      );
    });
  });
});
