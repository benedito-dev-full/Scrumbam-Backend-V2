import type { Response } from 'express';

import { HTTP_STATUS_ACCEPTED } from '../constants';
import { McpController } from '../mcp.controller';
import { McpJsonRpcService } from '../services/mcp-json-rpc.service';
import { McpRouterService } from '../services/mcp-router.service';
import { CreateTaskTool } from '../tools/create-task.tool';
import { ListProjectsTool } from '../tools/list-projects.tool';
import { ListTasksTool } from '../tools/list-tasks.tool';
import { UpdateStatusTool } from '../tools/update-status.tool';

/**
 * F2 — Suporte a `Accept` + resposta `202 Accepted` (spec Streamable HTTP
 * 2025-03-26). Cobre os 5 casos do DoD:
 *   1. POST só-notification            → 202 sem corpo
 *   2. POST request (tem id)           → 200 + JSON
 *   3. POST batch misto (≥1 request)   → 200 + JSON
 *   4. POST batch só-notifications     → 202 sem corpo
 *   5. audit registra o httpCode real  → 202 no caminho notifications-only
 */
describe('MCP F2 — Accept + 202 Accepted (notifications-only)', () => {
  let controller: McpController;
  let auditRecord: jest.Mock;

  const userCtx = {
    dEntidadeId: BigInt(1),
    scopes: ['tasks:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  /**
   * Cria um mock mínimo de Response do express com `status` espião.
   * Retorna o próprio mock para permitir encadeamento (padrão do express).
   */
  const buildResMock = (): { res: Response; statusSpy: jest.Mock } => {
    const statusSpy = jest.fn();
    const res = { status: statusSpy } as unknown as Response;
    statusSpy.mockReturnValue(res);
    return { res, statusSpy };
  };

  beforeEach(() => {
    auditRecord = jest.fn().mockResolvedValue(undefined);

    const tasksService = {
      findMany: jest
        .fn()
        .mockResolvedValue({ items: [], pagination: { hasMore: false, nextCursor: null } }),
      create: jest.fn(),
      findOne: jest.fn(),
      updateStatus: jest.fn(),
    };
    const projectsService = {
      findMany: jest
        .fn()
        .mockResolvedValue({ items: [], pagination: { hasMore: false, nextCursor: null } }),
      findAccessibleProjectIds: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };

    controller = new McpController(
      new McpJsonRpcService(),
      new McpRouterService(
        new ListTasksTool(tasksService as never, projectsService as never),
        new CreateTaskTool(tasksService as never, projectsService as never),
        new UpdateStatusTool(tasksService as never, projectsService as never),
        new ListProjectsTool(projectsService as never),
      ),
      undefined,
      { record: auditRecord } as never,
    );
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  it('DoD 1: single notification → 202 sem corpo', async () => {
    const { res, statusSpy } = buildResMock();

    const result = await controller.handle(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { userCtx } as never,
      res,
    );

    expect(result).toBeNull();
    expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_ACCEPTED);
  });

  it('DoD 2: request com id (tools/list) → 200 + JSON (nunca 202)', async () => {
    const { res, statusSpy } = buildResMock();

    const result = await controller.handle(
      { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      { userCtx } as never,
      res,
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 1,
        result: expect.objectContaining({ tools: expect.any(Array) }),
      }),
    );
    expect(statusSpy).not.toHaveBeenCalled();
  });

  it('DoD 3: batch misto (request + notification) → 200 + JSON com a response da request', async () => {
    const { res, statusSpy } = buildResMock();

    const result = await controller.handle(
      [
        { jsonrpc: '2.0', method: 'tools/list', id: 1 },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ],
      { userCtx } as never,
      res,
    );

    expect(result).toHaveLength(1);
    expect(result).toEqual([expect.objectContaining({ id: 1 })]);
    expect(statusSpy).not.toHaveBeenCalled();
  });

  it('DoD 4: batch só de notifications → 202 sem corpo', async () => {
    const { res, statusSpy } = buildResMock();

    const result = await controller.handle(
      [
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ],
      { userCtx } as never,
      res,
    );

    expect(result).toBeNull();
    expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_ACCEPTED);
  });

  it('DoD 5: audit registra httpCode=202 no caminho notifications-only', async () => {
    jest.useFakeTimers();
    const { res } = buildResMock();

    await controller.handle(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { userCtx } as never,
      res,
    );

    // scheduleAudit usa setImmediate — drena os timers/macrotasks pendentes.
    jest.runAllTimers();
    await Promise.resolve();

    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ httpCode: HTTP_STATUS_ACCEPTED }),
    );
    jest.useRealTimers();
  });

  it('audit registra httpCode=200 para request com id (regressão do envelope 200)', async () => {
    jest.useFakeTimers();
    const { res } = buildResMock();

    await controller.handle(
      { jsonrpc: '2.0', method: 'tools/list', id: 42 },
      { userCtx } as never,
      res,
    );

    jest.runAllTimers();
    await Promise.resolve();

    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({ httpCode: 200 }));
    jest.useRealTimers();
  });

  it('back-compat: handle sem res (2 args) ainda retorna null para notifications-only', async () => {
    await expect(
      controller.handle(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { userCtx } as never,
      ),
    ).resolves.toBeNull();
  });
});
