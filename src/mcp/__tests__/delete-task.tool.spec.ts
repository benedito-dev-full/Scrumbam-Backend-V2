import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { MCP_ERROR_CODES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpRouterService } from '../services/mcp-router.service';
import { DeleteTaskTool } from '../tools/delete-task.tool';
import { McpToolError } from '../tools/tool.interface';

/**
 * Specs para a tool MCP `delete_task` (ADR-V2-068 — scope catalog).
 *
 * Cobre o contrato:
 * (1) Happy path cascade default (ausente) → delete(taskId, [projectId], { cascade: undefined }, actor)
 * (2) cascade=false explícito → delete(..., { cascade: false }, ...) e envelope cascade=false
 * (3) cascade=true explícito → envelope cascade=true
 * (4) Scope tasks:write ausente → FORBIDDEN, tasksService não chamado
 * (5) scopes vazio → FORBIDDEN
 * (6) scopes undefined → FORBIDDEN
 * (7) taskId ausente → INVALID_PARAMS field=taskId
 * (8) taskId não-BigInt → INVALID_PARAMS field=taskId
 * (9) cascade não-boolean → INVALID_PARAMS field=cascade
 * (10) Task fora do tenant → NotFoundException propagado (delete não chamado)
 * (11) Sem membership no projeto → ForbiddenException propagado (delete não chamado)
 */
