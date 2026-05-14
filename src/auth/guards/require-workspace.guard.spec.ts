import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { RequireWorkspaceGuard } from './require-workspace.guard';

/**
 * Cria um ExecutionContext mockado para os testes deste guard.
 */
const makeContext = (request: Record<string, unknown>): ExecutionContext =>
  ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  }) as unknown as ExecutionContext;

describe('RequireWorkspaceGuard', () => {
  let guard: RequireWorkspaceGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };

    const module = await Test.createTestingModule({
      providers: [RequireWorkspaceGuard, { provide: Reflector, useValue: reflector }],
    }).compile();

    guard = module.get<RequireWorkspaceGuard>(RequireWorkspaceGuard);
  });

  it('deve liberar quando não há req.user (rota pública ou não autenticada)', () => {
    const ctx = makeContext({ url: '/health' });

    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
  });

  it('deve liberar quando authMethod=apikey (API Key não tem conceito de órfão)', () => {
    const ctx = makeContext({
      user: { sub: '1', entidadeId: '2', email: 'x@x.com' },
      authMethod: 'apikey',
      url: '/projects',
    });

    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
  });

  it('deve liberar quando authMethod=mcpkey (MCP Key não tem conceito de órfão)', () => {
    const ctx = makeContext({
      user: { sub: '1', entidadeId: '2', email: 'x@x.com' },
      authMethod: 'mcpkey',
      url: '/projects',
    });

    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
  });

  it('deve liberar quando JWT tem organizationId (caso normal)', () => {
    const ctx = makeContext({
      user: {
        sub: '1',
        entidadeId: '2',
        organizationId: '152',
        email: 'x@x.com',
      },
      authMethod: 'jwt',
      url: '/projects',
    });

    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    // Não precisa nem consultar metadata: tem org, está OK.
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
  });

  it('deve liberar JWT órfão quando rota tem @AllowOrphan()', () => {
    reflector.getAllAndOverride.mockReturnValue(true); // rota marcou @AllowOrphan()

    const ctx = makeContext({
      user: { sub: '1', entidadeId: '2', email: 'orfao@x.com' },
      authMethod: 'jwt',
      url: '/auth/me',
    });

    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledTimes(1);
  });

  it('deve lançar ForbiddenException NO_WORKSPACE para JWT órfão em rota sem @AllowOrphan()', () => {
    reflector.getAllAndOverride.mockReturnValue(false); // rota NÃO marcou @AllowOrphan()

    const ctx = makeContext({
      user: { sub: '1', entidadeId: '2', email: 'orfao@x.com' },
      authMethod: 'jwt',
      url: '/projects',
    });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);

    try {
      guard.canActivate(ctx);
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as {
        code: string;
        message: string;
      };
      expect(response.code).toBe('NO_WORKSPACE');
      expect(response.message).toMatch(/workspace/i);
    }
  });

  it('deve tratar authMethod ausente como JWT (compat com fluxo atual)', () => {
    // Quando JwtStrategy popula req.user mas authMethod não é setado por
    // algum motivo (rota não passou pelo AuthCompositeGuard), o guard deve
    // continuar bloqueando órfão em rota tenant-scoped.
    reflector.getAllAndOverride.mockReturnValue(false);

    const ctx = makeContext({
      user: { sub: '1', entidadeId: '2', email: 'orfao@x.com' },
      // authMethod: undefined,
      url: '/projects',
    });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
