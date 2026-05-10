import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { McpEnabledGuard } from '../guards/mcp-enabled.guard';

describe('McpEnabledGuard', () => {
  it('permite quando MCP_ENABLED=true', () => {
    const guard = new McpEnabledGuard({
      get: jest.fn().mockReturnValue('true'),
    } as unknown as ConfigService);

    expect(guard.canActivate({} as never)).toBe(true);
  });

  it('bloqueia rotas MCP quando MCP_ENABLED nao esta ativo', () => {
    const guard = new McpEnabledGuard({
      get: jest.fn().mockReturnValue('false'),
    } as unknown as ConfigService);

    expect(() => guard.canActivate({} as never)).toThrow(NotFoundException);
  });
});
