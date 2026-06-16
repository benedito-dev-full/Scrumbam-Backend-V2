import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { MCP_ERROR_CODES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpRouterService } from '../services/mcp-router.service';
import { UpdateTimerTool } from '../tools/update-timer.tool';
import { McpToolError } from '../tools/tool.interface';

/**
 * Specs para a tool MCP `update_timer` (Fase 3 — suíte de testes).
 *
 * Cobre 12 casos conforme contrato ADR-V2-057/067:
 * (1)  Happy path start  → envelope action='start', timer.running=true
 * (2)  Happy path pause  → envelope action='pause', timer.running=false
 * (3)  Happy path resume → envelope action='resume', timer.running=true
 * (4)  ConflictException → INVALID_PARAMS reason='timer_conflict'
 * (5)  Scope tasks:write ausente → FORBIDDEN, tasksService não chamado
 * (6)  Task fora do tenant → NotFoundException propagado
 * (7)  scopes vazio → FORBIDDEN
 * (8)  scopes undefined → FORBIDDEN
 * (9)  action inválida → INVALID_PARAMS com field='action'
 * (10) taskId ausente → INVALID_PARAMS com field='taskId'
 * (11) taskId não-BigInt → INVALID_PARAMS com field='taskId'
 * (12) Happy path stop + sem membership → ForbiddenException propagado
 */
