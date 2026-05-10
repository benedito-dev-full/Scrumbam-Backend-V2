import { Test, TestingModule } from '@nestjs/testing';
import { CreateTaskFromTextIntent } from '../create-task-from-text.intent';
import { InboundMessage } from '../../../core/channel-adapter.interface';
import { MessageRouterService } from '../../../core/message-router.service';
import { UserProjectService } from '../../../../projects/user-project.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { TelegramSendService } from '../../telegram-send.service';

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
  let userProjectService: jest.Mocked<Pick<UserProjectService, 'getDefaultProject'>>;

  const USER_ID = BigInt(100);
  const CHAT_ID = BigInt(123456789);
  const PROJECT_ID = BigInt(10);

  beforeEach(async () => {
    userProjectService = {
      getDefaultProject: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateTaskFromTextIntent,
        { provide: MessageRouterService, useValue: { registerIntentHandler: jest.fn() } },
        { provide: TasksService, useValue: { create: jest.fn() } },
        { provide: TelegramSendService, useValue: { sendMessage: jest.fn().mockResolvedValue(undefined) } },
        { provide: UserProjectService, useValue: userProjectService },
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
    it('deve retornar true para mensagem do tipo text com texto', () => {
      expect(intent.canHandle(makeMessage('text', 'Criar nova feature de login'))).toBe(true);
    });

    it('deve retornar false para mensagem do tipo command', () => {
      expect(intent.canHandle(makeMessage('command'))).toBe(false);
    });

    it('deve retornar false para mensagem do tipo voice', () => {
      expect(intent.canHandle(makeMessage('voice'))).toBe(false);
    });

    it('deve retornar false para text sem texto', () => {
      expect(intent.canHandle(makeMessage('text', undefined))).toBe(false);
      expect(intent.canHandle({ chatId: CHAT_ID, type: 'text', text: '' })).toBe(false);
    });
  });

  describe('handle()', () => {
    it('deve criar task com sucesso e enviar confirmacao', async () => {
      userProjectService.getDefaultProject.mockResolvedValue(PROJECT_ID);
      (tasksService.create as jest.Mock).mockResolvedValue(makeTaskResponse());

      await intent.handle(CHAT_ID, USER_ID, makeMessage('text', 'Criar nova feature de login'));

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

    it('deve enviar erro para texto muito curto', async () => {
      await intent.handle(CHAT_ID, USER_ID, makeMessage('text', 'ab'));

      expect(tasksService.create).not.toHaveBeenCalled();
      expect(telegramSend.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('curta'),
      );
    });

    it('deve enviar erro para texto muito longo', async () => {
      await intent.handle(CHAT_ID, USER_ID, makeMessage('text', 'a'.repeat(513)));

      expect(tasksService.create).not.toHaveBeenCalled();
      expect(telegramSend.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('longa'),
      );
    });

    it('deve enviar instrucao quando nenhum projeto encontrado', async () => {
      userProjectService.getDefaultProject.mockResolvedValue(null);

      await intent.handle(CHAT_ID, USER_ID, makeMessage('text', 'Criar nova feature'));

      expect(tasksService.create).not.toHaveBeenCalled();
      expect(telegramSend.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('Nenhum projeto encontrado'),
      );
    });

    it('deve delegar ao TasksService sem duplicar logica de negocio', async () => {
      userProjectService.getDefaultProject.mockResolvedValue(PROJECT_ID);
      (tasksService.create as jest.Mock).mockResolvedValue(makeTaskResponse());

      await intent.handle(CHAT_ID, USER_ID, makeMessage('text', 'Task via texto'));

      expect(tasksService.create).toHaveBeenCalledTimes(1);
      const [dto, creatorId] = (tasksService.create as jest.Mock).mock.calls[0];
      expect(dto.source).toBe('telegram');
      expect(dto.rawText).toBe('Task via texto');
      expect(creatorId).toBe(USER_ID);
    });

    it('deve enviar erro amigavel quando TasksService falha', async () => {
      userProjectService.getDefaultProject.mockResolvedValue(PROJECT_ID);
      (tasksService.create as jest.Mock).mockRejectedValue(new Error('DB offline'));

      await intent.handle(CHAT_ID, USER_ID, makeMessage('text', 'Task com falha'));

      expect(telegramSend.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('criar a tarefa'),
      );
    });

    it('deve incluir identifier DEV-N na confirmacao', async () => {
      userProjectService.getDefaultProject.mockResolvedValue(PROJECT_ID);
      (tasksService.create as jest.Mock).mockResolvedValue(makeTaskResponse());

      await intent.handle(CHAT_ID, USER_ID, makeMessage('text', 'Task com identifier'));

      expect(telegramSend.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('DEV-5'),
      );
    });
  });
});
