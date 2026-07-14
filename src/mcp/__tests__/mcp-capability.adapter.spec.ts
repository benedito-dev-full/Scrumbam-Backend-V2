import { Capability } from '../../common/tool-capabilities/capability.interface';
import { CapabilityError } from '../../common/tool-capabilities/capability-error';
import { CapabilityRegistry } from '../../common/tool-capabilities/capability-registry';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpCapabilityAdapter } from '../tools/mcp-capability.adapter';
import { McpToolError } from '../tools/tool.interface';

/**
 * Onda 0.3 — `McpCapabilityAdapter` (esqueleto, NAO plugado no router).
 *
 * Cobre o DoD: registry vazio -> lista vazia; registry com 1 capability fake ->
 * 1 McpTool bem-formado; envelope textResult correto; gate de scope; traducao
 * de CapabilityError -> McpToolError.
 */
const ctx: McpUserContext = {
  dEntidadeId: BigInt(7),
  scopes: ['tasks:write'],
  keyChave: BigInt(10),
  keyPrefix: 'scrumban_mcp',
  keyHash: 'hash',
};

function capabilityWith(overrides: Partial<Capability> = {}): Capability {
  return {
    name: 'create_task',
    description: 'Cria uma task',
    inputSchema: { type: 'object', required: ['titulo'], properties: { titulo: { type: 'string' } } },
    requiredScopes: ['tasks:write'],
    run: jest.fn().mockResolvedValue({ data: { id: '1', status: 'INBOX' } }),
    ...overrides,
  };
}

describe('McpCapabilityAdapter (Onda 0.3 — esqueleto)', () => {
  it('registry vazio => buildAll() retorna lista vazia (adapter nao plugado)', () => {
    const adapter = new McpCapabilityAdapter(new CapabilityRegistry());
    expect(adapter.buildAll()).toEqual([]);
  });

  it('registry com 1 capability => 1 McpTool bem-formado (name/description/inputSchema)', () => {
    const registry = new CapabilityRegistry();
    const cap = capabilityWith();
    registry.register(cap);
    const adapter = new McpCapabilityAdapter(registry);

    const tools = adapter.buildAll();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('create_task');
    expect(tools[0].description).toBe('Cria uma task');
    expect(tools[0].inputSchema).toBe(cap.inputSchema);
    expect(typeof tools[0].handler).toBe('function');
  });

  it('handler embrulha CapabilityResult.data em textResult (envelope MCP)', async () => {
    const cap = capabilityWith();
    const adapter = new McpCapabilityAdapter(new CapabilityRegistry());
    const tool = adapter.toMcpTool(cap);

    const result = await tool.handler({ titulo: 'X' }, ctx);

    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ id: '1', status: 'INBOX' }) }],
    });
    // Principal MCP recebido pela capability tem surface mcp e scopes da chave.
    const [, principal] = (cap.run as jest.Mock).mock.calls[0];
    expect(principal.surface).toBe('mcp');
    expect(principal.can('tasks:write')).toBe(true);
    expect(principal.actorEntidadeId).toBe(ctx.dEntidadeId);
  });

  it('gate de scope: sem o scope na chave => FORBIDDEN (-32002), capability nao roda', async () => {
    const cap = capabilityWith();
    const adapter = new McpCapabilityAdapter(new CapabilityRegistry());
    const tool = adapter.toMcpTool(cap);

    const ctxSemScope: McpUserContext = { ...ctx, scopes: ['tasks:read'] };

    await expect(tool.handler({ titulo: 'X' }, ctxSemScope)).rejects.toMatchObject({
      code: -32002,
    });
    expect(cap.run).not.toHaveBeenCalled();
  });

  it('traduz CapabilityError(INVALID_INPUT) => McpToolError(-32602)', async () => {
    const cap = capabilityWith({
      run: jest.fn().mockRejectedValue(
        new CapabilityError('INVALID_INPUT', 'titulo obrigatorio', { field: 'titulo' }),
      ),
    });
    const adapter = new McpCapabilityAdapter(new CapabilityRegistry());
    const tool = adapter.toMcpTool(cap);

    const err = (await tool.handler({ titulo: 'X' }, ctx).catch((e: unknown) => e)) as McpToolError;
    expect(err).toBeInstanceOf(McpToolError);
    expect(err.code).toBe(-32602);
    expect(err.data).toEqual({ field: 'titulo' });
  });

  it('erro NAO-CapabilityError e repassado inalterado (ex: NotFoundException legado)', async () => {
    const notFound = new Error('Task 1 nao encontrada');
    const cap = capabilityWith({ run: jest.fn().mockRejectedValue(notFound) });
    const adapter = new McpCapabilityAdapter(new CapabilityRegistry());
    const tool = adapter.toMcpTool(cap);

    await expect(tool.handler({ titulo: 'X' }, ctx)).rejects.toBe(notFound);
  });
});
