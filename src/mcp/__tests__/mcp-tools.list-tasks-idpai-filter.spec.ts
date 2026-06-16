import { McpRouterService } from '../services/mcp-router.service';
import { ListTasksTool } from '../tools/list-tasks.tool';

/**
 * Specs para o filtro `idPai` em `list_tasks` (F11 ADR-V2-047).
 *
 * O suporte a `idPai` ja existe em `TasksService.findMany` (Fase 4: aceita
 * string numerica → filhas diretas, ou literal "null" → tasks raiz).
 * Aqui validamos apenas o handshake da tool MCP: aceita, valida e propaga
 * para o service com `!== undefined` (preservando "null"/"0"). Demais
 * coberturas (CTE recursiva, depth, scope tenant) vivem nos specs de findMany.
 */
describe('MCP list_tasks tool — filtro idPai (F11)', () => {
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

  it('aceita idPai="1234" (filhas diretas) e propaga para findMany', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_tasks', arguments: { idPai: '1234' } },
      userCtx,
    );

    expect(response.result).toBeDefined();
    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ idPai: '1234' }),
      [projectId],
    );
  });

  it('aceita idPai="null" (tasks raiz) e propaga para findMany', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'list_tasks', arguments: { idPai: 'null' } },
      userCtx,
    );

    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ idPai: 'null' }),
      [projectId],
    );
  });

  it('rejeita idPai com letras (INVALID_PARAMS)', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_tasks', arguments: { idPai: 'abc' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: expect.objectContaining({ field: 'idPai' }),
      }),
    );
    expect(tasksService.findMany).not.toHaveBeenCalled();
  });

  it('rejeita idPai com formato decimal (INVALID_PARAMS)', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_tasks', arguments: { idPai: '12.5' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: expect.objectContaining({ field: 'idPai' }),
      }),
    );
    expect(tasksService.findMany).not.toHaveBeenCalled();
  });

  it('sem idPai: chama findMany sem o campo', async () => {
    await router.dispatch('tools/call', { name: 'list_tasks', arguments: {} }, userCtx);

    const call = tasksService.findMany.mock.calls[0][0];
    expect(call.idPai).toBeUndefined();
  });

  it('idPai combinado com projectId: propaga ambos e mantem 2º arg [projectId] (ADR-V2-042)', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'list_tasks', arguments: { projectId, idPai: '1234' } },
      userCtx,
    );

    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, idPai: '1234' }),
      [projectId],
    );
  });
});