describe('MCP delete_task tool', () => {
  const taskId = '402';
  const projectId = '100';
  const entidadeId = BigInt(1);

  /** Contexto MCP padrão com scope tasks:write */
  const ctxWithScope: McpUserContext = {
    dEntidadeId: entidadeId,
    scopes: ['tasks:write'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  /** Contexto MCP sem scope tasks:write */
  const ctxWithoutScope: McpUserContext = {
    dEntidadeId: entidadeId,
    scopes: ['executions:create'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  /** Mock da task retornada pelo tasksService.findOne */
  const taskRecord = { id: taskId, projectId, nome: 'Task a deletar' };

  let tasksService: { findOne: jest.Mock; delete: jest.Mock };
  let projectsService: { findOne: jest.Mock };
  let tool: DeleteTaskTool;
  let router: McpRouterService;

  /** Monta um router com DeleteTaskTool na posição 17 (índice 0-based). */
  function buildRouter(t: DeleteTaskTool): McpRouterService {
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
      t, // deleteTaskTool
    );
  }

  beforeEach(() => {
    tasksService = {
      findOne: jest.fn().mockResolvedValue(taskRecord),
      delete: jest.fn().mockResolvedValue({ affected: 3 }),
    };
    projectsService = {
      findOne: jest.fn().mockResolvedValue({ id: projectId }),
    };

    tool = new DeleteTaskTool(tasksService as never, projectsService as never);
    router = buildRouter(tool);
  });

  // ─── (1) Happy path cascade default ──────────────────────────────────────

  it('(1) happy path cascade default (ausente) → delega com cascade undefined, envelope cascade=true', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'delete_task', arguments: { taskId } },
      ctxWithScope,
    );

    // Tenant + membership
    expect(tasksService.findOne).toHaveBeenCalledWith(taskId);
    expect(projectsService.findOne).toHaveBeenCalledWith(
      taskRecord.projectId,
      ctxWithScope.dEntidadeId,
    );
    // Delegação: accessibleProjectIds=[projectId], cascade=undefined, actor=ctx.dEntidadeId
    expect(tasksService.delete).toHaveBeenCalledWith(
      taskId,
      [projectId],
      { cascade: undefined },
      ctxWithScope.dEntidadeId,
    );

    expect(response.error).toBeUndefined();
    const parsed = JSON.parse(
      (response.result as { content: Array<{ type: string; text: string }> }).content[0].text,
    );
    expect(parsed).toEqual({
      deleted: true,
      taskId,
      cascade: true, // default efetivo
      affected: 3,
    });
  });

  // ─── (2) cascade=false ───────────────────────────────────────────────────

  it('(2) cascade=false → delega { cascade: false } e envelope cascade=false', async () => {
    tasksService.delete.mockResolvedValueOnce({ affected: 1 });

    const response = await router.dispatch(
      'tools/call',
      { name: 'delete_task', arguments: { taskId, cascade: false } },
      ctxWithScope,
    );

    expect(tasksService.delete).toHaveBeenCalledWith(
      taskId,
      [projectId],
      { cascade: false },
      ctxWithScope.dEntidadeId,
    );

    expect(response.error).toBeUndefined();
    const parsed = JSON.parse(
      (response.result as { content: Array<{ type: string; text: string }> }).content[0].text,
    );
    expect(parsed).toEqual({
      deleted: true,
      taskId,
      cascade: false,
      affected: 1,
    });
  });

  // ─── (3) cascade=true ────────────────────────────────────────────────────

  it('(3) cascade=true → delega { cascade: true } e envelope cascade=true', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'delete_task', arguments: { taskId, cascade: true } },
      ctxWithScope,
    );

    expect(tasksService.delete).toHaveBeenCalledWith(
      taskId,
      [projectId],
      { cascade: true },
      ctxWithScope.dEntidadeId,
    );

    const parsed = JSON.parse(
      (response.result as { content: Array<{ type: string; text: string }> }).content[0].text,
    );
    expect(parsed.cascade).toBe(true);
  });

  // ─── (4) Scope ausente → FORBIDDEN ───────────────────────────────────────

  it('(4) scope tasks:write ausente → FORBIDDEN (-32002), tasksService nao chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'delete_task', arguments: { taskId } },
      ctxWithoutScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.FORBIDDEN,
        data: { requiredScope: 'tasks:write' },
      }),
    );
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(projectsService.findOne).not.toHaveBeenCalled();
    expect(tasksService.delete).not.toHaveBeenCalled();
  });

  // ─── (5) scopes vazio → FORBIDDEN ────────────────────────────────────────

  it('(5) scopes vazio → FORBIDDEN', async () => {
    const ctxEmpty: McpUserContext = { ...ctxWithScope, scopes: [] };

    const response = await router.dispatch(
      'tools/call',
      { name: 'delete_task', arguments: { taskId } },
      ctxEmpty,
    );

    expect(response.error).toEqual(expect.objectContaining({ code: MCP_ERROR_CODES.FORBIDDEN }));
    expect(tasksService.findOne).not.toHaveBeenCalled();
  });

  // ─── (6) scopes undefined → FORBIDDEN ────────────────────────────────────

  it('(6) scopes undefined (coerced) → FORBIDDEN', async () => {
    const ctxUndef = {
      ...ctxWithScope,
      scopes: undefined as unknown as string[],
    };

    const response = await router.dispatch(
      'tools/call',
      { name: 'delete_task', arguments: { taskId } },
      ctxUndef,
    );

    expect(response.error).toEqual(expect.objectContaining({ code: MCP_ERROR_CODES.FORBIDDEN }));
    expect(tasksService.findOne).not.toHaveBeenCalled();
  });

  // ─── (7) taskId ausente → INVALID_PARAMS ─────────────────────────────────

  it('(7) taskId ausente → INVALID_PARAMS com field=taskId', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'delete_task', arguments: {} },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: expect.objectContaining({ field: 'taskId' }),
      }),
    );
    expect(tasksService.findOne).not.toHaveBeenCalled();
  });

  // ─── (8) taskId não-BigInt → INVALID_PARAMS ──────────────────────────────

  it('(8) taskId nao-BigInt ("abc") → INVALID_PARAMS com field=taskId', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'delete_task', arguments: { taskId: 'abc' } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'taskId', issue: 'valid bigint string expected' },
      }),
    );
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(tasksService.delete).not.toHaveBeenCalled();
  });

  // ─── (9) cascade não-boolean → INVALID_PARAMS ────────────────────────────

  it('(9) cascade nao-boolean ("yes") → INVALID_PARAMS com field=cascade', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'delete_task', arguments: { taskId, cascade: 'yes' } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'cascade', issue: 'boolean expected' },
      }),
    );
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(tasksService.delete).not.toHaveBeenCalled();
  });

  // ─── (10) Task fora do tenant → NotFoundException propagado ──────────────

  it('(10) task fora do tenant → NotFoundException propagado', async () => {
    tasksService.findOne.mockRejectedValueOnce(
      new NotFoundException(`Task ${taskId} não encontrada`),
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'delete_task', arguments: { taskId } },
      ctxWithScope,
    );
    expect(response.error).toEqual(expect.objectContaining({ code: MCP_ERROR_CODES.NOT_FOUND }));

    expect(projectsService.findOne).not.toHaveBeenCalled();
    expect(tasksService.delete).not.toHaveBeenCalled();
  });

  // ─── (11) Sem membership → ForbiddenException propagado ──────────────────

  it('(11) sem membership no projeto → ForbiddenException propagado', async () => {
    projectsService.findOne.mockRejectedValueOnce(
      new ForbiddenException(`Usuário sem membership no projeto ${projectId}`),
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'delete_task', arguments: { taskId } },
      ctxWithScope,
    );
    expect(response.error).toEqual(expect.objectContaining({ code: MCP_ERROR_CODES.FORBIDDEN }));

    expect(tasksService.findOne).toHaveBeenCalledWith(taskId);
    expect(tasksService.delete).not.toHaveBeenCalled();
  });

  // ─── Extra: handler direto sem router ────────────────────────────────────

  it('(extra) handler direto: FORBIDDEN quando sem scope tasks:write', async () => {
    await expect(tool.handler({ taskId }, ctxWithoutScope)).rejects.toBeInstanceOf(McpToolError);

    try {
      await tool.handler({ taskId }, ctxWithoutScope);
    } catch (err) {
      expect(err).toBeInstanceOf(McpToolError);
      const mcpErr = err as McpToolError;
      expect(mcpErr.code).toBe(MCP_ERROR_CODES.FORBIDDEN);
      expect((mcpErr.data as { requiredScope: string }).requiredScope).toBe('tasks:write');
    }
  });
});
