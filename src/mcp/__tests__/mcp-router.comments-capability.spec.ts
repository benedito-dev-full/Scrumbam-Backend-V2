import { CreateCommentCapability } from '../../common/tool-capabilities/capabilities/comments/create-comment.capability';
import { ListCommentsCapability } from '../../common/tool-capabilities/capabilities/comments/list-comments.capability';
import { CapabilityRegistry } from '../../common/tool-capabilities/capability-registry';
import { McpRouterService } from '../services/mcp-router.service';
import { McpCapabilityAdapter } from '../tools/mcp-capability.adapter';

/**
 * Onda 2 (bidirecionalidade) — `create_comment` e `list_comments` NASCEM no
 * MCP nesta onda (nunca existiram como wrapper legado nesta superficie).
 * Servidas EXCLUSIVAMENTE via `McpCapabilityAdapter` — sem fallback legado
 * (diferente de `create_task`, que tinha um wrapper anterior a preservar).
 */
describe('McpRouterService — create_comment/list_comments via McpCapabilityAdapter (Onda 2)', () => {
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tasks:write', 'tasks:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  let commentsService: { create: jest.Mock; findMany: jest.Mock };
  let router: McpRouterService;

  beforeEach(() => {
    commentsService = {
      create: jest.fn().mockResolvedValue({
        id: '1001',
        texto: 'ok',
        targetType: 'task',
        targetId: '777',
        autorId: '1',
        autorNome: 'Ana',
        createdAt: '2026-07-12T10:00:00.000Z',
      }),
      findMany: jest.fn().mockResolvedValue({
        items: [{ id: '1', texto: 'a', autorNome: 'Ana', createdAt: '2026-07-12T10:00:00.000Z' }],
        nextCursor: null,
      }),
    };

    const registry = new CapabilityRegistry();
    registry.register(new CreateCommentCapability(commentsService as never));
    registry.register(new ListCommentsCapability(commentsService as never));
    const adapter = new McpCapabilityAdapter(registry);

    // capabilityAdapter e o ULTIMO parametro posicional (26o).
    router = new McpRouterService(
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      adapter,
    );
  });

  it('create_comment: envelope textResult exato + delega ao CommentsService', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_comment', arguments: { targetType: 'task', targetId: '777', texto: 'ok' } },
      userCtx,
    );

    expect(response.result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            commentId: '1001',
            targetType: 'task',
            targetId: '777',
          }),
        },
      ],
    });
    expect(commentsService.create).toHaveBeenCalledWith(
      'task',
      '777',
      { texto: 'ok' },
      userCtx.dEntidadeId,
      undefined,
    );
  });

  it('list_comments: envelope textResult exato + delega ao CommentsService', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_comments', arguments: { targetType: 'task', targetId: '777' } },
      userCtx,
    );

    expect(response.result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            items: [{ id: '1', texto: 'a', autorNome: 'Ana', createdAt: '2026-07-12T10:00:00.000Z' }],
            total: 1,
            hasMore: false,
          }),
        },
      ],
    });
    expect(commentsService.findMany).toHaveBeenCalledWith(
      'task',
      '777',
      { limit: 20 },
      userCtx.dEntidadeId,
      undefined,
    );
  });

  it('gate de scope: create_comment sem tasks:write => FORBIDDEN, service nao chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_comment', arguments: { targetType: 'task', targetId: '777', texto: 'x' } },
      { ...userCtx, scopes: ['tasks:read'] },
    );

    expect(response.error).toEqual(expect.objectContaining({ code: -32002 }));
    expect(commentsService.create).not.toHaveBeenCalled();
  });

  it('gate de scope: list_comments sem tasks:read => FORBIDDEN, service nao chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_comments', arguments: { targetType: 'task', targetId: '777' } },
      { ...userCtx, scopes: ['tasks:write'] },
    );

    expect(response.error).toEqual(expect.objectContaining({ code: -32002 }));
    expect(commentsService.findMany).not.toHaveBeenCalled();
  });

  it('tools/list continua vindo do schema estatico e contem as 2 tools novas (26 no total)', async () => {
    const response = await router.dispatch('tools/list', undefined, userCtx);
    const tools = (response.result as { tools: Array<{ name: string }> }).tools;
    expect(tools).toHaveLength(26);
    expect(tools.some((t) => t.name === 'create_comment')).toBe(true);
    expect(tools.some((t) => t.name === 'list_comments')).toBe(true);
  });

  it('sem capabilityAdapter => create_comment/list_comments nao aparecem em tools/call (METHOD_NOT_FOUND)', async () => {
    const bareRouter = new McpRouterService();

    const response = await bareRouter.dispatch(
      'tools/call',
      { name: 'create_comment', arguments: { targetType: 'task', targetId: '777', texto: 'x' } },
      userCtx,
    );

    expect(response.error).toEqual(expect.objectContaining({ code: -32601 }));
  });
});
