import { NotFoundException } from '@nestjs/common';

import { McpRouterService } from '../services/mcp-router.service';
import { ListBlockTasksTool } from '../tools/list-block-tasks.tool';

/**
 * Specs para a tool MCP `list_block_tasks` (Task 1 — polir block tools).
 *
 * Substitui `get_block_tree`. No modelo PLANO o vínculo task→bloco é
 * `dados.idBloco` (NÃO `idPai`); a tool reusa `TasksService.findMany({ idBloco })`.
 *
 * Cobre:
 * (a) happy path — findOne (gate + projectId) → findMany({ idBloco }); tasks idPai=null aparecem
 * (b) blockId ausente → INVALID_PARAMS
 * (c) blockId BigInt invalido → INVALID_PARAMS
 * (d) métricas (includeMetrics=true): buckets done/failed/inProgress + percent
 * (e) includeMetrics omitido → sem metrics no payload
 * (f) includeMetrics tipo errado → INVALID_PARAMS
 * (g) tenant: scope vazio → NotFoundException (antes de findOne)
 * (h) tenant: bloco fora do scope (findOne lança) → propaga NotFoundException
 * (i) percent=0 quando bloco vazio
 * (j) cursor + limit propagados para findMany
 */
describe('MCP list_block_tasks tool', () => {
  const blockId = '42';
  const projectId = '9007199254740995';
  const otherBlockId = '99';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tools:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  // Tasks do bloco com idPai=null (modelo PLANO — vínculo só por dados.idBloco).
  const blockTasks = [
    { id: '1', projectId, idClasse: '-154', idPai: null, status: 'DONE' },
    { id: '2', projectId, idClasse: '-154', idPai: null, status: 'VALIDATED' },
    { id: '3', projectId, idClasse: '-154', idPai: null, status: 'CANCELLED' },
    { id: '4', projectId, idClasse: '-154', idPai: null, status: 'FAILED' },
    { id: '5', projectId, idClasse: '-154', idPai: null, status: 'DISCARDED' },
    { id: '6', projectId, idClasse: '-154', idPai: null, status: 'EXECUTING' },
    { id: '7', projectId, idClasse: '-154', idPai: null, status: 'VALIDATING' },
    { id: '8', projectId, idClasse: '-154', idPai: null, status: 'READY' },
    { id: '9', projectId, idClasse: '-154', idPai: null, status: 'INBOX' },
  ];

  let tasksService: { findOne: jest.Mock; findMany: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let router: McpRouterService;

  function buildRouter(): McpRouterService {
    return new McpRouterService(
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
      new ListBlockTasksTool(tasksService as never, projectsService as never),
    );
  }

  beforeEach(() => {
    tasksService = {
      findOne: jest.fn().mockResolvedValue({ id: blockId, projectId, idClasse: '-200' }),
      findMany: jest.fn().mockResolvedValue({
        items: blockTasks,
        pagination: { hasMore: false, nextCursor: null },
      }),
    };
    projectsService = {
      findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]),
    };
    router = buildRouter();
  });

  function parse(response: { result?: unknown }): Record<string, unknown> {
    const text = (response.result as { content: { text: string }[] }).content[0].text;
    return JSON.parse(text);
  }

  it('(a) happy path — gate findOne + findMany por idBloco (tasks idPai=null aparecem)', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_block_tasks', arguments: { blockId } },
      userCtx,
    );

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(userCtx.dEntidadeId);
    expect(tasksService.findOne).toHaveBeenCalledWith(blockId, [projectId]);
    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, idBloco: blockId, limit: 20 }),
      [projectId],
    );

    const payload = parse(response);
    expect(payload.blockId).toBe(blockId);
    expect(payload.items).toHaveLength(9);
    // tasks com idPai=null estao presentes (correcao do bug provado)
    expect((payload.items as Array<{ idPai: unknown }>).every((t) => t.idPai === null)).toBe(true);
    expect(payload.metrics).toBeUndefined();
  });

  it('(b) blockId ausente → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_block_tasks', arguments: {} },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({ code: -32602, data: expect.objectContaining({ field: 'blockId' }) }),
    );
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(tasksService.findMany).not.toHaveBeenCalled();
  });

  it('(c) blockId BigInt invalido → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_block_tasks', arguments: { blockId: 'not-bigint' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({ code: -32602, data: expect.objectContaining({ field: 'blockId' }) }),
    );
  });

  it('(d) includeMetrics=true → buckets done/failed/inProgress + percent (semantica do front)', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_block_tasks', arguments: { blockId, includeMetrics: true } },
      userCtx,
    );

    const payload = parse(response);
    // done = {DONE, VALIDATED, CANCELLED} = 3; failed = {FAILED, DISCARDED} = 2;
    // inProgress = {EXECUTING, VALIDATING} = 2; total = 9; percent = round(3/9*100) = 33
    expect(payload.metrics).toEqual({
      total: 9,
      done: 3,
      failed: 2,
      inProgress: 2,
      percent: 33,
    });
  });

  it('(e) includeMetrics omitido → payload sem metrics', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_block_tasks', arguments: { blockId } },
      userCtx,
    );

    expect(parse(response).metrics).toBeUndefined();
  });

  it('(f) includeMetrics tipo errado → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_block_tasks', arguments: { blockId, includeMetrics: 'yes' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: expect.objectContaining({ field: 'includeMetrics' }),
      }),
    );
  });

  it('(g) scope vazio → NotFoundException antes de findOne (anti-enumeration)', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce([]);

    await expect(
      router.dispatch('tools/call', { name: 'list_block_tasks', arguments: { blockId } }, userCtx),
    ).rejects.toThrow(NotFoundException);

    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(tasksService.findMany).not.toHaveBeenCalled();
  });

  it('(h) bloco fora do scope (findOne lança) → propaga NotFoundException', async () => {
    tasksService.findOne.mockRejectedValueOnce(
      new NotFoundException(`Task ${otherBlockId} não encontrada`),
    );

    await expect(
      router.dispatch(
        'tools/call',
        { name: 'list_block_tasks', arguments: { blockId: otherBlockId } },
        userCtx,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(tasksService.findMany).not.toHaveBeenCalled();
  });

  it('(i) bloco vazio → percent=0 e buckets zerados', async () => {
    tasksService.findMany.mockResolvedValueOnce({
      items: [],
      pagination: { hasMore: false, nextCursor: null },
    });

    const response = await router.dispatch(
      'tools/call',
      { name: 'list_block_tasks', arguments: { blockId, includeMetrics: true } },
      userCtx,
    );

    expect(parse(response).metrics).toEqual({
      total: 0,
      done: 0,
      failed: 0,
      inProgress: 0,
      percent: 0,
    });
  });

  it('(j) cursor + limit customizado propagados para findMany', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'list_block_tasks', arguments: { blockId, cursor: '7', limit: 10 } },
      userCtx,
    );

    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, idBloco: blockId, cursor: '7', limit: 10 }),
      [projectId],
    );
  });

  it('cursor invalido → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_block_tasks', arguments: { blockId, cursor: 'not-a-bigint' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({ code: -32602, data: expect.objectContaining({ field: 'cursor' }) }),
    );
  });

  it('limit fora de range → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_block_tasks', arguments: { blockId, limit: 999 } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({ code: -32602, data: expect.objectContaining({ field: 'limit' }) }),
    );
  });
});
