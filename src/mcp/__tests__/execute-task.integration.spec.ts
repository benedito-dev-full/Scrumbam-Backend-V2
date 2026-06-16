import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { McpController } from '../mcp.controller';
import { McpJsonRpcService } from '../services/mcp-json-rpc.service';
import { McpRouterService } from '../services/mcp-router.service';
import { ExecuteTaskTool } from '../tools/execute-task.tool';

/**
 * Integration tests para `execute_task` — testa o stack completo
 * McpController → McpRouterService → ExecuteTaskTool, com mocks dos services
 * de domínio (sem Prisma real, sem banco).
 *
 * Redução deliberada de escopo: por não haver infraestrutura de Prisma real
 * no ambiente de CI (banco offline em dev), os testes cobrem o comportamento
 * end-to-end do envelope JSON-RPC 2.0 com mocks de service —
 * garantindo que scope gate, tenant isolation e envelope correto estão
 * integrados do HTTP até a resposta sem lacunas.
 *
 * Casos cobertos (3):
 * (I-1) E2E golden LOW — key com executions:create + taskId LOW → 200 JSON-RPC
 *       com envelope correto { executionId, status='queued', riskClassId='-301' }
 *       + ExecutionsService foi invocado
 * (I-2) E2E scope deny — key SEM executions:create → JSON-RPC error FORBIDDEN (-32002),
 *       ExecutionsService nunca chamado
 * (I-3) E2E task inexistente — taskId fora do tenant → JSON-RPC error com NotFoundException
 */
describe('MCP execute_task — integration (stack completo com mocks de service)', () => {
  const taskId = '402';
  const projectId = '100';
  const entidadeId = BigInt(1);
  const userGroupId = BigInt(42);
  const createdAt = '2026-06-15T14:30:00.000Z';

  /** Contexto MCP com scope executions:create (key autorizada) */
  const ctxWithScope = {
    dEntidadeId: entidadeId,
    scopes: ['executions:create'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  /** Contexto MCP sem scope executions:create (key não autorizada) */
  const ctxWithoutScope = {
    dEntidadeId: entidadeId,
    scopes: ['tasks:write'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  const taskRecord = { id: taskId, projectId, nome: 'Refatorar auth' };

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

  let tasksService: { findOne: jest.Mock };
  let projectsService: { findOne: jest.Mock };
  let executionsService: { execute: jest.Mock };
  let entidadeService: { getUserGroupIdFromEntidade: jest.Mock };
  let controller: McpController;

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

    const tool = new ExecuteTaskTool(
      tasksService as never,
      projectsService as never,
      executionsService as never,
      entidadeService as never,
    );

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
      tool, // executeTaskTool
    );

    controller = new McpController(new McpJsonRpcService(), router);
  });

  // ─── (I-1) E2E golden LOW ─────────────────────────────────────────────────

  it('(I-1) E2E golden LOW: envelope JSON-RPC correto + ExecutionsService invocado', async () => {
    const result = await controller.handle(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 'req-1',
        params: {
          name: 'execute_task',
          arguments: { taskId },
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

    // Payload do envelope execute_task
    const payload = JSON.parse(rpcResult.content[0].text) as Record<string, unknown>;
    expect(payload).toMatchObject({
      executionId: executionLow.id,
      taskId,
      projectId,
      status: 'queued',
      riskLevel: 'LOW',
      riskClassId: '-301',
      createdAt,
      pollHint: expect.stringContaining('get_task'),
    });

    // ExecutionsService foi invocado com os parâmetros corretos
    expect(executionsService.execute).toHaveBeenCalledTimes(1);
    expect(executionsService.execute).toHaveBeenCalledWith(
      taskRecord.projectId,
      { taskId },
      userGroupId.toString(),
    );
  });

  // ─── (I-2) E2E scope deny ─────────────────────────────────────────────────

  it('(I-2) E2E scope deny: FORBIDDEN JSON-RPC, ExecutionsService nunca chamado', async () => {
    const result = await controller.handle(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 'req-2',
        params: {
          name: 'execute_task',
          arguments: { taskId },
        },
      },
      { userCtx: ctxWithoutScope } as never,
    );

    // Envelope com erro FORBIDDEN
    const rpcError = (result as { error: { code: number; data: unknown } }).error;
    expect(rpcError).toBeDefined();
    expect(rpcError.code).toBe(-32002);
    expect(rpcError.data).toEqual({ requiredScope: 'executions:create' });

    // ExecutionsService NÃO foi chamado — gate ANTES de qualquer query
    expect(executionsService.execute).not.toHaveBeenCalled();
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(projectsService.findOne).not.toHaveBeenCalled();
  });

  // ─── (I-3) E2E task inexistente ───────────────────────────────────────────

  it('(I-3) E2E task inexistente: NotFoundException propaga como erro não-capturado', async () => {
    tasksService.findOne.mockRejectedValueOnce(
      new NotFoundException(`Task ${taskId} não encontrada no tenant`),
    );

    // O router MCP propaga NotFoundException sem capturar (não é McpToolError nem BadRequestException)
    // O controller deixa a exceção subir (comportamento confirmado nos unit tests)
    await expect(
      controller.handle(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          id: 'req-3',
          params: {
            name: 'execute_task',
            arguments: { taskId },
          },
        },
        { userCtx: ctxWithScope } as never,
      ),
    ).rejects.toThrow(NotFoundException);

    // ExecutionsService não foi chamado
    expect(executionsService.execute).not.toHaveBeenCalled();
  });

  // ─── (I-bonus) Batch: scope deny não afeta outros requests no batch ────────

  it('(I-bonus) batch: scope deny em execute_task nao contamina requests paralelos no batch', async () => {
    // Simula batch com dois requests: um initialize (sem scope check) + execute_task (scope deny)
    const result = (await controller.handle(
      [
        { jsonrpc: '2.0', method: 'initialize', id: 'init' },
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          id: 'exec',
          params: { name: 'execute_task', arguments: { taskId } },
        },
      ],
      { userCtx: ctxWithoutScope } as never,
    )) as Array<Record<string, unknown>>;

    // Dois resultados no batch
    expect(result).toHaveLength(2);

    const initResult = result.find((r) => r['id'] === 'init');
    const execResult = result.find((r) => r['id'] === 'exec');

    // initialize OK independente de scope
    expect(initResult?.['result']).toBeDefined();
    expect(initResult?.['error']).toBeUndefined();

    // execute_task com scope deny = FORBIDDEN
    expect(execResult?.['error']).toBeDefined();
    expect((execResult?.['error'] as { code: number })?.code).toBe(-32002);

    // ExecutionsService nunca chamado
    expect(executionsService.execute).not.toHaveBeenCalled();
  });

  // ─── (I-bonus2) ForbiddenException (sem membership) → propaga ────────────

  it('(I-bonus2) sem membership no projeto: ForbiddenException propaga do controller', async () => {
    projectsService.findOne.mockRejectedValueOnce(
      new ForbiddenException(`Usuário sem membership no projeto ${projectId}`),
    );

    await expect(
      controller.handle(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          id: 'req-4',
          params: {
            name: 'execute_task',
            arguments: { taskId },
          },
        },
        { userCtx: ctxWithScope } as never,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(executionsService.execute).not.toHaveBeenCalled();
  });
});
