import { ConflictException, NotFoundException } from '@nestjs/common';

import { McpController } from '../mcp.controller';
import { McpJsonRpcService } from '../services/mcp-json-rpc.service';
import { McpRouterService } from '../services/mcp-router.service';
import { UpdateTimerTool } from '../tools/update-timer.tool';

/**
 * Integration tests para `update_timer` — testa o stack completo
 * McpController → McpRouterService → UpdateTimerTool, com mocks dos services
 * de domínio (sem Prisma real, sem banco).
 *
 * Redução deliberada de escopo: por não haver infraestrutura de Prisma real
 * no ambiente de CI (banco offline em dev), os testes cobrem o comportamento
 * end-to-end do envelope JSON-RPC 2.0 com mocks de service —
 * garantindo que scope gate, tenant isolation e envelope correto estão
 * integrados do HTTP até a resposta sem lacunas.
 *
 * Casos cobertos (4):
 * (I-1) E2E golden start — key com tasks:write + action start → 200 JSON-RPC
 *       com envelope correto { taskId, action='start', timer.running=true }
 *       + TasksService.timer invocado com (taskId, 'start', dEntidadeId, undefined)
 * (I-2) E2E scope deny — key SEM tasks:write → JSON-RPC error FORBIDDEN (-32002),
 *       TasksService.findOne e TasksService.timer nunca chamados
 * (I-3) E2E task inexistente — tasksService.findOne lança NotFoundException →
 *       exceção propagada (task inexistente ou fora de scope)
 * (I-4) E2E ConflictException → INVALID_PARAMS reason='timer_conflict' no stack
 *       completo JSON-RPC
 */
