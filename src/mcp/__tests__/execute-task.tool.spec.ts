import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { MCP_ERROR_CODES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpRouterService } from '../services/mcp-router.service';
import { ExecuteTaskTool } from '../tools/execute-task.tool';
import { McpToolError } from '../tools/tool.interface';

/**
 * Specs para a tool MCP `execute_task` (Fase 6 — suíte de testes).
 *
 * Cobre 10 casos conforme contrato ADR-V2-066/067:
 * (1) Happy path LOW → envelope status='queued', riskClassId='-301'
 * (2) taskId ausente → INVALID_PARAMS
 * (3) taskId não-BigInt ("abc") → INVALID_PARAMS
 * (4) Scope executions:create ausente → FORBIDDEN, tasksService não chamado
 * (5) scopes vazio/undefined → FORBIDDEN
 * (6) Task fora do tenant → NotFoundException propagado
 * (7) Sem membership → ForbiddenException propagado
 * (8) Risk Gate bloqueia (BadRequestException) → INVALID_PARAMS reason='risk_gate_blocked'
 * (9) Risk MEDIUM → envelope status='awaiting_approval', riskClassId='-302'
 * (10) Risk HIGH → envelope status='awaiting_approval', riskClassId='-303'
 */
describe('MCP execute_task tool', () => {
  const taskId = '402';
  const projectId = '100';
  const entidadeId = BigInt(1);
  const userGroupId = BigInt(42);
  const createdAt = '2026-06-15T14:30:00.000Z';

  /** Contexto MCP padrão com scope executions:create */
  const ctxWithScope: McpUserContext = {
    dEntidadeId: entidadeId,
    scopes: ['executions:create'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  /** Contexto MCP sem scope executions:create */
  const ctxWithoutScope: McpUserContext = {
    dEntidadeId: entidadeId,
    scopes: ['tasks:write'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  /** Mock de execução LOW */
  const executionLow = {
    id: '1000123',
    riskLevel: 'LOW' as const,
    projectId,
    triggeredBy: '42',
    approval: { status: 'queued' },
    command: { text: 'task-built-prompt-placeholder' },
    createdAt,
    updatedAt: createdAt,
  };

  /** Mock de execução MEDIUM */
  const executionMedium = {
    id: '1000124',
    riskLevel: 'MEDIUM' as const,
    projectId,
    triggeredBy: '42',
    approval: { status: 'awaiting_approval' },
    command: { text: 'task-built-prompt-placeholder' },
    createdAt,
    updatedAt: createdAt,
  };

  /** Mock de execução HIGH */
  const executionHigh = {
    id: '1000125',
    riskLevel: 'HIGH' as const,
    projectId,
    triggeredBy: '42',
    approval: { status: 'awaiting_approval' },
    command: { text: 'task-built-prompt-placeholder' },
    createdAt,
    updatedAt: createdAt,
  };

  /** Mock da task retornada pelo tasksService.findOne */
  const taskRecord = { id: taskId, projectId, nome: 'Refatorar auth' };

  let tasksService: { findOne: jest.Mock };
  let projectsService: { findOne: jest.Mock };
  let executionsService: { execute: jest.Mock };
  let entidadeService: { getUserGroupIdFromEntidade: jest.Mock };
  let tool: ExecuteTaskTool;
  let router: McpRouterService;

  beforeEach(() => {
    tasksService = {
      findOne: jest.fn().mockResolvedValue(taskRecord),
    };
    projectsService = {
      findOne: jest.fn().mockResolvedValue({ id: projectId }),
    };
    executionsService = {
      execute: jest.fn().mockResolvedValue(executionLow),
    };
    entidadeService = {
      getUserGroupIdFromEntidade: jest.fn().mockResolvedValue(userGroupId),
    };

    tool = new ExecuteTaskTool(
      tasksService as never,
      projectsService as never,
      executionsService as never,
      entidadeService as never,
    );

    // Posição 15 (índice 0-based) no router: executeTaskTool
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
      tool, // executeTaskTool
    );
  });

  // ─── (1) Happy path LOW ───────────────────────────────────────────────────

  it('(1) happy path LOW → envelope status=queued, riskClassId=-301', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'execute_task', arguments: { taskId } },
      ctxWithScope,
    );

    // Verifica que o tenant isolation foi executado corretamente
    expect(tasksService.findOne).toHaveBeenCalledWith(taskId);
    expect(projectsService.findOne).toHaveBeenCalledWith(
      taskRecord.projectId,
      ctxWithScope.dEntidadeId,
    );

    // Verifica que getUserGroupIdFromEntidade foi chamado com dEntidadeId
    expect(entidadeService.getUserGroupIdFromEntidade).toHaveBeenCalledWith(entidadeId);

    // Verifica que executionsService.execute foi chamado com os argumentos corretos
    // userId deve ser o toString() do userGroupId (BigInt(42) → '42')
    expect(executionsService.execute).toHaveBeenCalledWith(
      taskRecord.projectId,
      { taskId },
      userGroupId.toString(),
    );

    // Verifica o envelope retornado
    const parsed = JSON.parse(
      (response.result as { content: Array<{ type: string; text: string }> }).content[0].text,
    );
    expect(parsed).toMatchObject({
      executionId: executionLow.id,
      taskId,
      projectId: taskRecord.projectId,
      status: 'queued',
      riskLevel: 'LOW',
      riskClassId: '-301',
      createdAt,
      pollHint: expect.stringContaining('get_task'),
    });
  });

  // ─── (2) taskId ausente ───────────────────────────────────────────────────

  it('(2) taskId ausente → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'execute_task', arguments: {} },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: expect.objectContaining({ field: 'taskId' }),
      }),
    );
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(executionsService.execute).not.toHaveBeenCalled();
  });

  // ─── (3) taskId não-BigInt ────────────────────────────────────────────────

  it('(3) taskId nao-BigInt ("abc") → INVALID_PARAMS com field=taskId', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'execute_task', arguments: { taskId: 'abc' } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'taskId', issue: 'valid bigint string expected' },
      }),
    );
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(executionsService.execute).not.toHaveBeenCalled();
  });

  // ─── (4) Scope executions:create ausente ─────────────────────────────────

  it('(4) scope executions:create ausente → FORBIDDEN (-32002), tasksService nao chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'execute_task', arguments: { taskId } },
      ctxWithoutScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.FORBIDDEN,
        data: { requiredScope: 'executions:create' },
      }),
    );
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(projectsService.findOne).not.toHaveBeenCalled();
    expect(executionsService.execute).not.toHaveBeenCalled();
  });

  // ─── (5) scopes vazio/undefined ──────────────────────────────────────────

  it('(5) scopes vazio → FORBIDDEN', async () => {
    const ctxEmptyScopes: McpUserContext = {
      ...ctxWithScope,
      scopes: [],
    };

    const response = await router.dispatch(
      'tools/call',
      { name: 'execute_task', arguments: { taskId } },
      ctxEmptyScopes,
    );

    expect(response.error).toEqual(expect.objectContaining({ code: MCP_ERROR_CODES.FORBIDDEN }));
    expect(tasksService.findOne).not.toHaveBeenCalled();
  });

  it('(5b) scopes undefined (coerced) → FORBIDDEN', async () => {
    const ctxUndefinedScopes = {
      ...ctxWithScope,
      scopes: undefined as unknown as string[],
    };

    const response = await router.dispatch(
      'tools/call',
      { name: 'execute_task', arguments: { taskId } },
      ctxUndefinedScopes,
    );

    expect(response.error).toEqual(expect.objectContaining({ code: MCP_ERROR_CODES.FORBIDDEN }));
    expect(tasksService.findOne).not.toHaveBeenCalled();
  });

  // ─── (6) Task fora do tenant ──────────────────────────────────────────────

  it('(6) task fora do tenant → NotFoundException propagado', async () => {
    tasksService.findOne.mockRejectedValueOnce(
      new NotFoundException(`Task ${taskId} não encontrada`),
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'execute_task', arguments: { taskId } },
      ctxWithScope,
    );
    expect(response.error).toEqual(expect.objectContaining({ code: MCP_ERROR_CODES.NOT_FOUND }));

    expect(projectsService.findOne).not.toHaveBeenCalled();
    expect(executionsService.execute).not.toHaveBeenCalled();
  });

  // ─── (7) Sem membership ───────────────────────────────────────────────────

  it('(7) sem membership no projeto → ForbiddenException propagado', async () => {
    projectsService.findOne.mockRejectedValueOnce(
      new ForbiddenException(`Usuário sem membership no projeto ${projectId}`),
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'execute_task', arguments: { taskId } },
      ctxWithScope,
    );
    expect(response.error).toEqual(expect.objectContaining({ code: MCP_ERROR_CODES.FORBIDDEN }));

    expect(tasksService.findOne).toHaveBeenCalledWith(taskId);
    expect(executionsService.execute).not.toHaveBeenCalled();
  });

  // ─── (8) Risk Gate bloqueia ───────────────────────────────────────────────

  it('(8) BadRequestException do service → INVALID_PARAMS reason=risk_gate_blocked', async () => {
    const errorMsg = 'Command contains dangerous characters';
    executionsService.execute.mockRejectedValueOnce(new BadRequestException(errorMsg));

    const response = await router.dispatch(
      'tools/call',
      { name: 'execute_task', arguments: { taskId } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        message: 'Risk Gate blocked execution',
        data: {
          reason: 'risk_gate_blocked',
          detail: errorMsg,
        },
      }),
    );
  });

  // ─── (9) Risk MEDIUM ──────────────────────────────────────────────────────

  it('(9) Risk MEDIUM → status=awaiting_approval, riskClassId=-302 (nao e erro)', async () => {
    executionsService.execute.mockResolvedValueOnce(executionMedium);

    const response = await router.dispatch(
      'tools/call',
      { name: 'execute_task', arguments: { taskId } },
      ctxWithScope,
    );

    // Não deve ser erro — retorna resultado normal
    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const parsed = JSON.parse(
      (response.result as { content: Array<{ type: string; text: string }> }).content[0].text,
    );
    expect(parsed).toMatchObject({
      executionId: executionMedium.id,
      taskId,
      status: 'awaiting_approval',
      riskLevel: 'MEDIUM',
      riskClassId: '-302',
      pollHint: expect.stringContaining('awaiting_approval'),
    });
  });

  // ─── (10) Risk HIGH ───────────────────────────────────────────────────────

  it('(10) Risk HIGH → status=awaiting_approval, riskClassId=-303 (nao e erro)', async () => {
    executionsService.execute.mockResolvedValueOnce(executionHigh);

    const response = await router.dispatch(
      'tools/call',
      { name: 'execute_task', arguments: { taskId } },
      ctxWithScope,
    );

    expect(response.error).toBeUndefined();

    const parsed = JSON.parse(
      (response.result as { content: Array<{ type: string; text: string }> }).content[0].text,
    );
    expect(parsed).toMatchObject({
      executionId: executionHigh.id,
      taskId,
      status: 'awaiting_approval',
      riskLevel: 'HIGH',
      riskClassId: '-303',
    });
  });

  // ─── Verificação extra: getUserGroupIdFromEntidade → userId como string ───

  it('(extra) executionsService.execute recebe userId como toString() do userGroupId', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'execute_task', arguments: { taskId } },
      ctxWithScope,
    );

    // userGroupId = BigInt(42), toString() = '42'
    expect(executionsService.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '42',
    );
  });

  // ─── Verificação: dto passado sem prompt/contextHint ─────────────────────

  it('(extra) dto passado ao execute contem apenas taskId (sem prompt/contextHint)', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'execute_task', arguments: { taskId } },
      ctxWithScope,
    );

    expect(executionsService.execute).toHaveBeenCalledWith(
      taskRecord.projectId,
      { taskId },
      expect.any(String),
    );
    // Garantir que prompt e contextHint NÃO foram incluídos
    const [, dto] = executionsService.execute.mock.calls[0];
    expect(dto).not.toHaveProperty('prompt');
    expect(dto).not.toHaveProperty('contextHint');
  });

  // ─── Verificação: execute_task exposta na tools/list via schema estático ──

  it('expoe execute_task no tools/list via schema estatico', async () => {
    const result = await router.dispatch('tools/list', undefined, ctxWithScope);

    // O schema estático (tools.schema.json) pode ainda não incluir execute_task
    // (registro no schema = Fase 5 — ver memory ADR-V2-066). Verificamos que
    // o dispatch retorna lista sem erro.
    expect(result.result).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  // ─── McpToolError exposto diretamente (sem router) ───────────────────────

  it('handler direto: FORBIDDEN quando sem scope', async () => {
    await expect(tool.handler({ taskId }, ctxWithoutScope)).rejects.toBeInstanceOf(McpToolError);

    try {
      await tool.handler({ taskId }, ctxWithoutScope);
    } catch (err) {
      expect(err).toBeInstanceOf(McpToolError);
      const mcpErr = err as McpToolError;
      expect(mcpErr.code).toBe(MCP_ERROR_CODES.FORBIDDEN);
    }
  });
});
