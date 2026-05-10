import { McpController } from '../mcp.controller';
import { McpJsonRpcService } from '../services/mcp-json-rpc.service';
import { McpRouterService } from '../services/mcp-router.service';
import { CreateTaskTool } from '../tools/create-task.tool';
import { ListProjectsTool } from '../tools/list-projects.tool';
import { ListSprintsTool } from '../tools/list-sprints.tool';
import { ListTasksTool } from '../tools/list-tasks.tool';
import { UpdateStatusTool } from '../tools/update-status.tool';

describe('MCP JSON-RPC envelope e router', () => {
  let controller: McpController;

  const userCtx = {
    dEntidadeId: BigInt(1),
    scopes: ['tools:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  beforeEach(() => {
    const tasksService = {
      findMany: jest.fn().mockResolvedValue({ items: [], pagination: { hasMore: false, nextCursor: null } }),
      create: jest.fn(),
      findOne: jest.fn(),
      updateStatus: jest.fn(),
    };
    const projectsService = {
      findMany: jest.fn().mockResolvedValue({ items: [], pagination: { hasMore: false, nextCursor: null } }),
      findAccessibleProjectIds: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };
    const tabelaService = { listarPorClasse: jest.fn() };

    controller = new McpController(
        new McpJsonRpcService(),
        new McpRouterService(
        new ListTasksTool(tasksService as never, projectsService as never),
        new CreateTaskTool(tasksService as never, projectsService as never),
        new UpdateStatusTool(tasksService as never, projectsService as never),
        new ListProjectsTool(projectsService as never),
        new ListSprintsTool(tabelaService as never, projectsService as never),
      ),
    );
  });

  it('processa single initialize', async () => {
    const result = await controller.handle(
      { jsonrpc: '2.0', method: 'initialize', id: 'init-1' },
      { userCtx } as never,
    );

    expect(result).toEqual(
      expect.objectContaining({
        jsonrpc: '2.0',
        id: 'init-1',
        result: expect.objectContaining({
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'scrumban-mcp', version: '1.0.0' },
        }),
      }),
    );
  });

  it('processa batch sequencial e omite notifications sem id', async () => {
    const result = await controller.handle(
      [
        { jsonrpc: '2.0', method: 'tools/list', id: 1 },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ],
      { userCtx } as never,
    );

    expect(result).toHaveLength(1);
    expect(result).toEqual([
      expect.objectContaining({
        id: 1,
        result: expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({ name: 'list_tasks' }),
            expect.objectContaining({ name: 'create_task' }),
          ]),
        }),
      }),
    ]);
  });

  it('retorna null para batch composto apenas por notifications', async () => {
    await expect(
      controller.handle(
        [
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
        ],
        { userCtx } as never,
      ),
    ).resolves.toBeNull();
  });

  it('retorna Invalid Request para batch vazio e method unknown como -32601', async () => {
    await expect(controller.handle([], { userCtx } as never)).resolves.toEqual([
      expect.objectContaining({ error: { code: -32600, message: 'Invalid Request' } }),
    ]);

    await expect(
      controller.handle(
        { jsonrpc: '2.0', method: 'missing/method', id: 'x' },
        { userCtx } as never,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'x',
        error: { code: -32601, message: 'Method not found' },
      }),
    );
  });

  it('retorna Unauthorized JSON-RPC quando guard marcou erro', async () => {
    await expect(
      controller.handle(
        { jsonrpc: '2.0', method: 'initialize', id: 'auth' },
        { mcpAuthError: { code: -32001, message: 'Unauthorized' } } as never,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'auth',
        error: { code: -32001, message: 'Unauthorized' },
      }),
    );
  });

  it('tools/call executa tool real do Bloco B', async () => {
    const result = await controller.handle(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'list_tasks', arguments: {} },
        id: 'tool',
      },
      { userCtx } as never,
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'tool',
        result: expect.objectContaining({
          content: [
            {
              type: 'text',
              text: JSON.stringify({ items: [], pagination: { hasMore: false, nextCursor: null } }),
            },
          ],
        }),
      }),
    );
  });
});
