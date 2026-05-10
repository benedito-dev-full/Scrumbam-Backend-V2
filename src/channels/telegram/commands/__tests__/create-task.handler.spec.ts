import { Test, TestingModule } from '@nestjs/testing';
import { CreateTaskHandler } from '../create-task.handler';
import { CommandRegistryService } from '../../../core/command-registry.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { PrismaService } from '../../../../prisma.service';

const makeTaskResponse = () => ({
  id: '1',
  identifier: 'DEV-1',
  nome: 'Revisar documentação',
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

describe('CreateTaskHandler', () => {
  let handler: CreateTaskHandler;
  let commandRegistry: jest.Mocked<CommandRegistryService>;
  let tasksService: jest.Mocked<TasksService>;
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
        CreateTaskHandler,
        {
          provide: CommandRegistryService,
          useValue: { register: jest.fn() },
        },
        {
          provide: TasksService,
          useValue: { create: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
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
    it('deve retornar erro quando título não informado', async () => {
      const reply = await handler.handle(CHAT_ID, USER_ID, []);
      expect(reply).toContain('Título muito curto');
    });

    it('deve retornar erro quando título muito curto (< 3 chars)', async () => {
      const reply = await handler.handle(CHAT_ID, USER_ID, ['ab']);
      expect(reply).toContain('Título muito curto');
    });

    it('deve retornar erro quando título muito longo (> 512 chars)', async () => {
      const titulo = 'a'.repeat(513);
      const reply = await handler.handle(CHAT_ID, USER_ID, [titulo]);
      expect(reply).toContain('muito longo');
    });

    it('deve retornar orientação quando nenhum projeto encontrado', async () => {
      prisma.dProject.findFirst.mockResolvedValue(null);

      const reply = await handler.handle(CHAT_ID, USER_ID, ['Revisar documentação']);

      expect(reply).toContain('Nenhum projeto encontrado');
    });

    it('deve criar task com sucesso e retornar confirmação', async () => {
      prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID });
      tasksService.create.mockResolvedValue(makeTaskResponse());

      const reply = await handler.handle(CHAT_ID, USER_ID, ['Revisar documentação']);

      expect(tasksService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          nome: 'Revisar documentação',
          projectId: PROJECT_ID.toString(),
          source: 'telegram',
        }),
        USER_ID,
      );
      expect(reply).toContain('Tarefa criada');
      expect(reply).toContain('DEV-1');
    });

    it('deve juntar múltiplos args como título completo', async () => {
      prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID });
      tasksService.create.mockResolvedValue(makeTaskResponse());

      await handler.handle(CHAT_ID, USER_ID, ['Revisar', 'a', 'documentação']);

      expect(tasksService.create).toHaveBeenCalledWith(
        expect.objectContaining({ nome: 'Revisar a documentação' }),
        USER_ID,
      );
    });

    it('deve delegar ao TasksService sem duplicar lógica de negócio', async () => {
      prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID });
      tasksService.create.mockResolvedValue(makeTaskResponse());

      await handler.handle(CHAT_ID, USER_ID, ['Tarefa de teste']);

      // Verifica que create foi chamado exatamente uma vez com os dados corretos
      expect(tasksService.create).toHaveBeenCalledTimes(1);
      const [dto, creatorId] = tasksService.create.mock.calls[0];
      expect(dto.source).toBe('telegram');
      expect(dto.assigneeId).toBe(USER_ID.toString());
      expect(creatorId).toBe(USER_ID);
    });

    it('deve retornar erro amigável quando TasksService falha', async () => {
      prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID });
      tasksService.create.mockRejectedValue(new Error('Falha no banco'));

      const reply = await handler.handle(CHAT_ID, USER_ID, ['Tarefa com erro']);

      expect(reply).toContain('Não foi possível criar');
    });

    it('deve buscar projeto associado ao usuário (idEstab = userId)', async () => {
      prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID });
      tasksService.create.mockResolvedValue(makeTaskResponse());

      await handler.handle(CHAT_ID, USER_ID, ['Test task']);

      // Primeira chamada busca por idEstab
      expect(prisma.dProject.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ idEstab: USER_ID }),
          orderBy: { chave: 'desc' },
        }),
      );
    });
  });
});
