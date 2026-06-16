import { McpRouterService } from '../services/mcp-router.service';
import { ListBlocksTool } from '../tools/list-blocks.tool';

/**
 * Specs para a tool MCP `list_blocks` (F7 ADR-V2-047).
 *
 * Cobre:
 * (a) happy path — chama findMany com idClasse=-200 fixo + projectId
 * (b) projectId ausente → INVALID_PARAMS
 * (c) projectId fora do scope → retorna lista vazia (anti enumeration)
 * (d) cursor invalido → INVALID_PARAMS
 * (f) limit fora de range → INVALID_PARAMS
 * (h) scope vazio retorna items vazios sem chamar findMany
 *
 * Nota: o param `includeMetrics` foi REMOVIDO desta tool (Task 1 — polir block
 * tools). Para tasks + métricas de um bloco use `list_block_tasks`.
 */
describe('MCP list_blocks tool', () => {
  const projectId = '9007199254740995';
  const otherProjectId = '9007199254740999';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tasks:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  let tasksService: { findMany: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let router: McpRouterService;

  beforeEach(() => {
    tasksService = {
      findMany: jest.fn().mockResolvedValue({
        items: [{ id: '5', nome: 'Bloco A', idClasse: '-200' }],
        pagination: { hasMore: false, nextCursor: null },
      }),
    };
    projectsService = {
      findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]),
    };

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
      new ListBlocksTool(tasksService as never, projectsService as never),
    );
  });

  it('(a) happy path — chama findMany com idClasse=-200 fixo', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_blocks', arguments: { projectId } },
      userCtx,
    );

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(userCtx.dEntidadeId);
    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, idClasse: '-200', limit: 20 }),
      [projectId],
    );

    expect(response.result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            items: [{ id: '5', nome: 'Bloco A', idClasse: '-200' }],
            pagination: { hasMore: false, nextCursor: null },
          }),
        },
      ],
    });
  });

  it('(b) projectId ausente → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_blocks', arguments: {} },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: expect.objectContaining({ field: 'projectId' }),
      }),
    );
    expect(tasksService.findMany).not.toHaveBeenCalled();
  });

  it('(c) projectId fora do scope → retorna lista vazia (anti enumeration)', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_blocks', arguments: { projectId: otherProjectId } },
      userCtx,
    );

    expect(response.result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ items: [], pagination: { hasMore: false, nextCursor: null } }),
        },
      ],
    });
    expect(tasksService.findMany).not.toHaveBeenCalled();
  });

  it('(d) cursor invalido → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_blocks', arguments: { projectId, cursor: 'not-a-bigint' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({ code: -32602, data: expect.objectContaining({ field: 'cursor' }) }),
    );
  });

  it('includeMetrics removido — findMany nunca recebe o campo', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'list_blocks', arguments: { projectId } },
      userCtx,
    );

    expect(tasksService.findMany).toHaveBeenCalledTimes(1);
    const call = tasksService.findMany.mock.calls[0][0];
    expect(call.includeMetrics).toBeUndefined();
  });

  it('(f) limit fora de range → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_blocks', arguments: { projectId, limit: 999 } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({ code: -32602, data: expect.objectContaining({ field: 'limit' }) }),
    );
  });

  it('(h) scope vazio retorna items vazios sem chamar findMany', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce([]);

    const response = await router.dispatch(
      'tools/call',
      { name: 'list_blocks', arguments: { projectId } },
      userCtx,
    );

    expect(tasksService.findMany).not.toHaveBeenCalled();
    expect(
      JSON.parse((response.result as { content: { text: string }[] }).content[0].text),
    ).toEqual({
      items: [],
      pagination: { hasMore: false, nextCursor: null },
    });
  });

  it('cursor valido + limit customizado propagados para findMany', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'list_blocks', arguments: { projectId, cursor: '42', limit: 10 } },
      userCtx,
    );

    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, idClasse: '-200', cursor: '42', limit: 10 }),
      [projectId],
    );
  });
});
