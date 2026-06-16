import { McpRouterService } from '../services/mcp-router.service';
import { ListTasksTool } from '../tools/list-tasks.tool';

/**
 * Specs para o filtro `idClasse` em `list_tasks` (F7 ADR-V2-047).
 *
 * O suporte a `idClasse` ja existe em `TasksService.findMany` desde F4.
 * Aqui validamos apenas o handshake: tool aceita, valida regex e
 * propaga para o service. Demais coberturas (CTE recursiva, scope tenant
 * etc.) vivem nos specs de findMany.
 */
describe('MCP list_tasks tool — filtro idClasse (F7)', () => {
  const projectId = '9007199254740995';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tasks:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  let tasksService: { findMany: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock; findOne: jest.Mock };
  let router: McpRouterService;

  beforeEach(() => {
    tasksService = {
      findMany: jest
        .fn()
        .mockResolvedValue({ items: [], pagination: { hasMore: false, nextCursor: null } }),
    };
    projectsService = {
      findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]),
      findOne: jest.fn().mockResolvedValue({ id: projectId }),
    };

    router = new McpRouterService(
      new ListTasksTool(tasksService as never, projectsService as never),
    );
  });

  it('aceita idClasse="-200" (PHASE) e propaga para findMany', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_tasks', arguments: { projectId, idClasse: '-200' } },
      userCtx,
    );

    expect(response.result).toBeDefined();
    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, idClasse: '-200' }),
      [projectId],
    );
  });

  it('aceita idClasse="-154" (SCRUMBAN_TASK) e propaga', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'list_tasks', arguments: { idClasse: '-154' } },
      userCtx,
    );

    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ idClasse: '-154' }),
      [projectId],
    );
  });

  it('rejeita idClasse com letras (INVALID_PARAMS)', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_tasks', arguments: { idClasse: 'PHASE' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: expect.objectContaining({ field: 'idClasse' }),
      }),
    );
    expect(tasksService.findMany).not.toHaveBeenCalled();
  });

  it('rejeita idClasse com formato decimal (INVALID_PARAMS)', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_tasks', arguments: { idClasse: '-200.5' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: expect.objectContaining({ field: 'idClasse' }),
      }),
    );
  });

  it('sem idClasse: chama findMany sem o campo', async () => {
    await router.dispatch('tools/call', { name: 'list_tasks', arguments: {} }, userCtx);

    const call = tasksService.findMany.mock.calls[0][0];
    expect(call.idClasse).toBeUndefined();
  });
});
