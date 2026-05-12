import { McpRouterService } from '../services/mcp-router.service';
import { CreateTaskTool } from '../tools/create-task.tool';
import { ListProjectsTool } from '../tools/list-projects.tool';
import { ListSprintsTool } from '../tools/list-sprints.tool';
import { ListTasksTool } from '../tools/list-tasks.tool';
import { UpdateStatusTool } from '../tools/update-status.tool';

describe('MCP Bloco B tools', () => {
  const unsafeId = '9007199254740993';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740995'),
    scopes: ['tools:read', 'tools:write'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  let tasksService: {
    findMany: jest.Mock;
    create: jest.Mock;
    findOne: jest.Mock;
    updateStatus: jest.Mock;
  };
  let projectsService: {
    findMany: jest.Mock;
    findAccessibleProjectIds: jest.Mock;
    findOne: jest.Mock;
  };
  let tabelaService: { listarPorClasse: jest.Mock };
  let router: McpRouterService;

  beforeEach(() => {
    tasksService = {
      findMany: jest
        .fn()
        .mockResolvedValue({ items: [], pagination: { hasMore: false, nextCursor: null } }),
      create: jest
        .fn()
        .mockResolvedValue({ id: '1', nome: 'Task', status: 'INBOX', projectId: unsafeId }),
      findOne: jest.fn().mockResolvedValue({ id: unsafeId, projectId: unsafeId, status: 'INBOX' }),
      updateStatus: jest
        .fn()
        .mockResolvedValue({
          id: unsafeId,
          status: 'READY',
          atualizadoEm: '2026-05-10T00:00:00.000Z',
        }),
    };
    projectsService = {
      findMany: jest.fn().mockResolvedValue({
        items: [{ id: unsafeId, nome: 'Projeto' }],
        pagination: { hasMore: false, nextCursor: null },
      }),
      findAccessibleProjectIds: jest.fn().mockResolvedValue([unsafeId]),
      findOne: jest.fn().mockResolvedValue({ id: unsafeId, nome: 'Projeto' }),
    };
    tabelaService = {
      listarPorClasse: jest
        .fn()
        .mockResolvedValue({ items: [], pagination: { hasMore: false, nextCursor: null } }),
    };

    router = new McpRouterService(
      new ListTasksTool(tasksService as never, projectsService as never),
      new CreateTaskTool(tasksService as never, projectsService as never),
      new UpdateStatusTool(tasksService as never, projectsService as never),
      new ListProjectsTool(projectsService as never),
      new ListSprintsTool(tabelaService as never, projectsService as never),
    );
  });

  it('lista as 5 tools em tools/list', async () => {
    await expect(router.dispatch('tools/list', undefined, userCtx)).resolves.toEqual({
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'list_tasks' }),
          expect.objectContaining({ name: 'create_task' }),
          expect.objectContaining({ name: 'update_status' }),
          expect.objectContaining({ name: 'list_projects' }),
          expect.objectContaining({ name: 'list_sprints' }),
        ]),
      },
    });
  });

  it('list_tasks valida IDs com BigInt e delega para TasksService.findMany com cursor pagination', async () => {
    await router.dispatch(
      'tools/call',
      {
        name: 'list_tasks',
        arguments: {
          projectId: unsafeId,
          assigneeId: '9007199254740997',
          status: 'INBOX',
          cursor: '9007199254740999',
          limit: 50,
        },
      },
      userCtx,
    );

    expect(tasksService.findMany).toHaveBeenCalledWith({
      projectId: unsafeId,
      assigneeId: '9007199254740997',
      status: 'INBOX',
      cursor: '9007199254740999',
      limit: 50,
    });
    expect(projectsService.findOne).toHaveBeenCalledWith(unsafeId, userCtx.dEntidadeId);
  });

  it('list_tasks sem projectId restringe a projetos acessiveis antes de delegar', async () => {
    await router.dispatch('tools/call', { name: 'list_tasks', arguments: { limit: 10 } }, userCtx);

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(userCtx.dEntidadeId);
    expect(tasksService.findMany).toHaveBeenCalledWith({
      projectIds: [unsafeId],
      limit: 10,
    });
  });

  it('list_tasks sem projectId nao limita a resolucao de projetos acessiveis a 100 itens', async () => {
    const projectIds = Array.from({ length: 101 }, (_, index) =>
      (BigInt(unsafeId) + BigInt(index)).toString(),
    );
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce(projectIds);

    await router.dispatch('tools/call', { name: 'list_tasks', arguments: { limit: 10 } }, userCtx);

    expect(tasksService.findMany).toHaveBeenCalledWith({
      projectIds,
      limit: 10,
    });
  });

  it('create_task ignora createdBy externo e usa userCtx.dEntidadeId no service canonico', async () => {
    await router.dispatch(
      'tools/call',
      {
        name: 'create_task',
        arguments: {
          projectId: unsafeId,
          titulo: 'Task criada via MCP',
          descricao: 'Descricao',
          assigneeId: '9007199254740997',
          sprintId: '9007199254740999',
          createdBy: '1',
        },
      },
      userCtx,
    );

    expect(tasksService.create).toHaveBeenCalledWith(
      {
        projectId: unsafeId,
        nome: 'Task criada via MCP',
        descricao: 'Descricao',
        assigneeId: '9007199254740997',
        sprintId: '9007199254740999',
        source: 'mcp',
      },
      userCtx.dEntidadeId,
    );
    expect(projectsService.findOne).toHaveBeenCalledWith(unsafeId, userCtx.dEntidadeId);
  });

  it('create_task rejeita title/description legados e valida tamanho de titulo/descricao', async () => {
    await expect(
      router.dispatch(
        'tools/call',
        { name: 'create_task', arguments: { projectId: unsafeId, title: 'Legacy' } },
        userCtx,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32602,
          data: { field: 'titulo', issue: 'required string' },
        }),
      }),
    );

    await expect(
      router.dispatch(
        'tools/call',
        { name: 'create_task', arguments: { projectId: unsafeId, titulo: 'x'.repeat(501) } },
        userCtx,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32602,
          data: { field: 'titulo', issue: 'max length 500 exceeded' },
        }),
      }),
    );

    await expect(
      router.dispatch(
        'tools/call',
        {
          name: 'create_task',
          arguments: { projectId: unsafeId, titulo: 'Titulo', descricao: 'x'.repeat(5001) },
        },
        userCtx,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32602,
          data: { field: 'descricao', issue: 'max length 5000 exceeded' },
        }),
      }),
    );

    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('update_status valida statusCode antes de chamar TasksService.updateStatus', async () => {
    const invalid = await router.dispatch(
      'tools/call',
      { name: 'update_status', arguments: { taskId: unsafeId, statusCode: 'UNKNOWN' } },
      userCtx,
    );

    expect(invalid.error).toEqual(
      expect.objectContaining({
        code: -32602,
        message: 'Invalid params',
        data: { field: 'statusCode', issue: 'invalid V3 status code' },
      }),
    );
    expect(tasksService.updateStatus).not.toHaveBeenCalled();

    await router.dispatch(
      'tools/call',
      { name: 'update_status', arguments: { taskId: unsafeId, statusCode: 'READY' } },
      userCtx,
    );

    expect(tasksService.updateStatus).toHaveBeenCalledWith(unsafeId, {
      status: 'READY',
      movedBy: userCtx.dEntidadeId.toString(),
    });
    expect(tasksService.findOne).toHaveBeenCalledWith(unsafeId);
    expect(projectsService.findOne).toHaveBeenCalledWith(unsafeId, userCtx.dEntidadeId);
  });

  it('list_projects delega para ProjectsService.findMany com userCtx e cursor pagination', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'list_projects', arguments: { cursor: unsafeId, limit: 10 } },
      userCtx,
    );

    expect(projectsService.findMany).toHaveBeenCalledWith(userCtx.dEntidadeId, {
      cursor: unsafeId,
      limit: 10,
    });
  });

  it('list_sprints usa TabelaService.listarPorClasse para DTabela -400', async () => {
    await router.dispatch(
      'tools/call',
      {
        name: 'list_sprints',
        arguments: { projectId: unsafeId, cursor: '9007199254740999', limit: 25 },
      },
      userCtx,
    );

    expect(tabelaService.listarPorClasse).toHaveBeenCalledWith({
      idClasse: '-400',
      dEntidadeId: unsafeId,
      cursor: '9007199254740999',
      pageSize: 25,
    });
    expect(projectsService.findOne).toHaveBeenCalledWith(unsafeId, userCtx.dEntidadeId);
  });

  it('retorna -32602 para IDs invalidos sem chamar service canonico', async () => {
    const result = await router.dispatch(
      'tools/call',
      { name: 'list_tasks', arguments: { projectId: 'not-a-bigint' } },
      userCtx,
    );

    expect(result.error).toEqual(
      expect.objectContaining({
        code: -32602,
        message: 'Invalid params',
        data: { field: 'projectId', issue: 'valid bigint string expected' },
      }),
    );
    expect(tasksService.findMany).not.toHaveBeenCalled();
  });

  it('valida params invalidos nas 5 tools antes de chamar services canonicos', async () => {
    await expect(
      router.dispatch(
        'tools/call',
        { name: 'list_tasks', arguments: { status: 'UNKNOWN' } },
        userCtx,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32602,
          data: { field: 'status', issue: 'invalid V3 status code' },
        }),
      }),
    );

    await expect(
      router.dispatch(
        'tools/call',
        { name: 'create_task', arguments: { projectId: unsafeId } },
        userCtx,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32602,
          data: { field: 'titulo', issue: 'required string' },
        }),
      }),
    );

    await expect(
      router.dispatch(
        'tools/call',
        { name: 'update_status', arguments: { taskId: 'bad', statusCode: 'READY' } },
        userCtx,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32602,
          data: { field: 'taskId', issue: 'valid bigint string expected' },
        }),
      }),
    );

    await expect(
      router.dispatch('tools/call', { name: 'list_projects', arguments: { limit: 51 } }, userCtx),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32602,
          data: { field: 'limit', issue: 'integer between 1 and 50 expected' },
        }),
      }),
    );

    await expect(
      router.dispatch('tools/call', { name: 'list_sprints', arguments: { limit: 20 } }, userCtx),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: -32602,
          data: { field: 'projectId', issue: 'required string' },
        }),
      }),
    );

    expect(tasksService.findMany).not.toHaveBeenCalled();
    expect(tasksService.create).not.toHaveBeenCalled();
    expect(tasksService.updateStatus).not.toHaveBeenCalled();
    expect(projectsService.findMany).not.toHaveBeenCalled();
    expect(tabelaService.listarPorClasse).not.toHaveBeenCalled();
  });

  it('bloqueia side effects quando membership do projeto e negada', async () => {
    const forbidden = new Error('forbidden');

    projectsService.findOne.mockRejectedValueOnce(forbidden);
    await expect(
      router.dispatch(
        'tools/call',
        { name: 'list_tasks', arguments: { projectId: unsafeId } },
        userCtx,
      ),
    ).rejects.toThrow(forbidden);
    expect(tasksService.findMany).not.toHaveBeenCalled();

    projectsService.findOne.mockRejectedValueOnce(forbidden);
    await expect(
      router.dispatch(
        'tools/call',
        { name: 'create_task', arguments: { projectId: unsafeId, titulo: 'Task' } },
        userCtx,
      ),
    ).rejects.toThrow(forbidden);
    expect(tasksService.create).not.toHaveBeenCalled();

    projectsService.findOne.mockRejectedValueOnce(forbidden);
    await expect(
      router.dispatch(
        'tools/call',
        { name: 'list_sprints', arguments: { projectId: unsafeId } },
        userCtx,
      ),
    ).rejects.toThrow(forbidden);
    expect(tabelaService.listarPorClasse).not.toHaveBeenCalled();

    tasksService.findOne.mockResolvedValueOnce({
      id: unsafeId,
      projectId: unsafeId,
      status: 'INBOX',
    });
    projectsService.findOne.mockRejectedValueOnce(forbidden);
    await expect(
      router.dispatch(
        'tools/call',
        { name: 'update_status', arguments: { taskId: unsafeId, statusCode: 'READY' } },
        userCtx,
      ),
    ).rejects.toThrow(forbidden);
    expect(tasksService.updateStatus).not.toHaveBeenCalled();
  });

  it('propaga excecao lancada por service canonico', async () => {
    const error = new Error('service failed');
    tasksService.findMany.mockRejectedValueOnce(error);

    await expect(
      router.dispatch('tools/call', { name: 'list_tasks', arguments: {} }, userCtx),
    ).rejects.toThrow(error);
  });
});