describe('MCP update_timer tool', () => {
  const taskId = '402';
  const projectId = '100';
  const entidadeId = BigInt(1);
  const createdAt = '2026-06-15T14:30:00.000Z';

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
  const taskRecord = { id: taskId, projectId, nome: 'Implementar timer MCP' };

  /** Mock de timer rodando (start/resume) */
  const timerRunning = {
    running: true,
    runningUserId: entidadeId.toString(),
    runningStartedAt: createdAt,
    totalsByUser: [],
  };

  /** Mock de timer parado (pause/stop) */
  const timerStopped = {
    running: false,
    runningUserId: null,
    runningStartedAt: null,
    totalsByUser: [{ userId: entidadeId.toString(), totalMs: 3600000 }],
  };

  let tasksService: { findOne: jest.Mock; timer: jest.Mock };
  let projectsService: { findOne: jest.Mock };
  let tool: UpdateTimerTool;
  let router: McpRouterService;

  beforeEach(() => {
    tasksService = {
      findOne: jest.fn().mockResolvedValue(taskRecord),
      timer: jest.fn().mockResolvedValue({ timer: timerRunning }),
    };
    projectsService = {
      findOne: jest.fn().mockResolvedValue({ id: projectId }),
    };

    tool = new UpdateTimerTool(tasksService as never, projectsService as never);

    // UpdateTimerTool está na posição 16 (índice 0-based) no router
    router = new McpRouterService(
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
      tool, // updateTimerTool
    );
  });

  // ─── (1) Happy path start ─────────────────────────────────────────────────

  it('(1) happy path start → envelope taskId, action=start, timer.running=true', async () => {
    tasksService.timer.mockResolvedValueOnce({ timer: timerRunning });

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_timer', arguments: { taskId, action: 'start' } },
      ctxWithScope,
    );

    // Tenant isolation: findOne chamado com taskId e dEntidadeId
    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, ctxWithScope.dEntidadeId);
    // Membership: projectsService.findOne chamado com projectId e dEntidadeId
    expect(projectsService.findOne).toHaveBeenCalledWith(
      taskRecord.projectId,
      ctxWithScope.dEntidadeId,
    );
    // Delegação ao service: actorId=ctx.dEntidadeId, accessibleProjectIds=undefined
    expect(tasksService.timer).toHaveBeenCalledWith(
      taskId,
      'start',
      ctxWithScope.dEntidadeId,
      undefined,
    );

    // Envelope de resposta
    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
    const parsed = JSON.parse(
      (response.result as { content: Array<{ type: string; text: string }> }).content[0].text,
    );
    expect(parsed).toMatchObject({
      taskId,
      action: 'start',
      timer: { running: true },
    });
  });

  // ─── (2) Happy path pause ─────────────────────────────────────────────────

  it('(2) happy path pause → envelope action=pause, timer.running=false', async () => {
    tasksService.timer.mockResolvedValueOnce({ timer: timerStopped });

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_timer', arguments: { taskId, action: 'pause' } },
      ctxWithScope,
    );

    expect(response.error).toBeUndefined();
    const parsed = JSON.parse(
      (response.result as { content: Array<{ type: string; text: string }> }).content[0].text,
    );
    expect(parsed).toMatchObject({
      taskId,
      action: 'pause',
      timer: { running: false },
    });
    expect(tasksService.timer).toHaveBeenCalledWith(
      taskId,
      'pause',
      ctxWithScope.dEntidadeId,
      undefined,
    );
  });

  // ─── (3) Happy path resume ────────────────────────────────────────────────

  it('(3) happy path resume → envelope action=resume, timer.running=true', async () => {
    tasksService.timer.mockResolvedValueOnce({ timer: timerRunning });

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_timer', arguments: { taskId, action: 'resume' } },
      ctxWithScope,
    );

    expect(response.error).toBeUndefined();
    const parsed = JSON.parse(
      (response.result as { content: Array<{ type: string; text: string }> }).content[0].text,
    );
    expect(parsed).toMatchObject({
      taskId,
      action: 'resume',
      timer: { running: true },
    });
    expect(tasksService.timer).toHaveBeenCalledWith(
      taskId,
      'resume',
      ctxWithScope.dEntidadeId,
      undefined,
    );
  });

  // ─── (4) ConflictException → INVALID_PARAMS reason=timer_conflict ─────────

  it('(4) ConflictException do timer → INVALID_PARAMS reason=timer_conflict', async () => {
    const conflictMsg = 'Já existe um timer em andamento nesta task';
    tasksService.timer.mockRejectedValueOnce(new ConflictException(conflictMsg));

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_timer', arguments: { taskId, action: 'start' } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        message: 'Timer conflict',
        data: {
          reason: 'timer_conflict',
          detail: conflictMsg,
        },
      }),
    );
    // Não deve ser resultado normal
    expect(response.result).toBeUndefined();
  });

  // ─── (5) Scope tasks:write ausente → FORBIDDEN ────────────────────────────

  it('(5) scope tasks:write ausente → FORBIDDEN (-32002), tasksService nao chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_timer', arguments: { taskId, action: 'start' } },
      ctxWithoutScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.FORBIDDEN,
        data: { requiredScope: 'tasks:write' },
      }),
    );
    // Gate de autorização deve ocorrer antes de qualquer query
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(projectsService.findOne).not.toHaveBeenCalled();
    expect(tasksService.timer).not.toHaveBeenCalled();
  });

  // ─── (6) Task fora do tenant → NotFoundException propagado ───────────────

  it('(6) task fora do tenant → NotFoundException propagado', async () => {
    tasksService.findOne.mockRejectedValueOnce(
      new NotFoundException(`Task ${taskId} não encontrada`),
    );

    await expect(
      router.dispatch(
        'tools/call',
        { name: 'update_timer', arguments: { taskId, action: 'start' } },
        ctxWithScope,
      ),
    ).rejects.toThrow(NotFoundException);

    // projectsService e timer não devem ser chamados se findOne falhou
    expect(projectsService.findOne).not.toHaveBeenCalled();
    expect(tasksService.timer).not.toHaveBeenCalled();
  });

  // ─── (7) scopes vazio → FORBIDDEN ────────────────────────────────────────

  it('(7) scopes vazio → FORBIDDEN', async () => {
    const ctxEmptyScopes: McpUserContext = {
      ...ctxWithScope,
      scopes: [],
    };

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_timer', arguments: { taskId, action: 'start' } },
      ctxEmptyScopes,
    );

    expect(response.error).toEqual(expect.objectContaining({ code: MCP_ERROR_CODES.FORBIDDEN }));
    expect(tasksService.findOne).not.toHaveBeenCalled();
  });

  // ─── (8) scopes undefined → FORBIDDEN ────────────────────────────────────

  it('(8) scopes undefined (coerced) → FORBIDDEN', async () => {
    const ctxUndefinedScopes = {
      ...ctxWithScope,
      scopes: undefined as unknown as string[],
    };

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_timer', arguments: { taskId, action: 'start' } },
      ctxUndefinedScopes,
    );

    expect(response.error).toEqual(expect.objectContaining({ code: MCP_ERROR_CODES.FORBIDDEN }));
    expect(tasksService.findOne).not.toHaveBeenCalled();
  });

  // ─── (9) action inválida → INVALID_PARAMS com field='action' ─────────────

  it('(9) action invalida ("foo") → INVALID_PARAMS com field=action', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_timer', arguments: { taskId, action: 'foo' } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: expect.objectContaining({ field: 'action' }),
      }),
    );
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(tasksService.timer).not.toHaveBeenCalled();
  });

  // ─── (10) taskId ausente → INVALID_PARAMS ────────────────────────────────

  it('(10) taskId ausente → INVALID_PARAMS com field=taskId', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_timer', arguments: { action: 'start' } },
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

  // ─── (11) taskId não-BigInt → INVALID_PARAMS ─────────────────────────────

  it('(11) taskId nao-BigInt ("abc") → INVALID_PARAMS com field=taskId', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_timer', arguments: { taskId: 'abc', action: 'start' } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'taskId', issue: 'valid bigint string expected' },
      }),
    );
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(tasksService.timer).not.toHaveBeenCalled();
  });

  // ─── (12) stop happy + sem membership ────────────────────────────────────

  it('(12a) happy path stop → envelope action=stop, timer.running=false', async () => {
    tasksService.timer.mockResolvedValueOnce({ timer: timerStopped });

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_timer', arguments: { taskId, action: 'stop' } },
      ctxWithScope,
    );

    expect(response.error).toBeUndefined();
    const parsed = JSON.parse(
      (response.result as { content: Array<{ type: string; text: string }> }).content[0].text,
    );
    expect(parsed).toMatchObject({
      taskId,
      action: 'stop',
      timer: { running: false },
    });
    expect(tasksService.timer).toHaveBeenCalledWith(
      taskId,
      'stop',
      ctxWithScope.dEntidadeId,
      undefined,
    );
  });

  it('(12b) sem membership no projeto → ForbiddenException propagado', async () => {
    projectsService.findOne.mockRejectedValueOnce(
      new ForbiddenException(`Usuário sem membership no projeto ${projectId}`),
    );

    await expect(
      router.dispatch(
        'tools/call',
        { name: 'update_timer', arguments: { taskId, action: 'start' } },
        ctxWithScope,
      ),
    ).rejects.toThrow(ForbiddenException);

    // findOne foi chamado (passou pela etapa de tenant)
    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, ctxWithScope.dEntidadeId);
    // timer não deve ser chamado se membership falhou
    expect(tasksService.timer).not.toHaveBeenCalled();
  });

  // ─── Extra: handler direto sem router ─────────────────────────────────────

  it('(extra) handler direto: FORBIDDEN quando sem scope tasks:write', async () => {
    await expect(tool.handler({ taskId, action: 'start' }, ctxWithoutScope)).rejects.toBeInstanceOf(
      McpToolError,
    );

    try {
      await tool.handler({ taskId, action: 'start' }, ctxWithoutScope);
    } catch (err) {
      expect(err).toBeInstanceOf(McpToolError);
      const mcpErr = err as McpToolError;
      expect(mcpErr.code).toBe(MCP_ERROR_CODES.FORBIDDEN);
      expect((mcpErr.data as { requiredScope: string }).requiredScope).toBe('tasks:write');
    }
  });
});
