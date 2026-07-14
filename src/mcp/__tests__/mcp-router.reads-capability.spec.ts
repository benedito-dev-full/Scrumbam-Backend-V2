import { GetTaskCapability } from '../../common/tool-capabilities/capabilities/tasks/get-task.capability';
import { ListMembersCapability } from '../../common/tool-capabilities/capabilities/misc/list-members.capability';
import { CapabilityRegistry } from '../../common/tool-capabilities/capability-registry';
import { McpRouterService } from '../services/mcp-router.service';
import { GetTaskTool } from '../tools/get-task.tool';
import { McpCapabilityAdapter } from '../tools/mcp-capability.adapter';

/**
 * Onda 3 (reads so-MCP) — as 13 reads servidas PELO ADAPTER no
 * `McpRouterService`, com fallback ao wrapper legado (MESMA disciplina de
 * `resolveCreateTaskTool`, generalizada em `resolveToolWithFallback`).
 *
 * Nao repete os 13 casos (ja cobertos individualmente pelos
 * `*.capability.spec.ts`) — prova o WIRE do router com 2 amostras
 * representativas: `get_task` (5o parametro posicional legado) e
 * `list_members` (7o parametro posicional legado).
 *
 * @see mcp-router.create-task-capability.spec.ts — mesmo padrao (Onda 1)
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 3
 */
describe('McpRouterService — reads via McpCapabilityAdapter com fallback legado (Onda 3)', () => {
  const taskId = '9007199254740993';
  const projectId = '9007199254740995';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tasks:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  it('get_task: adapter GANHA quando capability registrada (2o positional undefined = legado ausente)', async () => {
    const found = { id: taskId, projectId, nome: 'Task de teste', status: 'INBOX' };
    const tasksService = { findOne: jest.fn().mockResolvedValue(found) };
    const projectsService = { findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]) };

    const registry = new CapabilityRegistry();
    registry.register(new GetTaskCapability(tasksService as never, projectsService as never));
    const adapter = new McpCapabilityAdapter(registry);

    // capabilityAdapter e o ULTIMO parametro posicional (26o); getTaskTool
    // (5o) fica undefined para provar que o adapter serve get_task sozinho.
    const router = new McpRouterService(
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      adapter,
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'get_task', arguments: { taskId } },
      userCtx,
    );

    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(found) }],
    });
    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, [projectId]);
  });

  it('get_task: sem capabilityAdapter (golden test path) cai no wrapper legado', async () => {
    const found = { id: taskId, projectId, nome: 'Task de teste', status: 'INBOX' };
    const legacyTasksService = { findOne: jest.fn().mockResolvedValue(found) };
    const legacyProjectsService = {
      findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]),
    };

    // getTaskTool e o 5o parametro posicional do construtor do router.
    const legacyRouter = new McpRouterService(
      undefined,
      undefined,
      undefined,
      undefined,
      new GetTaskTool(legacyTasksService as never, legacyProjectsService as never),
    );

    const response = await legacyRouter.dispatch(
      'tools/call',
      { name: 'get_task', arguments: { taskId } },
      userCtx,
    );

    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(found) }],
    });
    expect(legacyTasksService.findOne).toHaveBeenCalledWith(taskId, [projectId]);
  });

  it('list_members: adapter GANHA quando capability registrada, gate de scope aplicado', async () => {
    const members = { items: [{ id: '1', role: 'MANAGER' }] };
    const projectMembersService = { getMembers: jest.fn().mockResolvedValue(members) };
    const projectsService = { findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]) };

    const registry = new CapabilityRegistry();
    registry.register(
      new ListMembersCapability(projectMembersService as never, projectsService as never),
    );
    const adapter = new McpCapabilityAdapter(registry);

    const router = new McpRouterService(
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      adapter,
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'list_members', arguments: { projectId } },
      userCtx,
    );

    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(members) }],
    });

    const forbidden = await router.dispatch(
      'tools/call',
      { name: 'list_members', arguments: { projectId } },
      { ...userCtx, scopes: [] },
    );
    expect(forbidden.error).toEqual(expect.objectContaining({ code: -32002 }));
  });

  it('tools/list continua vindo do schema estatico (26 tools) — wire de list nao muda nesta onda', async () => {
    const registry = new CapabilityRegistry();
    const adapter = new McpCapabilityAdapter(registry);
    const router = new McpRouterService(
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      adapter,
    );

    const response = await router.dispatch('tools/list', undefined, userCtx);
    const tools = (response.result as { tools: Array<{ name: string }> }).tools;
    expect(tools).toHaveLength(26);
    expect(tools.some((t) => t.name === 'get_task')).toBe(true);
    expect(tools.some((t) => t.name === 'list_members')).toBe(true);
  });
});