describe('MCP update_timer — integration (stack completo com mocks de service)', () => {
  const taskId = '402';
  const projectId = '100';
  const entidadeId = BigInt(7);
  const runningStartedAt = '2026-06-15T14:30:00.000Z';

  /** Contexto MCP com scope tasks:write (key autorizada) */
  const ctxWithScope = {
    dEntidadeId: entidadeId,
    scopes: ['tasks:write'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  /** Contexto MCP sem scope tasks:write (key não autorizada) */
  const ctxWithoutScope = {
    dEntidadeId: entidadeId,
    scopes: ['tasks:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  const taskRecord = { id: taskId, projectId, nome: 'Implementar feature X' };

  const timerStateRunning = {
    running: true,
    runningUserId: '7',
    runningStartedAt,
    totalsByUser: [],
  };

  let tasksService: { findOne: jest.Mock; timer: jest.Mock };
  let projectsService: { findOne: jest.Mock };
  let controller: McpController;

  beforeEach(() => {
    tasksService = {
      findOne: jest.fn().mockResolvedValue(taskRecord),
      timer: jest.fn().mockResolvedValue({ timer: timerStateRunning }),
    };
    projectsService = {
      findOne: jest.fn().mockResolvedValue({ id: projectId }),
    };

    const tool = new UpdateTimerTool(tasksService as never, projectsService as never);

    const router = new McpRouterService(
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

    controller = new McpController(new McpJsonRpcService(), router);
  });

  // ─── (I-1) E2E golden start ───────────────────────────────────────────────

  it('(I-1) E2E golden start: envelope JSON-RPC correto + TasksService.timer invocado', async () => {
    const result = await controller.handle(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 'req-1',
        params: {
          name: 'update_timer',
          arguments: { taskId, action: 'start' },
        },
      },
      { userCtx: ctxWithScope } as never,
    );

    // Envelope JSON-RPC 2.0 externo
    expect(result).toEqual(
      expect.objectContaining({
        jsonrpc: '2.0',
        id: 'req-1',
      }),
    );

    // Sem erro JSON-RPC
    expect((result as Record<string, unknown>).error).toBeUndefined();

    // Resultado presente
    const rpcResult = (result as { result: { content: Array<{ type: string; text: string }> } })
      .result;
    expect(rpcResult).toBeDefined();
    expect(rpcResult.content).toHaveLength(1);
    expect(rpcResult.content[0].type).toBe('text');

    // Payload do envelope update_timer
    const payload = JSON.parse(rpcResult.content[0].text) as Record<string, unknown>;
    expect(payload).toMatchObject({
      taskId,
      action: 'start',
      timer: {
        running: true,
        runningUserId: '7',
        runningStartedAt,
        totalsByUser: [],
      },
    });

    // TasksService.timer invocado com os parâmetros corretos
    expect(tasksService.timer).toHaveBeenCalledTimes(1);
    expect(tasksService.timer).toHaveBeenCalledWith(taskId, 'start', entidadeId, undefined);

    // Tenant isolation: findOne e projectsService.findOne chamados antes do timer
    expect(tasksService.findOne).toHaveBeenCalledTimes(1);
    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, ctxWithScope.dEntidadeId);
    expect(projectsService.findOne).toHaveBeenCalledTimes(1);
    expect(projectsService.findOne).toHaveBeenCalledWith(
      taskRecord.projectId,
      ctxWithScope.dEntidadeId,
    );
  });

  // ─── (I-2) E2E scope deny ─────────────────────────────────────────────────

  it('(I-2) E2E scope deny: FORBIDDEN JSON-RPC, TasksService nunca chamado', async () => {
    const result = await controller.handle(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 'req-2',
        params: {
          name: 'update_timer',
          arguments: { taskId, action: 'start' },
        },
      },
      { userCtx: ctxWithoutScope } as never,
    );

    // Envelope com erro FORBIDDEN
    const rpcError = (result as { error: { code: number; data: unknown } }).error;
    expect(rpcError).toBeDefined();
    expect(rpcError.code).toBe(-32002);
    expect(rpcError.data).toEqual({ requiredScope: 'tasks:write' });

    // TasksService NÃO foi chamado — gate ANTES de qualquer query
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(tasksService.timer).not.toHaveBeenCalled();
    expect(projectsService.findOne).not.toHaveBeenCalled();
  });

  // ─── (I-3) E2E task inexistente ───────────────────────────────────────────

  it('(I-3) E2E task inexistente: NotFoundException propagada, timer nunca chamado', async () => {
    tasksService.findOne.mockRejectedValueOnce(
      new NotFoundException(`Task ${taskId} não encontrada no tenant`),
    );

    // O router MCP propaga NotFoundException sem capturar (não é McpToolError nem ConflictException)
    await expect(
      controller.handle(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          id: 'req-3',
          params: {
            name: 'update_timer',
            arguments: { taskId, action: 'start' },
          },
        },
        { userCtx: ctxWithScope } as never,
      ),
    ).rejects.toThrow(NotFoundException);

    // timer NÃO foi chamado — falhou antes
    expect(tasksService.timer).not.toHaveBeenCalled();
  });

  // ─── (I-4) E2E ConflictException → INVALID_PARAMS reason='timer_conflict' ──

  it('(I-4) E2E ConflictException mapeia para INVALID_PARAMS reason=timer_conflict no stack JSON-RPC', async () => {
    tasksService.timer.mockRejectedValueOnce(
      new ConflictException('Já existe um timer em andamento nesta task'),
    );

    const result = await controller.handle(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 'req-4',
        params: {
          name: 'update_timer',
          arguments: { taskId, action: 'start' },
        },
      },
      { userCtx: ctxWithScope } as never,
    );

    // INVALID_PARAMS (-32602) com reason=timer_conflict
    const rpcError = (result as { error: { code: number; message: string; data: unknown } }).error;
    expect(rpcError).toBeDefined();
    expect(rpcError.code).toBe(-32602);
    expect(rpcError.data).toEqual(
      expect.objectContaining({
        reason: 'timer_conflict',
        detail: expect.stringContaining('timer'),
      }),
    );

    // timer foi chamado mas lançou ConflictException
    expect(tasksService.timer).toHaveBeenCalledTimes(1);
  });
});
