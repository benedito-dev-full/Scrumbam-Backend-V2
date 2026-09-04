import { NotFoundException } from '@nestjs/common';

import { MCP_ERROR_CODES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpRouterService } from '../services/mcp-router.service';
import { ListMyTasksTool } from '../tools/list-my-tasks.tool';

/**
 * Specs para a tool MCP `list_my_tasks` (PR1 — tasks:read).
 *
 * Contrato:
 * (1) sem scope tasks:read → FORBIDDEN (-32002), nenhum service chamado.
 * (2) status inválido → INVALID_PARAMS field=status.
 * (3) projectId não-BigInt → INVALID_PARAMS field=projectId.
 * (4) cursor não-BigInt → INVALID_PARAMS field=cursor.
 * (5) scope vazio (sem projectId) → lista vazia, NÃO lança.
 * (6) anti-fraude: assigneeId do input é IGNORADO; findMany recebe ctx.dEntidadeId.
 * (7) happy path com projectId → findOne gate + findMany com projectId.
 * (8) happy path sem projectId → findMany com projectIds = scope.
 * (9) projectId fora do escopo → NotFoundException propagado.
 */
describe('MCP list_my_tasks tool', () => {
  const entidadeId = BigInt(7);

  const ctxWithScope: McpUserContext = {
    dEntidadeId: entidadeId,
    scopes: ['tasks:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  const ctxNoScope: McpUserContext = { ...ctxWithScope, scopes: ['tasks:write'] };

  const findManyResult = {
    items: [{ id: '1', titulo: 'Minha task' }],
    pagination: { hasMore: false, nextCursor: null },
  };

  let tasksService: { findMany: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock; findOne: jest.Mock };
  let tool: ListMyTasksTool;
  let router: McpRouterService;

  /** Router com ListMyTasksTool na posição 20 (0-based). */
  function buildRouter(t: ListMyTasksTool): McpRouterService {
    return new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      undefined, // getTaskTool
      undefined, // updateTaskTool
      undefined, // listMembersTool
      undefined, // getProjectTool
      undefined, // updateProjectTool
      undefined, // listNotificationsTool
      undefined, // updateNotificationTool
      undefined, // getUnreadCountTool
      undefined, // searchTasksTool
      undefined, // listBlocksTool
      undefined, // listBlockTasksTool
      undefined, // executeTaskTool
      undefined, // updateTimerTool
      undefined, // deleteTaskTool
      undefined, // getTaskTreeTool
      undefined, // getProjectMetricsTool
      t, // listMyTasksTool
    );
  }

  function parse(response: { result?: unknown }): Record<string, unknown> {
    return JSON.parse(
      (response.result as { content: Array<{ text: string }> }).content[0].text,
    ) as Record<string, unknown>;
  }

  beforeEach(() => {
    tasksService = { findMany: jest.fn().mockResolvedValue(findManyResult) };
    projectsService = {
      findAccessibleProjectIds: jest.fn().mockResolvedValue(['100', '200']),
      findOne: jest.fn().mockResolvedValue({ id: '100' }),
    };
    tool = new ListMyTasksTool(tasksService as never, projectsService as never);
    router = buildRouter(tool);
  });

  it('(1) sem scope tasks:read → FORBIDDEN, nenhum service chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_my_tasks', arguments: {} },
      ctxNoScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.FORBIDDEN,
        data: { requiredScope: 'tasks:read' },
      }),
    );
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
    expect(tasksService.findMany).not.toHaveBeenCalled();
  });

  it('(2) status inválido → INVALID_PARAMS field=status', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_my_tasks', arguments: { status: 'BOGUS' } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: expect.objectContaining({ field: 'status' }),
      }),
    );
    expect(tasksService.findMany).not.toHaveBeenCalled();
  });

  it('(3) projectId não-BigInt → INVALID_PARAMS field=projectId', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_my_tasks', arguments: { projectId: 'abc' } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'projectId', issue: 'valid bigint string expected' },
      }),
    );
    expect(tasksService.findMany).not.toHaveBeenCalled();
  });

  it('(4) cursor não-BigInt → INVALID_PARAMS field=cursor', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_my_tasks', arguments: { cursor: 'xyz' } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'cursor', issue: 'valid bigint string expected' },
      }),
    );
  });

  it('(5) scope vazio (sem projectId) → lista vazia, não lança', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce([]);

    const response = await router.dispatch(
      'tools/call',
      { name: 'list_my_tasks', arguments: {} },
      ctxWithScope,
    );

    expect(response.error).toBeUndefined();
    expect(parse(response)).toEqual({
      items: [],
      pagination: { hasMore: false, nextCursor: null },
    });
    expect(tasksService.findMany).not.toHaveBeenCalled();
  });

  it('(6) anti-fraude: assigneeId do input é ignorado; findMany recebe ctx.dEntidadeId', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'list_my_tasks', arguments: { assigneeId: '999' } },
      ctxWithScope,
    );

    expect(tasksService.findMany).toHaveBeenCalledTimes(1);
    const [query] = tasksService.findMany.mock.calls[0];
    expect(query.assigneeId).toBe(entidadeId.toString());
    expect(query.assigneeId).not.toBe('999');
  });

  it('(7) happy path com projectId → findOne gate + findMany com projectId', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_my_tasks', arguments: { projectId: '100', status: 'READY', limit: 10 } },
      ctxWithScope,
    );

    expect(projectsService.findOne).toHaveBeenCalledWith('100', entidadeId);
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: entidadeId.toString(),
        projectId: '100',
        status: 'READY',
        limit: 10,
      }),
      ['100'],
    );
    expect(response.error).toBeUndefined();
    expect(parse(response)).toEqual(findManyResult);
  });

  it('(8) happy path sem projectId → findMany com projectIds = scope', async () => {
    await router.dispatch('tools/call', { name: 'list_my_tasks', arguments: {} }, ctxWithScope);

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(entidadeId);
    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: entidadeId.toString(),
        projectIds: ['100', '200'],
      }),
      ['100', '200'],
    );
    const [query] = tasksService.findMany.mock.calls[0];
    expect(query.projectId).toBeUndefined();
  });

  it('(9) projectId fora do escopo → NotFoundException propagado', async () => {
    projectsService.findOne.mockRejectedValueOnce(
      new NotFoundException('Projeto 999 não encontrado'),
    );

    const response = await router.dispatch(
        'tools/call',
        { name: 'list_my_tasks', arguments: { projectId: '999' } },
        ctxWithScope,
      );
    expect(response.error).toEqual(
      expect.objectContaining({ code: MCP_ERROR_CODES.NOT_FOUND }),
    );

    expect(tasksService.findMany).not.toHaveBeenCalled();
  });
});
