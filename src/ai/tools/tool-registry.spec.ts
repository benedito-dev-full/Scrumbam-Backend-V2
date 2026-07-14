import { ListBlockTasksCapability } from '../../common/tool-capabilities/capabilities/blocks/list-block-tasks.capability';
import { ListBlocksCapability } from '../../common/tool-capabilities/capabilities/blocks/list-blocks.capability';
import { CreateCommentCapability } from '../../common/tool-capabilities/capabilities/comments/create-comment.capability';
import { ListCommentsCapability } from '../../common/tool-capabilities/capabilities/comments/list-comments.capability';
import { GetUnreadCountCapability } from '../../common/tool-capabilities/capabilities/misc/get-unread-count.capability';
import { ListMembersCapability } from '../../common/tool-capabilities/capabilities/misc/list-members.capability';
import { ListNotificationsCapability } from '../../common/tool-capabilities/capabilities/misc/list-notifications.capability';
import { GetProjectMetricsCapability } from '../../common/tool-capabilities/capabilities/projects/get-project-metrics.capability';
import { GetProjectCapability } from '../../common/tool-capabilities/capabilities/projects/get-project.capability';
import { ListProjectsCapability } from '../../common/tool-capabilities/capabilities/projects/list-projects.capability';
import { CreateTaskCapability } from '../../common/tool-capabilities/capabilities/tasks/create-task.capability';
import { GetTaskTreeCapability } from '../../common/tool-capabilities/capabilities/tasks/get-task-tree.capability';
import { GetTaskCapability } from '../../common/tool-capabilities/capabilities/tasks/get-task.capability';
import { ListMyTasksCapability } from '../../common/tool-capabilities/capabilities/tasks/list-my-tasks.capability';
import { ListTasksCapability } from '../../common/tool-capabilities/capabilities/tasks/list-tasks.capability';
import { SearchTasksCapability } from '../../common/tool-capabilities/capabilities/tasks/search-tasks.capability';
import { CapabilityRegistry } from '../../common/tool-capabilities/capability-registry';
import { RoleResolverService } from '../../auth/services/role-resolver.service';
import { GetProjectSummaryTool } from './get-project-summary.tool';
import { NexusCapabilityAdapter } from './nexus-capability.adapter';
import { AiToolContext } from './tool-context';
import { ToolRegistry } from './tool-registry';

/**
 * Onda 1 (piloto `create_task`) + Onda 2 (bidirecionalidade `create_comment`/
 * `list_comments`) + Onda 3 (13 reads so-MCP nascem no Nexus) —
 * `ToolRegistry.buildAll(ctx)` serve as capabilities migradas VIA
 * `NexusCapabilityAdapter` (registry real).
 *
 * Prova: (a) as capabilities migradas aparecem na lista de tools do Nexus com
 * nomes canonicos snake_case (incl. as 13 novas da Onda 3); (b) o
 * `scopeResolver` deriva do `RoleResolverService.getAllowedMcpScopes` (MESMO
 * mapa RBAC->scopes ja usado para as MCP keys); (c) sem o scope necessario no
 * RBAC => negado, por capability, respeitando o `requiredScopes` de cada uma.
 */
