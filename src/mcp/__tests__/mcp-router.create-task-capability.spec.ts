import { CreateTaskCapability } from '../../common/tool-capabilities/capabilities/tasks/create-task.capability';
import { CapabilityRegistry } from '../../common/tool-capabilities/capability-registry';
import { McpRouterService } from '../services/mcp-router.service';
import { CreateTaskTool } from '../tools/create-task.tool';
import { McpCapabilityAdapter } from '../tools/mcp-capability.adapter';

/**
 * Onda 1 (piloto) — `create_task` servido PELO ADAPTER no `McpRouterService`.
 *
 * Diferente de `mcp-tools.create-task.spec.ts` (que exercita o wrapper legado
 * `CreateTaskTool` direto), este spec prova o caminho NOVO: registry real com
 * `CreateTaskCapability` registrada + `McpCapabilityAdapter` injetado no
 * router. O wire (envelope, DTO repassado ao service) deve ser IDENTICO ao
 * caminho legado — mesma prova que o golden test faz para o wrapper.
 */
describe('McpRouterService — create_task via McpCapabilityAdapter (Onda 1)', () => {
  const projectId = '9007199254740995';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tasks:write'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };
  const created = { id: '123', projectId, nome: 'Nova task' };

  let tasksService: { create: jest.Mock };
  let projectsService: { findOne: jest.Mock };
  let router: McpRouterService;

  beforeEach(() => {
    tasksService = { create: jest.fn().mockResolvedValue(created) };
    projectsService = { findOne: jest.fn().mockResolvedValue({ id: projectId }) };

    const registry = new CapabilityRegistry();
    registry.register(new CreateTaskCapability(tasksService as never, projectsService as never));
    const adapter = new McpCapabilityAdapter(registry);

    // capabilityAdapter e o ULTIMO parametro posicional (26o) — CreateTaskTool
    // legado (2a posicao) fica undefined para provar que o adapter GANHA
    // quando ambos estariam disponiveis via DI real.
    router = new McpRouterService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      adapter,
    );
  });

  it('wire identico ao wrapper legado: envelope textResult + DTO com source=mcp', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_task', arguments: { projectId, titulo: 'Nova task' } },
      userCtx,
    );

    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(created) }],
    });
    expect(tasksService.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, nome: 'Nova task', source: 'mcp' }),
      userCtx.dEntidadeId,
    );
  });

  it('gate de scope: sem tasks:write => FORBIDDEN, service nao chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_task', arguments: { projectId, titulo: 'X' } },
      { ...userCtx, scopes: [] },
    );

    expect(response.error).toEqual(expect.objectContaining({ code: -32002 }));
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('tools/list continua vindo do schema estatico (nao do registry) — wire inalterado', async () => {
    const response = await router.dispatch('tools/list', undefined, userCtx);
    const tools = (response.result as { tools: Array<{ name: string }> }).tools;
    // 26 desde a Onda 2 (create_comment/list_comments passaram a existir
    // tambem no MCP) — o schema estatico continua sendo a fonte de tools/list,
    // so o numero total mudou de proposito nessa onda.
    expect(tools).toHaveLength(26);
    expect(tools.some((t) => t.name === 'create_task')).toBe(true);
  });

  it('sem capabilityAdapter (golden test path) => cai no wrapper legado quando injetado', async () => {
    const legacyTasksService = { create: jest.fn().mockResolvedValue(created) };
    const legacyProjectsService = { findOne: jest.fn().mockResolvedValue({ id: projectId }) };
    const legacyRouter = new McpRouterService(
      undefined,
      new CreateTaskTool(legacyTasksService as never, legacyProjectsService as never),
    );

    const response = await legacyRouter.dispatch(
      'tools/call',
      { name: 'create_task', arguments: { projectId, titulo: 'Via wrapper legado' } },
      userCtx,
    );

    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(created) }],
    });
    expect(legacyTasksService.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, nome: 'Via wrapper legado', source: 'mcp' }),
      userCtx.dEntidadeId,
    );
  });
});
