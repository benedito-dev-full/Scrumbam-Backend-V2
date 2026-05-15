import { Logger } from '@nestjs/common';

import toolsSchema from '../schemas/tools.schema.json';
import { McpController } from '../mcp.controller';
import { McpJsonRpcService } from '../services/mcp-json-rpc.service';
import { McpRouterService } from '../services/mcp-router.service';
import { McpTool } from '../tools/tool.interface';

const userCtx = {
  dEntidadeId: BigInt(1),
  scopes: ['tools:read'],
  keyChave: BigInt(10),
  keyPrefix: 'scrumban_mcp',
  keyHash: 'hash',
};

function makeTool(name: string, handler: McpTool['handler']): McpTool {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: 'object', properties: {} },
    handler,
  };
}

describe('MCP Bloco D - compatibilidade, timeout, metricas e doc', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('initialize retorna campos exatos da spec MCP 2024-11-05', async () => {
    const controller = new McpController(new McpJsonRpcService(), new McpRouterService());

    await expect(
      controller.handle({ jsonrpc: '2.0', method: 'initialize', id: 'init' }, { userCtx } as never),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'init',
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'scrumban-mcp', version: '1.0.0' },
      },
    });
  });

  it('tools/list retorna 5 tools com schemas completos do schema estatico cacheado', async () => {
    const controller = new McpController(new McpJsonRpcService(), new McpRouterService());

    const result = await controller.handle({ jsonrpc: '2.0', method: 'tools/list', id: 'tools' }, {
      userCtx,
    } as never);

    expect(result).toEqual({
      jsonrpc: '2.0',
      id: 'tools',
      result: { tools: toolsSchema.tools },
    });
    expect(toolsSchema.tools).toHaveLength(13);
    expect(toolsSchema.tools.map((tool) => tool.name)).toEqual([
      'list_tasks',
      'create_task',
      'update_status',
      'list_projects',
      'list_sprints',
      'get_task',
      'update_task',
      'list_members',
      'get_project',
      'update_project',
      'list_notifications',
      'update_notification',
      'get_unread_count',
    ]);
    for (const tool of toolsSchema.tools) {
      expect(tool.inputSchema).toEqual(expect.objectContaining({ type: 'object' }));
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('timeout em tools/call retorna -32003 e incrementa metrica timeout', async () => {
    jest.useFakeTimers();
    const slowTool = makeTool(
      'list_tasks',
      () => new Promise((resolve) => setTimeout(() => resolve({ content: [] }), 100)),
    );
    const router = new McpRouterService(
      slowTool as never,
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
      { get: jest.fn().mockReturnValue('5') } as never,
    );

    const promise = router.dispatch('tools/call', { name: 'list_tasks', arguments: {} }, userCtx);

    jest.advanceTimersByTime(5);
    await expect(promise).resolves.toEqual({
      error: {
        code: -32003,
        message: 'Request timeout',
        data: { timeoutMs: 5 },
      },
    });

    expect(router.getMetricsSnapshotForTesting()).toEqual({
      counters: {
        'tools/call': { total: 1, errors: 1, timeouts: 1 },
      },
      p95byTool: {},
    });
  });

  it('timeout nao se aplica a initialize nem tools/list', async () => {
    const router = new McpRouterService(
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
      {
        get: jest.fn().mockReturnValue('1'),
      } as never,
    );

    await expect(router.dispatch('initialize', undefined, userCtx)).resolves.toEqual(
      expect.objectContaining({
        result: expect.objectContaining({ protocolVersion: '2024-11-05' }),
      }),
    );
    await expect(router.dispatch('tools/list', undefined, userCtx)).resolves.toEqual(
      expect.objectContaining({ result: { tools: toolsSchema.tools } }),
    );
  });

  it('notifications/initialized sem id continua sem response em batch', async () => {
    const controller = new McpController(new McpJsonRpcService(), new McpRouterService());

    await expect(
      controller.handle(
        [
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', method: 'tools/list', id: 'tools' },
        ],
        { userCtx } as never,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'tools',
        result: { tools: toolsSchema.tools },
      }),
    ]);
  });

  it('metricas registram total/errors/timeouts e p95 sem params nem key', async () => {
    jest.useFakeTimers();
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const successTool = makeTool('list_tasks', async () => ({ content: [] }));
    const errorTool = makeTool('create_task', async () => {
      throw new Error('boom');
    });
    const router = new McpRouterService(successTool as never, errorTool as never);

    await router.dispatch(
      'tools/call',
      { name: 'list_tasks', arguments: { secret: 'value' } },
      userCtx,
    );
    await expect(
      router.dispatch(
        'tools/call',
        { name: 'create_task', arguments: { secret: 'value' } },
        userCtx,
      ),
    ).rejects.toThrow('boom');

    const snapshot = router.getMetricsSnapshotForTesting();
    expect(snapshot).toEqual({
      counters: {
        'tools/call': { total: 2, errors: 1, timeouts: 0 },
      },
      p95byTool: { list_tasks: expect.any(Number) },
    });
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(JSON.stringify(snapshot)).not.toContain('hash');

    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(logSpy).toHaveBeenCalledWith('mcp_metrics_snapshot', snapshot);
  });
});
