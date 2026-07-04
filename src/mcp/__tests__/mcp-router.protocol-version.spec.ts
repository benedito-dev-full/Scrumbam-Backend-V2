import { MCP_PROTOCOL_VERSION } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpRouterService } from '../services/mcp-router.service';

/**
 * F1 — Negociacao de `protocolVersion` no `initialize` (ADR-V2-071).
 *
 * Cobre os 4 casos do DoD:
 *  (a) versao pedida na allow-list `2025-03-26` -> ecoa `2025-03-26`
 *  (b) versao pedida na allow-list `2024-11-05` -> ecoa `2024-11-05` (Claude Code intacto)
 *  (c) `protocolVersion` ausente -> ecoa default
 *  (d) versao fora da allow-list -> ecoa default
 */
describe('McpRouterService — negociacao de protocolVersion (initialize)', () => {
  // Router sem tools (undefined) — `initialize` nao depende de nenhuma tool.
  const router = new McpRouterService();

  const userCtx: McpUserContext = {
    dEntidadeId: BigInt(1),
    scopes: ['tasks:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  } as McpUserContext;

  const initialize = (params: Record<string, unknown> | undefined) =>
    router.dispatch('initialize', params, userCtx);

  const protocolVersionOf = (result: { result?: unknown }): unknown =>
    (result.result as { protocolVersion?: unknown } | undefined)?.protocolVersion;

  it('(a) ecoa 2025-03-26 quando pedido (Claude Web)', async () => {
    const res = await initialize({ protocolVersion: '2025-03-26' });
    expect(protocolVersionOf(res)).toBe('2025-03-26');
  });

  it('(b) ecoa 2024-11-05 quando pedido (Claude Code — bloqueante)', async () => {
    const res = await initialize({ protocolVersion: '2024-11-05' });
    expect(protocolVersionOf(res)).toBe('2024-11-05');
  });

  it('(c) devolve default quando protocolVersion ausente', async () => {
    const res = await initialize({});
    expect(protocolVersionOf(res)).toBe(MCP_PROTOCOL_VERSION);
  });

  it('(c2) devolve default quando params ausente', async () => {
    const res = await initialize(undefined);
    expect(protocolVersionOf(res)).toBe(MCP_PROTOCOL_VERSION);
  });

  it('(d) devolve default quando versao fora da allow-list', async () => {
    const res = await initialize({ protocolVersion: '9999-99-99' });
    expect(protocolVersionOf(res)).toBe(MCP_PROTOCOL_VERSION);
  });

  it('(d2) devolve default quando protocolVersion nao e string', async () => {
    const res = await initialize({ protocolVersion: 12345 });
    expect(protocolVersionOf(res)).toBe(MCP_PROTOCOL_VERSION);
  });

  it('mantem capabilities e serverInfo inalterados', async () => {
    const res = await initialize({ protocolVersion: '2025-03-26' });
    expect(res.result).toEqual(
      expect.objectContaining({
        capabilities: { tools: {} },
        serverInfo: { name: 'scrumban-mcp', version: '1.0.0' },
      }),
    );
  });
});
