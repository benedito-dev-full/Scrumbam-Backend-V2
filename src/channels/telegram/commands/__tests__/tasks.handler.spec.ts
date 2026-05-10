import { Test, TestingModule } from '@nestjs/testing';
import { TasksHandler } from '../tasks.handler';
import { CommandRegistryService } from '../../../core/command-registry.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { TimezoneService } from '../../../../common/services/timezone.service';

const makeTask = (overrides: Partial<{
  id: string;
  identifier: string;
  nome: string;
  status: string;
  criadoEm: string;
}> = {}) => ({
  id: '1',
  identifier: 'DEV-1',
  nome: 'Task de teste',
  status: 'INBOX',
  projectId: '1',
  descricao: null,
  priority: null,
  assigneeId: '100',
  sprintId: null,
  dados: null,
  criadoEm: new Date().toISOString(),
  atualizadoEm: new Date().toISOString(),
  ...overrides,
});

describe('TasksHandler', () => {
  let handler: TasksHandler;
  let commandRegistry: jest.Mocked<CommandRegistryService>;
  let tasksService: jest.Mocked<TasksService>;

  const USER_ID = BigInt(100);
  const CHAT_ID = BigInt(123456789);

  const makeEmptyResult = () => ({
    items: [],
    pagination: { hasMore: false, nextCursor: null },
  });

  const makeResultWith = (tasks: ReturnType<typeof makeTask>[]) => ({
    items: tasks,
    pagination: { hasMore: false, nextCursor: null },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksHandler,
        {
          provide: CommandRegistryService,
          useValue: { register: jest.fn() },
        },
        {
          provide: TasksService,
          useValue: { findMany: jest.fn() },
        },
        TimezoneService,
      ],
    }).compile();

    handler = module.get(TasksHandler);
    commandRegistry = module.get(CommandRegistryService);
    tasksService = module.get(TasksService);
  });

  it('deve instanciar corretamente', () => {
    expect(handler).toBeDefined();
  });

  it('deve ter commandName = "tasks"', () => {
    expect(handler.commandName).toBe('tasks');
  });

  it('deve se registrar no CommandRegistryService em onModuleInit', () => {
    handler.onModuleInit();
    expect(commandRegistry.register).toHaveBeenCalledWith(handler);
  });

  describe('handle() — período backlog (default)', () => {
    it('deve listar tarefas em INBOX quando sem args (backlog default)', async () => {
      tasksService.findMany.mockResolvedValue(makeResultWith([makeTask()]));

      const reply = await handler.handle(CHAT_ID, USER_ID, []);

      expect(tasksService.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeId: USER_ID.toString(), statuses: ['INBOX', 'READY'] }),
      );
      expect(reply).toContain('backlog');
      expect(reply).toContain('DEV-1');
    });

    it('deve retornar mensagem de backlog vazio quando sem tarefas', async () => {
      tasksService.findMany.mockResolvedValue(makeEmptyResult());

      const reply = await handler.handle(CHAT_ID, USER_ID, []);

      expect(reply).toContain('backlog');
      expect(reply).toContain('/create');
    });
  });

  describe('handle() — período today', () => {
    it('deve filtrar tarefas criadas hoje (TimezoneService)', async () => {
      const hoje = new Date();
      const task = makeTask({ criadoEm: hoje.toISOString() });
      tasksService.findMany.mockResolvedValue(makeResultWith([task]));

      const reply = await handler.handle(CHAT_ID, USER_ID, ['today']);

      expect(tasksService.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeId: USER_ID.toString() }),
      );
      expect(reply).toContain('hoje');
    });

    it('deve excluir tarefas antigas quando period=today', async () => {
      const antigua = makeTask({
        criadoEm: new Date('2020-01-01').toISOString(),
      });
      tasksService.findMany.mockResolvedValue(makeResultWith([antigua]));

      const reply = await handler.handle(CHAT_ID, USER_ID, ['today']);

      // Tarefa antiga não deve aparecer na lista
      expect(reply).toContain('hoje');
      expect(reply).not.toContain('DEV-1');
    });

    it('deve aceitar alias "hoje" para today', async () => {
      tasksService.findMany.mockResolvedValue(makeEmptyResult());

      const reply = await handler.handle(CHAT_ID, USER_ID, ['hoje']);

      expect(reply).toContain('hoje');
    });
  });

  describe('handle() — período week', () => {
    it('deve filtrar tarefas desta semana', async () => {
      const agora = new Date();
      const task = makeTask({ criadoEm: agora.toISOString() });
      tasksService.findMany.mockResolvedValue(makeResultWith([task]));

      const reply = await handler.handle(CHAT_ID, USER_ID, ['week']);

      expect(reply).toContain('semana');
    });

    it('deve aceitar alias "semana" para week', async () => {
      tasksService.findMany.mockResolvedValue(makeEmptyResult());

      const reply = await handler.handle(CHAT_ID, USER_ID, ['semana']);

      expect(reply).toContain('semana');
    });
  });

  describe('handle() — erros', () => {
    it('deve retornar mensagem de erro amigável quando TasksService falha', async () => {
      tasksService.findMany.mockRejectedValue(new Error('Conexão perdida'));

      const reply = await handler.handle(CHAT_ID, USER_ID, []);

      expect(reply).toContain('Não foi possível');
    });
  });

  describe('handle() — emojis de status', () => {
    it('deve exibir emoji correto para status INBOX', async () => {
      tasksService.findMany.mockResolvedValue(
        makeResultWith([makeTask({ status: 'INBOX' })]),
      );

      const reply = await handler.handle(CHAT_ID, USER_ID, ['backlog']);

      expect(reply).toContain('📥');
    });

    it('deve exibir emoji correto para status DONE', async () => {
      const hoje = new Date();
      tasksService.findMany.mockResolvedValue(
        makeResultWith([makeTask({ status: 'DONE', criadoEm: hoje.toISOString() })]),
      );

      const reply = await handler.handle(CHAT_ID, USER_ID, ['today']);

      expect(reply).toContain('✅');
    });
  });
});
