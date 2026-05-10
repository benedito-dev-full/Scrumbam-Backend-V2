import { ExecutionContext } from '@nestjs/common';

import { McpKeyGuard } from '../guards/mcp-key.guard';

describe('McpKeyGuard F11', () => {
  function contextFor(request: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  }

  it('injeta userCtx para key válida', async () => {
    const guard = new McpKeyGuard({
      validatePlaintext: jest.fn().mockResolvedValue({
        chave: '10',
        dEntidadeId: '9007199254740993',
        scopes: ['tools:read'],
        prefix: 'scrumban_mcp',
        hash: 'abc',
      }),
    } as never);
    const request = { headers: { 'x-mcp-key': 'scrumban_mcp_valid' } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(request).toMatchObject({
      userCtx: {
        dEntidadeId: BigInt('9007199254740993'),
        keyChave: BigInt(10),
        scopes: ['tools:read'],
        keyPrefix: 'scrumban_mcp',
        keyHash: 'abc',
      },
    });
  });

  it('marca erro JSON-RPC quando key está ausente ou inválida', async () => {
    const guard = new McpKeyGuard({
      validatePlaintext: jest.fn().mockResolvedValue(null),
    } as never);
    const missing = { headers: {} };
    const invalid = { headers: { 'x-mcp-key': 'scrumban_mcp_invalid' } };

    await guard.canActivate(contextFor(missing));
    await guard.canActivate(contextFor(invalid));

    expect(missing).toMatchObject({ mcpAuthError: { code: -32001 } });
    expect(invalid).toMatchObject({ mcpAuthError: { code: -32001 } });
  });
});
