import { NotFoundException } from '@nestjs/common';

import { MCP_ERROR_CODES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpRouterService } from '../services/mcp-router.service';
import { GetTaskTreeTool } from '../tools/get-task-tree.tool';

/**
 * Specs para a tool MCP `get_task_tree` (PR1 — tasks:read).
 *
 * Contrato:
 * (1) sem scope → FORBIDDEN, nenhum service chamado.
 * (2) taskId ausente / não-BigInt → INVALID_PARAMS field=taskId.
 * (3) maxDepth fora de 1-20 ou não-inteiro → INVALID_PARAMS field=maxDepth.
 * (4) includeMetrics não-boolean → INVALID_PARAMS field=includeMetrics.
 * (5) scope vazio → NotFoundException (anti-enumeration).
 * (6) findOne lança NotFound (fora do escopo) → propaga, buildTree não chamado.
 * (7) happy path → buildTree(BigInt(taskId), { maxDepth, includeMetrics }).
 */
describe('MCP get_task_tree tool', () => {
  const taskId = '500';
  const entidadeId = BigInt(3);

  const ctxWithScope: McpUserContext = {
    dEntidadeId: entidadeId,
    scopes: ['tasks:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  const ctxNoScope: McpUserContext = { ...ctxWithScope, scopes: ['tasks:write'] };

  const treeResult = { root: { id: taskId, children: [] }, totalNodes: 1, maxDepthReached: 0 };

  let phaseTreeService: { buildTree: jest.Mock };
  let tasksService: { findOne: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let tool: GetTaskTreeTool;
  let router: McpRouterService;

  /** Router com GetTaskTreeTool na posição 18 (0-based). */
  function buildRouter(t: GetTaskTreeTool): McpRouterService {
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
      t, // getTaskTreeTool
    );
  }

  function parse(response: { result?: unknown }): Record<string, unknown> {
    return JSON.parse(
      (response.result as { content: Array<{ text: string }> }).content[0].text,
    ) as Record<string, unknown>;
  }

  beforeEach(() => {
    phaseTreeService = { buildTree: jest.fn().mockResolvedValue(treeResult) };
    tasksService = { findOne: jest.fn().mockResolvedValue({ id: taskId, projectId: '100' }) };
    projectsService = {
      findAccessibleProjectIds: jest.fn().mockResolvedValue(['100']),
    };
    tool = new GetTaskTreeTool(
      phaseTreeService as never,
      tasksService as never,
      projectsService as never,
    );
    router = buildRouter(tool);
  });

  it('(1) sem scope → FORBIDDEN', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_task_tree', arguments: { taskId } },
      ctxNoScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.FORBIDDEN,
        data: { requiredScope: 'tasks:read' },
      }),
    );
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
    expect(phaseTreeService.buildTree).not.toHaveBeenCalled();
  });

  it('(2a) taskId ausente → INVALID_PARAMS field=taskId', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_task_tree', arguments: {} },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: expect.objectContaining({ field: 'taskId' }),
      }),
    );
  });

  it('(2b) taskId não-BigInt → INVALID_PARAMS field=taskId', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_task_tree', arguments: { taskId: 'abc' } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'taskId', issue: 'valid bigint string expected' },
      }),
    );
  });

  it('(3a) maxDepth=0 → INVALID_PARAMS field=maxDepth', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_task_tree', arguments: { taskId, maxDepth: 0 } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: expect.objectContaining({ field: 'maxDepth' }),
      }),
    );
    expect(phaseTreeService.buildTree).not.toHaveBeenCalled();
  });

  it('(3b) maxDepth=21 → INVALID_PARAMS field=maxDepth', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_task_tree', arguments: { taskId, maxDepth: 21 } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({ data: expect.objectContaining({ field: 'maxDepth' }) }),
    );
  });

  it('(3c) maxDepth não-inteiro → INVALID_PARAMS field=maxDepth', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_task_tree', arguments: { taskId, maxDepth: 2.5 } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({ data: expect.objectContaining({ field: 'maxDepth' }) }),
    );
  });

  it('(4) includeMetrics não-boolean → INVALID_PARAMS field=includeMetrics', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_task_tree', arguments: { taskId, includeMetrics: 'yes' } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'includeMetrics', issue: 'boolean expected' },
      }),
    );
  });

  it('(5) scope vazio → NotFoundException (anti-enumeration)', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce([]);

    const response = await router.dispatch('tools/call', { name: 'get_task_tree', arguments: { taskId } }, ctxWithScope);
    expect(response.error).toEqual(
      expect.objectContaining({ code: MCP_ERROR_CODES.NOT_FOUND }),
    );

    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(phaseTreeService.buildTree).not.toHaveBeenCalled();
  });

  it('(6) findOne fora do escopo → NotFoundException propagado, buildTree não chamado', async () => {
    tasksService.findOne.mockRejectedValueOnce(
      new NotFoundException(`Task ${taskId} não encontrada`),
    );

    const response = await router.dispatch('tools/call', { name: 'get_task_tree', arguments: { taskId } }, ctxWithScope);
    expect(response.error).toEqual(
      expect.objectContaining({ code: MCP_ERROR_CODES.NOT_FOUND }),
    );

    expect(phaseTreeService.buildTree).not.toHaveBeenCalled();
  });

  it('(7) happy path → buildTree com BigInt(taskId) e opções', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_task_tree', arguments: { taskId, maxDepth: 3, includeMetrics: true } },
      ctxWithScope,
    );

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(entidadeId);
    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, ['100']);
    expect(phaseTreeService.buildTree).toHaveBeenCalledWith(BigInt(taskId), {
      maxDepth: 3,
      includeMetrics: true,
    });
    expect(response.error).toBeUndefined();
    expect(parse(response)).toEqual(treeResult);
  });

  it('(7b) happy path sem maxDepth → buildTree com includeMetrics=false (default), sem maxDepth', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'get_task_tree', arguments: { taskId } },
      ctxWithScope,
    );

    expect(phaseTreeService.buildTree).toHaveBeenCalledWith(BigInt(taskId), {
      includeMetrics: false,
    });
  });
});
