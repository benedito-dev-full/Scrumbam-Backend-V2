import { Test, TestingModule } from '@nestjs/testing';
import { CreateTaskHandler } from '../create-task.handler';
import { CommandRegistryService } from '../../../core/command-registry.service';
import { UserProjectService } from '../../../../projects/user-project.service';
import { TasksService } from '../../../../tasks/tasks.service';

const makeTaskResponse = () => ({
  id: '1',
  identifier: 'DEV-1',
  nome: 'Revisar documentacao',
  status: 'INBOX',
  projectId: '10',
  descricao: null,
  priority: null,
  taskType: null,
  assigneeId: '100',
  sprintId: null,
  dados: null,
  criadoEm: new Date().toISOString(),
  atualizadoEm: new Date().toISOString(),
});

describe('CreateTaskHandler', () => {
  let handler: CreateTaskHandler;
  let commandRegistry: jest.Mocked<CommandRegistryService>;
  let tasksService: jest.Mocked<TasksService>;
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
        CreateTaskHandler,
        { provide: CommandRegistryService, useValue: { register: jest.fn() } },
        { provide: TasksService, useValue: { create: jest.fn() } },
        { provide: UserProjectService, useValue: userProjectService },
      ],
    }).compile();

    handler = module.get(CreateTaskHandler);
    commandRegistry = module.get(CommandRegistryService);
    tasksService = module.get(TasksService);
  });

  it('deve instanciar corretamente', () => {
    expect(handler).toBeDefined();
  });

  it('deve ter commandName = "create"', () => {
    expect(handler.commandName).toBe('create');
  });

  it('deve se registrar no CommandRegistryService em onModuleInit', () => {
    handler.onModuleInit();
    expect(commandRegistry.register).toHaveBeenCalledWith(handler);
  });

  describe('handle()', () => {
    it('deve retornar erro quando titulo nao informado', async () => {
      const reply = await handler.handle(CHAT_ID, USER_ID, []);
      expect(reply).toContain('muito curto');
    });

    it('deve retornar erro quando titulo muito curto', async () => {
      const reply = await handler.handle(CHAT_ID, USER_ID, ['ab']);
      expect(reply).toContain('muito curto');
    });

    it('deve retornar erro quando titulo muito longo', async () => {
      const reply = await handler.handle(CHAT_ID, USER_ID, ['a'.repeat(513)]);
      expect(reply).toContain('muito longo');
    });

    it('deve retornar orientacao quando nenhum projeto encontrado', async () => {
      userProjectService.getDefaultProject.mockResolvedValue(null);

      const reply = await handler.handle(CHAT_ID, USER_ID, ['Revisar documentacao']);

      expect(reply).toContain('Nenhum projeto encontrado');
      expect(tasksService.create).not.toHaveBeenCalled();
    });

    it('deve criar task com sucesso e retornar confirmacao', async () => {
      userProjectService.getDefaultProject.mockResolvedValue(PROJECT_ID);
      tasksService.create.mockResolvedValue(makeTaskResponse());

      const reply = await handler.handle(CHAT_ID, USER_ID, ['Revisar documentacao']);

      expect(tasksService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          nome: 'Revisar documentacao',
          projectId: PROJECT_ID.toString(),
          source: 'telegram',
        }),
        USER_ID,
      );
      expect(reply).toContain('Tarefa criada');
      expect(reply).toContain('DEV-1');
    });

    it('deve juntar multiplos args como titulo completo', async () => {
      userProjectService.getDefaultProject.mockResolvedValue(PROJECT_ID);
      tasksService.create.mockResolvedValue(makeTaskResponse());

      await handler.handle(CHAT_ID, USER_ID, ['Revisar', 'a', 'documentacao']);

      expect(tasksService.create).toHaveBeenCalledWith(
        expect.objectContaining({ nome: 'Revisar a documentacao' }),
        USER_ID,
      );
    });

    it('deve delegar ao TasksService sem duplicar logica de negocio', async () => {
      userProjectService.getDefaultProject.mockResolvedValue(PROJECT_ID);
      tasksService.create.mockResolvedValue(makeTaskResponse());

      await handler.handle(CHAT_ID, USER_ID, ['Tarefa de teste']);

      expect(tasksService.create).toHaveBeenCalledTimes(1);
      const [dto, creatorId] = tasksService.create.mock.calls[0];
      expect(dto.source).toBe('telegram');
      expect(dto.assigneeId).toBe(USER_ID.toString());
      expect(creatorId).toBe(USER_ID);
    });

    it('deve retornar erro amigavel quando TasksService falha', async () => {
      userProjectService.getDefaultProject.mockResolvedValue(PROJECT_ID);
      tasksService.create.mockRejectedValue(new Error('Falha no banco'));

      const reply = await handler.handle(CHAT_ID, USER_ID, ['Tarefa com erro']);

      expect(reply).toContain('criar a tarefa');
    });

    it('deve buscar projeto padrao via UserProjectService', async () => {
      userProjectService.getDefaultProject.mockResolvedValue(PROJECT_ID);
      tasksService.create.mockResolvedValue(makeTaskResponse());

      await handler.handle(CHAT_ID, USER_ID, ['Test task']);

      expect(userProjectService.getDefaultProject).toHaveBeenCalledWith(USER_ID);
    });
  });
});
