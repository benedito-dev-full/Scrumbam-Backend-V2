import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { McpAuthenticatedRequest, McpUserContext } from '../interfaces/mcp.types';
import {
  MCP_ERROR_CODES,
} from '../constants';
import {
  MCP_OAUTH_ENABLED_ENV,
  MCP_OAUTH_ISSUER_ENV,
  MCP_OAUTH_RESOURCE_URI_ENV,
} from '../oauth.constants';
import { McpBearerService } from '../services/mcp-bearer.service';
import { McpKeyGuard } from './mcp-key.guard';
import { McpAuthGuard } from './mcp-auth.guard';

/**
 * Testes do guard dual-auth McpAuthGuard (Reforma 2 — F4). Cobre a matriz da
 * política: X-MCP-Key (delegação — Claude Code), Bearer válido/inválido, e o
 * caso sem-credencial atrás da flag MCP_OAUTH_ENABLED. Casos (a) e (e) são
 * BLOQUEANTES: garantem que o Claude Code não regride.
 */
describe('McpAuthGuard (F4 — dual-auth OAuth + X-MCP-Key)', () => {
  const RESOURCE_URI = 'https://host.example.com/mcp';
  const ISSUER = 'https://tenant.us.auth0.com/';
  const EXPECTED_WWW_AUTH =
    'Bearer resource_metadata="https://host.example.com/.well-known/oauth-protected-resource"';

  const OAUTH_ENV: Record<string, string> = {
    [MCP_OAUTH_RESOURCE_URI_ENV]: RESOURCE_URI,
    [MCP_OAUTH_ISSUER_ENV]: ISSUER,
  };

  function configWith(overrides: Record<string, string | undefined>): ConfigService {
    return {
      get: jest.fn((key: string) => overrides[key]),
    } as unknown as ConfigService;
  }

  function bearerServiceReturning(
    result: McpUserContext | null,
  ): { service: McpBearerService; validate: jest.Mock } {
    const validate = jest.fn().mockResolvedValue(result);
    return {
      service: { validate } as unknown as McpBearerService,
      validate,
    };
  }

  /**
   * Fake do McpKeyGuard que reproduz o soft-fail real: com chave "válida"
   * popula userCtx e retorna true; sem chave stasha mcpAuthError e retorna
   * true. Nunca lança — igual ao guard de produção.
   */
  function keyGuardStub(): { guard: McpKeyGuard; canActivate: jest.Mock } {
    const canActivate = jest.fn(async (context: ExecutionContext) => {
      const req = context
        .switchToHttp()
        .getRequest<McpAuthenticatedRequest>();
      const raw = req.headers?.['x-mcp-key'];
      const key = Array.isArray(raw) ? raw[0] : raw;
      if (typeof key === 'string' && key.length > 0) {
        req.userCtx = {
          dEntidadeId: BigInt(42),
          scopes: ['tasks:read'],
          keyChave: BigInt(7),
          keyPrefix: 'mcp',
          keyHash: 'real-key-hash',
        };
      } else {
        req.mcpAuthError = {
          code: MCP_ERROR_CODES.UNAUTHORIZED,
          message: 'Unauthorized',
        };
      }
      return true;
    });
    return { guard: { canActivate } as unknown as McpKeyGuard, canActivate };
  }

  function contextFor(headers: Record<string, unknown>): {
    context: ExecutionContext;
    request: McpAuthenticatedRequest;
    setHeader: jest.Mock;
  } {
    const request = { headers } as unknown as McpAuthenticatedRequest;
    const setHeader = jest.fn();
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext;
    return { context, request, setHeader };
  }

  it('(a) [BLOQUEANTE] X-MCP-Key válido, sem Bearer → delega ao McpKeyGuard, userCtx real', async () => {
    const bearer = bearerServiceReturning(null);
    const key = keyGuardStub();
    const guard = new McpAuthGuard(bearer.service, key.guard, configWith(OAUTH_ENV));
    const { context, request } = contextFor({ 'x-mcp-key': 'live-key' });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(key.canActivate).toHaveBeenCalledWith(context);
    expect(bearer.validate).not.toHaveBeenCalled();
    expect(request.userCtx).toEqual(
      expect.objectContaining({ keyHash: 'real-key-hash', keyPrefix: 'mcp' }),
    );
    expect(request.mcpAuthError).toBeUndefined();
  });

  it('(b) Bearer válido → passa, userCtx OAuth; McpKeyGuard NÃO é chamado', async () => {
    const oauthCtx: McpUserContext = {
      dEntidadeId: BigInt(99),
      scopes: ['tasks:read', 'tasks:write'],
      keyChave: BigInt(0),
      keyPrefix: 'oauth',
      keyHash: 'oauth:abc',
    };
    const bearer = bearerServiceReturning(oauthCtx);
    const key = keyGuardStub();
    const guard = new McpAuthGuard(bearer.service, key.guard, configWith(OAUTH_ENV));
    const { context, request } = contextFor({ authorization: 'Bearer valid.jwt.token' });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(bearer.validate).toHaveBeenCalledWith('valid.jwt.token');
    expect(request.userCtx).toBe(oauthCtx);
    expect(key.canActivate).not.toHaveBeenCalled();
  });

  it('(c) Bearer inválido → lança 401 + header WWW-Authenticate; X-MCP-Key não é tocado', async () => {
    const bearer = bearerServiceReturning(null);
    const key = keyGuardStub();
    const guard = new McpAuthGuard(bearer.service, key.guard, configWith(OAUTH_ENV));
    const { context, setHeader } = contextFor({ authorization: 'Bearer bad.token' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(bearer.validate).toHaveBeenCalledWith('bad.token');
    expect(setHeader).toHaveBeenCalledWith('WWW-Authenticate', EXPECTED_WWW_AUTH);
    expect(key.canActivate).not.toHaveBeenCalled();
  });

  it('(d) sem credencial + flag ON → 401 + WWW-Authenticate', async () => {
    const bearer = bearerServiceReturning(null);
    const key = keyGuardStub();
    const guard = new McpAuthGuard(
      bearer.service,
      key.guard,
      configWith({ ...OAUTH_ENV, [MCP_OAUTH_ENABLED_ENV]: 'true' }),
    );
    const { context, setHeader } = contextFor({});

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(setHeader).toHaveBeenCalledWith('WWW-Authenticate', EXPECTED_WWW_AUTH);
    expect(key.canActivate).not.toHaveBeenCalled();
  });

  it('(e) [BLOQUEANTE] sem credencial + flag OFF → delega ao McpKeyGuard, mcpAuthError setado, SEM 401', async () => {
    const bearer = bearerServiceReturning(null);
    const key = keyGuardStub();
    const guard = new McpAuthGuard(bearer.service, key.guard, configWith(OAUTH_ENV));
    const { context, request } = contextFor({});

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(key.canActivate).toHaveBeenCalledWith(context);
    expect(request.mcpAuthError).toEqual(
      expect.objectContaining({ code: MCP_ERROR_CODES.UNAUTHORIZED }),
    );
    expect(request.userCtx).toBeUndefined();
  });

  it('(bônus) Bearer inválido + flag OFF → ainda 401 (cliente tentou OAuth explicitamente)', async () => {
    const bearer = bearerServiceReturning(null);
    const key = keyGuardStub();
    const guard = new McpAuthGuard(bearer.service, key.guard, configWith(OAUTH_ENV));
    const { context, setHeader } = contextFor({ authorization: 'Bearer bad.token' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(setHeader).toHaveBeenCalledWith('WWW-Authenticate', EXPECTED_WWW_AUTH);
    expect(key.canActivate).not.toHaveBeenCalled();
  });

  it('sem credencial + flag ON mas OAuth não configurado → 401 sem WWW-Authenticate (defensivo)', async () => {
    const bearer = bearerServiceReturning(null);
    const key = keyGuardStub();
    const guard = new McpAuthGuard(
      bearer.service,
      key.guard,
      configWith({ [MCP_OAUTH_ENABLED_ENV]: 'true' }),
    );
    const { context, setHeader } = contextFor({});

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(setHeader).not.toHaveBeenCalled();
  });
});

describe('McpController @Post guard chain (F4 — ordem preservada)', () => {
  it('(f) POST /mcp usa [McpEnabledGuard, McpOriginGuard, McpAuthGuard] nessa ordem', async () => {
    const { McpController } = await import('../mcp.controller');
    const { McpEnabledGuard } = await import('./mcp-enabled.guard');
    const { McpOriginGuard } = await import('./mcp-origin.guard');

    const guards = Reflect.getMetadata(
      '__guards__',
      McpController.prototype.handle,
    ) as unknown[];

    expect(guards).toEqual([McpEnabledGuard, McpOriginGuard, McpAuthGuard]);
  });
});
