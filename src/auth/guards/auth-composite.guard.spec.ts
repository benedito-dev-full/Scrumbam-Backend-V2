import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuthCompositeGuard } from './auth-composite.guard';
import { McpKeyGuard } from './mcp-key.guard';
import { ApiKeyGuard } from './api-key.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RequireWorkspaceGuard } from './require-workspace.guard';
import { OrgTenantGuard } from './org-tenant.guard';

const makeContext = (user?: object, headers?: Record<string, string>): ExecutionContext =>
  ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        headers: headers ?? {},
        user,
      }),
    }),
  }) as unknown as ExecutionContext;

describe('AuthCompositeGuard', () => {
  let guard: AuthCompositeGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let mcpKeyGuard: { canActivate: jest.Mock };
  let apiKeyGuard: { canActivate: jest.Mock };
  let jwtAuthGuard: { canActivate: jest.Mock };
  let requireWorkspaceGuard: { canActivate: jest.Mock };
  let orgTenantGuard: { canActivate: jest.Mock };

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) }; // não é @Public()
    mcpKeyGuard = { canActivate: jest.fn().mockResolvedValue(false) };
    apiKeyGuard = { canActivate: jest.fn().mockResolvedValue(false) };
    jwtAuthGuard = { canActivate: jest.fn().mockResolvedValue(false) };
    // Por padrão, RequireWorkspaceGuard libera (mockando comportamento neutro)
    requireWorkspaceGuard = { canActivate: jest.fn().mockReturnValue(true) };
    // Por padrão, OrgTenantGuard libera (mockando comportamento neutro)
    orgTenantGuard = { canActivate: jest.fn().mockResolvedValue(true) };

    const module = await Test.createTestingModule({
      providers: [
        AuthCompositeGuard,
        { provide: Reflector, useValue: reflector },
        { provide: McpKeyGuard, useValue: mcpKeyGuard },
        { provide: ApiKeyGuard, useValue: apiKeyGuard },
        { provide: JwtAuthGuard, useValue: jwtAuthGuard },
        { provide: RequireWorkspaceGuard, useValue: requireWorkspaceGuard },
        { provide: OrgTenantGuard, useValue: orgTenantGuard },
      ],
    }).compile();

    guard = module.get<AuthCompositeGuard>(AuthCompositeGuard);
  });

  it('deve retornar true para rota @Public()', async () => {
    reflector.getAllAndOverride.mockReturnValue(true); // é @Public()
    const ctx = makeContext();
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('deve retornar true se MCP Key válida (sem tentar API Key ou JWT)', async () => {
    mcpKeyGuard.canActivate.mockResolvedValue(true);
    const ctx = makeContext({ sub: '1', entidadeId: '2', organizationId: '3', email: 'x@x.com' });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(mcpKeyGuard.canActivate).toHaveBeenCalledTimes(1);
  });

  it('deve tentar API Key se MCP Key falhar', async () => {
    mcpKeyGuard.canActivate.mockResolvedValue(false);
    apiKeyGuard.canActivate.mockResolvedValue(true);
    const ctx = makeContext({ sub: '1' });

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(apiKeyGuard.canActivate).toHaveBeenCalledTimes(1);
  });

  it('deve tentar JWT se MCP Key e API Key falharem', async () => {
    mcpKeyGuard.canActivate.mockResolvedValue(false);
    apiKeyGuard.canActivate.mockResolvedValue(false);
    jwtAuthGuard.canActivate.mockResolvedValue(true);

    // Contexto com user populado (JWT válido)
    const ctx: ExecutionContext = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
          user: { sub: '1', entidadeId: '2', organizationId: '3', email: 'x@x.com' },
        }),
      }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(jwtAuthGuard.canActivate).toHaveBeenCalledTimes(1);
  });

  it('deve lançar UnauthorizedException se todos os mecanismos falharem', async () => {
    mcpKeyGuard.canActivate.mockResolvedValue(false);
    apiKeyGuard.canActivate.mockResolvedValue(false);
    jwtAuthGuard.canActivate.mockResolvedValue(true);

    // Mas req.user é null (JWT inválido retornou true mas sem user)
    const ctx = makeContext(undefined); // sem user

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('deve propagar ForbiddenException do OrgTenantGuard (tenant mismatch)', async () => {
    mcpKeyGuard.canActivate.mockResolvedValue(false);
    apiKeyGuard.canActivate.mockResolvedValue(false);
    jwtAuthGuard.canActivate.mockResolvedValue(true);
    orgTenantGuard.canActivate.mockRejectedValue(
      new ForbiddenException('Acesso negado: projeto pertence a outra organização'),
    );

    const ctx: ExecutionContext = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
          user: { sub: '1', entidadeId: '2', organizationId: '3', email: 'x@x.com' },
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(orgTenantGuard.canActivate).toHaveBeenCalledTimes(1);
  });
});
