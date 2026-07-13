import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';

import { PrismaService } from '../../prisma.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { AuthService } from '../auth.service';
import { AuthController } from '../auth.controller';
import { RefreshTokenService } from '../services/refresh-token.service';
import { RefreshIdempotencyService } from '../services/refresh-idempotency.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { ApiKeyService } from '../services/api-key.service';
import { InvitesService } from '../../invites/invites.service';
import { AUTH_ERROR_CODES } from '../../common/errors/error-codes';
import { FakePrisma } from './fake-prisma';

/**
 * Testes §6.1, §6.2 e §6.7 do plano `plan-sessao-auth-hardening.md` (FASE 1).
 *
 * Escritos ANTES da correção e executados contra o código atual — os de corrida
 * (§6.1) e o de token desconhecido (§6.2) DEVEM falhar; o §6.7 (replay real) é o
 * **guarda da segurança** e deve passar ANTES e DEPOIS.
 */
describe('Auth — hardening de refresh (F1)', () => {
  let prisma: FakePrisma;
  let authService: AuthService;
  let controller: AuthController;
  let ids: { userGroupId: bigint; entidadeId: bigint; orgId: bigint };

  /** Relógio controlado — permite ultrapassar a janela de grace sem esperar. */
  let nowMs: number;

  const GRACE_SECONDS = 60;

  const config = {
    get: (key: string, def?: string): string | undefined => {
      const values: Record<string, string> = {
        JWT_EXPIRES_IN: '900',
        REFRESH_TOKEN_EXPIRY_DAYS: '7',
        AUTH_REFRESH_GRACE_SECONDS: String(GRACE_SECONDS),
      };
      return values[key] ?? def;
    },
  } as unknown as ConfigService;

  beforeEach(() => {
    nowMs = new Date('2026-07-13T12:00:00.000Z').getTime();
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);

    prisma = new FakePrisma();
    ids = prisma.seedUser();

    const prismaService = prisma as unknown as PrismaService;
    const metrics = new MetricsService();
    const refreshTokenService = new RefreshTokenService(prismaService, config, metrics);
    const idempotency = new RefreshIdempotencyService(config, metrics);

    authService = new AuthService(
      prismaService,
      new JwtService({ secret: 'test-secret' }),
      config,
      refreshTokenService,
      idempotency,
      { create: jest.fn() } as unknown as OrganizationsService,
      metrics,
    );

    controller = new AuthController(
      authService,
      {} as unknown as ApiKeyService,
      {} as unknown as InvitesService,
      metrics,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Emite o primeiro refresh token da sessão (equivalente ao login). */
  const emitirRefreshToken = async (): Promise<string> => {
    const refreshTokenService = (
      authService as unknown as { refreshTokenService: RefreshTokenService }
    ).refreshTokenService;
    return refreshTokenService.generate(ids.userGroupId);
  };

  /** Avança o relógio (segundos). */
  const avancar = (segundos: number): void => {
    nowMs += segundos * 1000;
  };

  // ─── §6.1 — Corrida de refresh (reproduz B1) ─────────────────────────────

  describe('§6.1 — corrida de refresh (duas abas, mesmo token)', () => {
    it('dois refresh SIMULTÂNEOS com o mesmo RT0 → ambos 200, MESMO par de tokens, sessão viva', async () => {
      const rt0 = await emitirRefreshToken();

      const [a, b] = await Promise.all([
        authService.refresh(rt0, ids.userGroupId),
        authService.refresh(rt0, ids.userGroupId),
      ]);

      // Idempotência: a corrida produz UMA rotação e UMA resposta.
      expect(a.refreshToken).toBe(b.refreshToken);
      expect(a.accessToken).toBe(b.accessToken);

      // A sessão continua viva (slot preenchido — nada foi revogado).
      expect(prisma.currentHash(ids.userGroupId)).toBeDefined();
      expect(prisma.revokeCount).toBe(0);

      // E o token devolvido funciona no refresh seguinte.
      const seguinte = await authService.refresh(a.refreshToken, ids.userGroupId);
      expect(seguinte.refreshToken).toBeDefined();
      expect(prisma.revokeCount).toBe(0);
    });

    it('RT0 chega ATRASADO (dentro da grace de 60s) após rotação → 200, sem revoke', async () => {
      const rt0 = await emitirRefreshToken();

      // Aba A rotaciona.
      const primeiro = await authService.refresh(rt0, ids.userGroupId);
      expect(primeiro.refreshToken).not.toBe(rt0);

      // Aba B, que já tinha o RT0 em mãos, chega 5s depois (fora do cache de
      // idempotência não haveria salvação — é a janela de grace que decide).
      avancar(5);
      const segundo = await authService.refresh(rt0, ids.userGroupId);

      expect(segundo.accessToken).toBeDefined();
      expect(prisma.currentHash(ids.userGroupId)).toBeDefined();
      expect(prisma.revokeCount).toBe(0);
    });
  });

  // ─── §6.2 — Refresh de token desconhecido ────────────────────────────────

  describe('§6.2 — refresh de token desconhecido', () => {
    it("devolve 401 { code: 'TOKEN_INVALID' } — nunca 500", async () => {
      const req = { headers: {}, ip: '1.2.3.4' } as never;

      await expect(
        controller.refresh({ refreshToken: 'lixo-que-nao-existe' }, req),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      try {
        await controller.refresh({ refreshToken: 'lixo-que-nao-existe' }, req);
        throw new Error('deveria ter lançado');
      } catch (err) {
        const exception = err as UnauthorizedException;
        expect(exception.getStatus()).toBe(401);
        expect(exception.getResponse()).toMatchObject({
          code: AUTH_ERROR_CODES.TOKEN_INVALID,
        });
      }
    });
  });

  // ─── §6.7 — GUARDA DA SEGURANÇA: replay REAL ainda é detectado ───────────

  describe('§6.7 — replay real (fora da janela de grace)', () => {
    it('RT0 reapresentado APÓS a grace → 401 + revoke da sessão', async () => {
      const rt0 = await emitirRefreshToken();
      await authService.refresh(rt0, ids.userGroupId); // RT0 → RT1

      // Fora da janela: grace + 1s.
      avancar(GRACE_SECONDS + 1);

      await expect(authService.refresh(rt0, ids.userGroupId)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      // Revogação da sessão — o slot foi apagado (RFC 9700).
      expect(prisma.currentHash(ids.userGroupId)).toBeUndefined();
      expect(prisma.revokeCount).toBeGreaterThanOrEqual(1);
    });

    it('replay real emite DEvento SECURITY_REFRESH_REUSE_DETECTED', async () => {
      const rt0 = await emitirRefreshToken();
      await authService.refresh(rt0, ids.userGroupId);

      avancar(GRACE_SECONDS + 1);

      await expect(authService.refresh(rt0, ids.userGroupId)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      const eventos = prisma.eventosPorDescricao('auth.refresh.reuse_detected');
      expect(eventos).toHaveLength(1);
      expect(eventos[0].metaDados).toMatchObject({
        action: 'SECURITY_REFRESH_REUSE_DETECTED',
      });
    });

    it('token completamente desconhecido (nunca emitido) → 401 + revoke', async () => {
      await emitirRefreshToken();

      await expect(
        authService.refresh('token-forjado-por-atacante', ids.userGroupId),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.currentHash(ids.userGroupId)).toBeUndefined();
    });
  });
});
