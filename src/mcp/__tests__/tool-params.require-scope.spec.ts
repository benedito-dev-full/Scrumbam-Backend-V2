import { MCP_ERROR_CODES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpToolError } from '../tools/tool.interface';
import { requireScope } from '../tools/tool-params';

function buildCtx(scopes: unknown): McpUserContext {
  return {
    dEntidadeId: BigInt(1),
    scopes: scopes as string[],
    keyChave: BigInt(1),
    keyPrefix: 'mcp_test',
    keyHash: 'hash',
  };
}

describe('requireScope', () => {
  it('passa silenciosamente quando ctx.scopes contem o scope requerido', () => {
    const ctx = buildCtx(['executions:create']);
    expect(() => requireScope(ctx, 'executions:create')).not.toThrow();
  });

  it('joga McpToolError FORBIDDEN quando o scope requerido nao esta presente', () => {
    const ctx = buildCtx(['tasks:read']);
    try {
      requireScope(ctx, 'executions:create');
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(McpToolError);
      const tool = err as McpToolError;
      expect(tool.code).toBe(MCP_ERROR_CODES.FORBIDDEN);
      expect(tool.message).toBe('Forbidden');
      expect(tool.data).toEqual({ requiredScope: 'executions:create' });
    }
  });

  it('joga McpToolError FORBIDDEN quando ctx.scopes esta ausente/invalido', () => {
    const ctx = buildCtx(undefined);
    try {
      requireScope(ctx, 'executions:create');
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(McpToolError);
      const tool = err as McpToolError;
      expect(tool.code).toBe(MCP_ERROR_CODES.FORBIDDEN);
      expect(tool.data).toEqual({ requiredScope: 'executions:create' });
    }
  });
});