describe('ToolRegistry — capabilities via NexusCapabilityAdapter (Ondas 1, 2 e 3)', () => {
  const ctx: AiToolContext = { userEntidadeId: BigInt(9), organizationId: '5' };
  const projectId = '100';
  const created = { id: '1', projectId, nome: 'Via chat' };

  let tasksService: { create: jest.Mock; findOne: jest.Mock };
  let projectsService: { findOne: jest.Mock; findAccessibleProjectIds: jest.Mock };
  let commentsService: { create: jest.Mock; findMany: jest.Mock };
  let notificationsService: { getUnreadCount: jest.Mock };
  let roleResolver: { getAllowedMcpScopes: jest.Mock };
  let registry: ToolRegistry;

  beforeEach(() => {
    tasksService = {
      create: jest.fn().mockResolvedValue(created),
      findOne: jest.fn().mockResolvedValue({ id: '1', projectId, nome: 'Task', status: 'INBOX' }),
    };
    projectsService = {
      findOne: jest.fn().mockResolvedValue({ id: projectId }),
      findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]),
    };
    commentsService = {
      create: jest.fn().mockResolvedValue({
        id: '1001',
        texto: 'ok',
        targetType: 'task',
        targetId: '777',
        autorId: '9',
        autorNome: 'Ana',
        createdAt: '2026-07-12T10:00:00.000Z',
      }),
      findMany: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    };
    notificationsService = { getUnreadCount: jest.fn().mockResolvedValue({ count: 2 }) };
    roleResolver = {
      getAllowedMcpScopes: jest
        .fn()
        .mockResolvedValue(new Set(['tasks:write', 'tasks:read', 'notifications:read'])),
    };

    const capabilityRegistry = new CapabilityRegistry();
    capabilityRegistry.register(
      new CreateTaskCapability(tasksService as never, projectsService as never),
    );
    capabilityRegistry.register(new CreateCommentCapability(commentsService as never));
    capabilityRegistry.register(new ListCommentsCapability(commentsService as never));
    // Onda 3 — reads so-MCP, registradas aqui p/ provar que aparecem no Nexus.
    capabilityRegistry.register(
      new GetTaskCapability(tasksService as never, projectsService as never),
    );
    capabilityRegistry.register(
      new GetTaskTreeCapability({} as never, tasksService as never, projectsService as never),
    );
    capabilityRegistry.register(
      new ListTasksCapability(tasksService as never, projectsService as never),
    );
    capabilityRegistry.register(
      new ListMyTasksCapability(tasksService as never, projectsService as never),
    );
    capabilityRegistry.register(
      new SearchTasksCapability(projectsService as never, {} as never),
    );
    capabilityRegistry.register(
      new GetProjectCapability(projectsService as never, {} as never),
    );
    capabilityRegistry.register(new ListProjectsCapability(projectsService as never));
    capabilityRegistry.register(
      new GetProjectMetricsCapability({} as never, {} as never, projectsService as never),
    );
    capabilityRegistry.register(
      new ListBlocksCapability(tasksService as never, projectsService as never),
    );
    capabilityRegistry.register(
      new ListBlockTasksCapability(tasksService as never, projectsService as never),
    );
    capabilityRegistry.register(
      new ListMembersCapability({} as never, projectsService as never),
    );
    capabilityRegistry.register(new ListNotificationsCapability(notificationsService as never));
    capabilityRegistry.register(new GetUnreadCountCapability(notificationsService as never));
    const capabilityAdapter = new NexusCapabilityAdapter(capabilityRegistry);

    registry = new ToolRegistry(
      {
        build: jest.fn().mockReturnValue({ name: 'getProjectSummary', execute: jest.fn() }),
      } as never as GetProjectSummaryTool,
      capabilityAdapter,
      roleResolver as unknown as RoleResolverService,
    );
  });

  it('as capabilities migradas aparecem na lista (nomes canonicos snake_case) junto com getProjectSummary', () => {
    const tools = registry.buildAll(ctx);
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'getProjectSummary',
        'create_task',
        'create_comment',
        'list_comments',
        // Onda 3 — 13 reads so-MCP, agora tambem no Nexus.
        'get_task',
        'get_task_tree',
        'list_tasks',
        'list_my_tasks',
        'search_tasks',
        'get_project',
        'list_projects',
        'get_project_metrics',
        'list_blocks',
        'list_block_tasks',
        'list_members',
        'list_notifications',
        'get_unread_count',
      ]),
    );
  });

  it('get_unread_count (Onda 3): execute delega ao NotificationsService via capability', async () => {
    const tools = registry.buildAll(ctx);
    const getUnreadCount = tools.find((t) => t.name === 'get_unread_count')!;

    const result = await getUnreadCount.execute({});

    expect(notificationsService.getUnreadCount).toHaveBeenCalledWith(ctx.userEntidadeId);
    expect(result).toEqual({ count: 2 });
  });

  it('RBAC sem notifications:read => get_unread_count rejeita, service nao chamado (default nega)', async () => {
    roleResolver.getAllowedMcpScopes.mockResolvedValue(new Set(['tasks:read']));
    const tools = registry.buildAll(ctx);
    const getUnreadCount = tools.find((t) => t.name === 'get_unread_count')!;

    await expect(getUnreadCount.execute({})).rejects.toThrow(/Permissao negada/);
    expect(notificationsService.getUnreadCount).not.toHaveBeenCalled();
  });

  it('create_task: execute delega ao TasksService via capability, com principal derivado do RBAC', async () => {
    const tools = registry.buildAll(ctx);
    const createTask = tools.find((t) => t.name === 'create_task')!;

    const result = await createTask.execute({ projectId, titulo: 'Via chat' });

    expect(roleResolver.getAllowedMcpScopes).toHaveBeenCalledWith(ctx.userEntidadeId);
    expect(tasksService.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, nome: 'Via chat', source: 'nexus' }),
      ctx.userEntidadeId,
    );
    expect(result).toEqual(created);
  });

  it('RBAC sem tasks:write => create_task rejeita, service nao chamado (default nega)', async () => {
    roleResolver.getAllowedMcpScopes.mockResolvedValue(new Set(['tasks:read']));
    const tools = registry.buildAll(ctx);
    const createTask = tools.find((t) => t.name === 'create_task')!;

    await expect(createTask.execute({ projectId, titulo: 'X' })).rejects.toThrow(
      /Permissao negada/,
    );
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('create_comment: execute delega ao CommentsService via capability', async () => {
    const tools = registry.buildAll(ctx);
    const createComment = tools.find((t) => t.name === 'create_comment')!;

    const result = await createComment.execute({
      targetType: 'task',
      targetId: '777',
      texto: 'ok',
    });

    expect(commentsService.create).toHaveBeenCalledWith(
      'task',
      '777',
      { texto: 'ok' },
      ctx.userEntidadeId,
      ctx.organizationId,
    );
    expect(result).toEqual({
      success: true,
      commentId: '1001',
      targetType: 'task',
      targetId: '777',
    });
  });

  it('RBAC sem tasks:write => create_comment rejeita, service nao chamado', async () => {
    roleResolver.getAllowedMcpScopes.mockResolvedValue(new Set(['tasks:read']));
    const tools = registry.buildAll(ctx);
    const createComment = tools.find((t) => t.name === 'create_comment')!;

    await expect(
      createComment.execute({ targetType: 'task', targetId: '777', texto: 'x' }),
    ).rejects.toThrow(/Permissao negada/);
    expect(commentsService.create).not.toHaveBeenCalled();
  });

  it('list_comments: execute delega ao CommentsService via capability', async () => {
    const tools = registry.buildAll(ctx);
    const listComments = tools.find((t) => t.name === 'list_comments')!;

    await listComments.execute({ targetType: 'task', targetId: '777' });

    expect(commentsService.findMany).toHaveBeenCalledWith(
      'task',
      '777',
      { limit: 20 },
      ctx.userEntidadeId,
      ctx.organizationId,
    );
  });

  it('RBAC sem tasks:read => list_comments rejeita, service nao chamado', async () => {
    roleResolver.getAllowedMcpScopes.mockResolvedValue(new Set(['tasks:write']));
    const tools = registry.buildAll(ctx);
    const listComments = tools.find((t) => t.name === 'list_comments')!;

    await expect(listComments.execute({ targetType: 'task', targetId: '777' })).rejects.toThrow(
      /Permissao negada/,
    );
    expect(commentsService.findMany).not.toHaveBeenCalled();
  });
});
