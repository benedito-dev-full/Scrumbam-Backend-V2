import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { AUTH_ERROR_CODES } from '../../common/errors/error-codes';
import { AuthCompositeGuard } from '../guards/auth-composite.guard';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ApiKeyGuard } from '../guards/api-key.guard';
import { McpKeyGuard } from '../guards/mcp-key.guard';
import { RequireWorkspaceGuard } from '../guards/require-workspace.guard';
import { OrgTenantGuard } from '../guards/org-tenant.guard';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { RoleResolverService } from '../services/role-resolver.service';
import { ProjectRefService } from '../../projects/project-ref.service';

/**
 * Testes §6.3 e §6.4 do plano `plan-sessao-auth-hardening.md` (FASE 1).
 *
 * §6.3 — **falha de infra não desloga**: pool do Postgres esgotado devolve
 *        `503 AUTH_BACKEND_UNAVAILABLE`, não 401 (antes: 401 mudo → logout).
 * §6.4 — **cache negativo não sequestra permissão**: papel concedido reflete em
 *        ≤10 s (antes: até 300 s), e a invalidação explícita reflete na hora.
 */

/** Erro de pool esgotado do Prisma — o suspeito nº 1 do incidente. */
const poolTimeout = (): Error =>
  new Prisma.PrismaClientKnownRequestError('Timed out fetching a connection from the pool', {
    code: 'P2024',
    clientVersion: '5.7.0',
  });

const makeContext = (): ExecutionContext => {
  const request: Record<string, unknown> = { method: 'GET', url: '/api/v1/projects' };
  const handler = (): void => undefined;
  class Ctrl {}
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => Ctrl,
  } as unknown as ExecutionContext;
};

describe('§6.3 — falha de infra devolve 503, não 401', () => {
  it('JwtStrategy propaga o erro de pool; JwtAuthGuard o converte em 503 AUTH_BACKEND_UNAVAILABLE', async () => {
    // 1. A strategy consulta DVincula a cada request (ADR-V2-030). Pool cheio → lança.
    const prisma = {
      dVincula: { findFirst: jest.fn().mockRejectedValue(poolTimeout()) },
    } as unknown as PrismaService;

    const strategy = new JwtStrategy({ get: () => 'test-secret' } as never, prisma);

    const erro = await strategy
      .validate({ sub: '1', entidadeId: '10', organizationId: '100', email: 'ceo@x.com' })
      .catch((err: unknown) => err);

    expect(erro).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    // 2. O guard classifica esse erro como INFRA e devolve 503 (não 401).
    const guard = new JwtAuthGuard(new Reflector(), new MetricsService());

    try {
      guard.handleRequest(erro, null, undefined, makeContext());
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      const exception = err as ServiceUnavailableException;
      expect(exception.getStatus()).toBe(503);
      expect(exception.getResponse()).toMatchObject({
        code: AUTH_ERROR_CODES.AUTH_BACKEND_UNAVAILABLE,
      });
    }
  });

  it('AuthCompositeGuard aborta a cadeia OR com 503 quando um guard falha por infra', async () => {
    const infra = { canActivate: jest.fn().mockRejectedValue(poolTimeout()) };
    const semCredencial = { canActivate: jest.fn().mockResolvedValue(false) };

    const guard = new AuthCompositeGuard(
      new Reflector(),
      semCredencial as unknown as McpKeyGuard,
      semCredencial as unknown as ApiKeyGuard,
      infra as unknown as JwtAuthGuard,
      { canActivate: () => true } as unknown as RequireWorkspaceGuard,
      { canActivate: () => true } as unknown as OrgTenantGuard,
      new MetricsService(),
    );

    const err = await guard.canActivate(makeContext()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getResponse()).toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_BACKEND_UNAVAILABLE,
    });
  });

  it('credencial inválida (não-infra) continua devolvendo 401 — a cadeia OR não foi quebrada', async () => {
    const credencialInvalida = {
      canActivate: jest.fn().mockRejectedValue(new Error('jwt malformed')),
    };
    const semCredencial = { canActivate: jest.fn().mockResolvedValue(false) };

    const guard = new AuthCompositeGuard(
      new Reflector(),
      semCredencial as unknown as McpKeyGuard,
      semCredencial as unknown as ApiKeyGuard,
      credencialInvalida as unknown as JwtAuthGuard,
      { canActivate: () => true } as unknown as RequireWorkspaceGuard,
      { canActivate: () => true } as unknown as OrgTenantGuard,
      new MetricsService(),
    );

    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('§6.4 — cache negativo de role não sequestra a permissão', () => {
  let nowMs: number;

  const buildResolver = (vinculos: Array<{ idClasse: bigint }>): RoleResolverService => {
    const prisma = {
      dVincula: { findFirst: jest.fn(async () => vinculos[0] ?? null) },
    } as unknown as PrismaService;

    return new RoleResolverService(
      prisma,
      {} as unknown as ProjectRefService,
      new MetricsService(),
    );
  };

  beforeEach(() => {
    nowMs = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
  });

  afterEach(() => jest.restoreAllMocks());

  it('papel concedido reflete em ≤10s (antes: até 300s)', async () => {
    const vinculos: Array<{ idClasse: bigint }> = [];
    const resolver = buildResolver(vinculos);
    const userId = BigInt(10);
    const orgId = BigInt(100);

    // 1. Sem membership → null (o `null` vai para o cache NEGATIVO).
    expect(await resolver.getOrgRole(userId, orgId)).toBeNull();

    // 2. Admin concede MEMBER.
    vinculos.push({ idClasse: BigInt(-162) });

    // 3. Dentro dos 10 s o negativo ainda vale (protege contra hammering).
    nowMs += 5_000;
    expect(await resolver.getOrgRole(userId, orgId)).toBeNull();

    // 4. Passados 11 s, o papel concedido vale.
    nowMs += 6_000;
    expect(await resolver.getOrgRole(userId, orgId)).toBe('MEMBER');
  });

  it('papel POSITIVO continua cacheado por 300s (não regredimos performance)', async () => {
    const vinculos: Array<{ idClasse: bigint }> = [{ idClasse: BigInt(-161) }];
    const resolver = buildResolver(vinculos);
    const userId = BigInt(10);
    const orgId = BigInt(100);

    expect(await resolver.getOrgRole(userId, orgId)).toBe('ADMIN');

    // Some o vínculo do banco: o cache positivo segura por 5 min (comportamento
    // preservado — a coerência forte vem de invalidateUser, testada abaixo).
    vinculos.length = 0;
    nowMs += 60_000;
    expect(await resolver.getOrgRole(userId, orgId)).toBe('ADMIN');
  });

  it('invalidateUser() derruba o cache do usuário na hora (org E projeto)', async () => {
    const vinculos: Array<{ idClasse: bigint }> = [];
    const resolver = buildResolver(vinculos);
    const userId = BigInt(10);
    const orgId = BigInt(100);

    expect(await resolver.getOrgRole(userId, orgId)).toBeNull();

    // Admin concede o papel E o call-site invalida (é o que a F1 ligou).
    vinculos.push({ idClasse: BigInt(-161) });
    resolver.invalidateUser(userId, orgId);

    // Sem esperar TTL algum.
    expect(await resolver.getOrgRole(userId, orgId)).toBe('ADMIN');
  });
});
