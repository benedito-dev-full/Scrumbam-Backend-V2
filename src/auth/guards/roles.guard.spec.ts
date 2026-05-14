import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { RolesGuard } from './roles.guard';
import { RoleResolverService } from '../services/role-resolver.service';
import { ROLES_KEY } from '../decorators/roles.decorator';

const makeContext = (user?: object): ExecutionContext =>
  ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let roleResolver: { getOrgRole: jest.Mock };

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn() };
    roleResolver = { getOrgRole: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        RolesGuard,
        { provide: Reflector, useValue: reflector },
        { provide: RoleResolverService, useValue: roleResolver },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
  });

  it('deve retornar true sem @Roles() (sem restrição)', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = makeContext({ sub: '1', organizationId: '10' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('deve permitir acesso se user tem role exigido', async () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    roleResolver.getOrgRole.mockResolvedValue('ADMIN');

    const ctx = makeContext({ sub: '1', organizationId: '10' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('deve lançar ForbiddenException se role insuficiente', async () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    roleResolver.getOrgRole.mockResolvedValue('VIEWER');

    const ctx = makeContext({ sub: '2', organizationId: '10' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('deve lançar ForbiddenException se usuário sem vínculo na org', async () => {
    reflector.getAllAndOverride.mockReturnValue(['MEMBER']);
    roleResolver.getOrgRole.mockResolvedValue(null);

    const ctx = makeContext({ sub: '3', organizationId: '10' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('deve lançar ForbiddenException NO_WORKSPACE quando JWT órfão atinge rota com @Roles()', async () => {
    // Cenário: rota com @AllowOrphan() + @Roles() — RequireWorkspaceGuard
    // liberou pelo @AllowOrphan(), mas RolesGuard precisa proteger contra
    // BigInt(undefined). Resposta deve carregar code: 'NO_WORKSPACE'.
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);

    const ctx = makeContext({ sub: '1', email: 'orfao@x.com' }); // SEM organizationId

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);

    try {
      await guard.canActivate(ctx);
    } catch (err) {
      const response = (err as ForbiddenException).getResponse() as {
        code: string;
        message: string;
      };
      expect(response.code).toBe('NO_WORKSPACE');
    }

    // Não deve chamar roleResolver (curto-circuito antes de BigInt conversion)
    expect(roleResolver.getOrgRole).not.toHaveBeenCalled();
  });

  it('deve usar ROLES_KEY correto na consulta ao Reflector', async () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    roleResolver.getOrgRole.mockResolvedValue('ADMIN');

    const ctx = makeContext({ sub: '1', organizationId: '10' });
    await guard.canActivate(ctx);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, expect.any(Array));
  });
});
