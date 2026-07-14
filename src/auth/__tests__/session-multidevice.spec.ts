import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';

import { PrismaService } from '../../prisma.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { AuthService } from '../auth.service';
import { RefreshTokenService } from '../services/refresh-token.service';
import { RefreshIdempotencyService } from '../services/refresh-idempotency.service';
import { SessionService } from '../services/session.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { AUTH_ERROR_CODES } from '../../common/errors/error-codes';
import { FakePrisma, sha256 } from './fake-prisma';

/**
 * Testes §6.6 (multi-device) e §6.7 (replay real) do plano
 * `plan-sessao-auth-hardening.md` — **FASE 3** (sessões em DTabela, ADR-V2-077).
 *
 * ## O que estes testes provam
 *
 * 1. **§6.6 — multi-device.** Antes da F3, logar num 2º device **APAGAVA** o slot
 *    do 1º (`RefreshTokenService.generate` sobrescrevia `dados.refreshTokenHash`
 *    e limpava o `prevHash`), e o 1º device, ao renovar, era acusado de REUSE
 *    ATTACK e tinha a sessão revogada. Este teste FALHA contra o código pré-F3.
 * 2. **§6.7 — replay real ainda é punido.** É o **guarda da segurança**: a F3 não
 *    pode ter comprado conveniência com laxismo. Replay fora da grace revoga a
 *    **família** (e não mais a conta inteira) e emite DEvento.
 * 3. **Escalação RFC 9700.** Token de sessão já revogada *por replay* → derruba
 *    TODAS as sessões (credencial vazada circulando).
 * 4. **Dual-read (§7 — risco nº 1).** Usuário que só tem SLOT LEGADO renova
 *    normalmente **e é migrado** para `DTabela` naquele instante. É o que garante
 *    que o deploy não desloga ninguém.
 */
describe('Auth — sessões multi-device (F3)', () => {
  let prisma: FakePrisma;
  let authService: AuthService;
  let sessions: SessionService;
  let refreshTokenService: RefreshTokenService;
  let ids: { userGroupId: bigint; entidadeId: bigint; orgId: bigint };
  let nowMs: number;

  const GRACE_SECONDS = 60;

  const config = {
    get: (key: string, def?: string): string | undefined => {
      const values: Record<string, string> = {
        JWT_EXPIRES_IN: '900',
        REFRESH_TOKEN_EXPIRY_DAYS: '7',
        SESSION_ABSOLUTE_EXPIRY_DAYS: '30',
        SESSION_MAX_PER_USER: '10',
        AUTH_REFRESH_GRACE_SECONDS: String(GRACE_SECONDS),
        SESSIONS_V2_ENABLED: 'true',
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
    refreshTokenService = new RefreshTokenService(prismaService, config, metrics);
    sessions = new SessionService(prismaService, config, refreshTokenService, metrics);

    authService = new AuthService(
      prismaService,
      new JwtService({ secret: 'test-secret' }),
      config,
      refreshTokenService,
      new RefreshIdempotencyService(config, metrics),
      sessions,
      { create: jest.fn() } as unknown as OrganizationsService,
      metrics,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  /** Avança o relógio (a idempotência in-process usa a mesma base de tempo). */
  const avancar = (segundos: number): void => {
    nowMs += segundos * 1000;
  };

  /** Simula um login de device (é o que `AuthService.login` faz internamente). */
  const logar = async (device: string): Promise<{ token: string; sessionId: bigint }> => {
    const { plaintext, sessionId } = await sessions.createSession(ids.userGroupId, {
      ip: '10.0.0.1',
      userAgent: device,
    });
    return { token: plaintext, sessionId };
  };

  const sessoesAtivas = (): number =>
    prisma.tabelas.filter((t) => t.idClasse === BigInt(-485) && !t.excluido).length;

  // ──────────────────────────────────────────────────────────────────────────
  // §6.6 — MULTI-DEVICE (o bug que a F3 mata)
  // ──────────────────────────────────────────────────────────────────────────
  describe('§6.6 — multi-device', () => {
    it('login no device B NÃO invalida a sessão do device A (o bug do slot único)', async () => {
      const notebook = await logar('Notebook');
      const celular = await logar('Celular');

      expect(sessoesAtivas()).toBe(2);
      expect(notebook.sessionId).not.toEqual(celular.sessionId);

      // O notebook renova DEPOIS do login do celular. Antes da F3, isto era
      // classificado como REUSE ATTACK e derrubava a sessão inteira do usuário.
      const resposta = await authService.refresh(notebook.token, undefined, {});

      expect(resposta.accessToken).toBeDefined();
      expect(resposta.refreshToken).not.toBe(notebook.token); // rotacionou
      expect(sessoesAtivas()).toBe(2); // NINGUÉM foi revogado
    });

    it('refresh no device A não afeta o token do device B', async () => {
      const a = await logar('Device A');
      const b = await logar('Device B');

      await authService.refresh(a.token, undefined, {});
      avancar(GRACE_SECONDS + 5);

      // B renova bem depois — seu token continua sendo o corrente DA SESSÃO DELE.
      const respostaB = await authService.refresh(b.token, undefined, {});
      expect(respostaB.accessToken).toBeDefined();
      expect(sessoesAtivas()).toBe(2);
    });

    it('revogar a sessão A não afeta B; A passa a responder 401 SESSION_REVOKED', async () => {
      const a = await logar('Device A');
      const b = await logar('Device B');

      await authService.revokeSession(ids.userGroupId, a.sessionId);

      await expect(authService.refresh(a.token, undefined, {})).rejects.toMatchObject({
        response: { code: AUTH_ERROR_CODES.SESSION_REVOKED },
      });

      // B segue vivo.
      const respostaB = await authService.refresh(b.token, undefined, {});
      expect(respostaB.accessToken).toBeDefined();
      expect(sessoesAtivas()).toBe(1);
    });

    it('logout revoga SÓ a sessão deste device (as outras continuam)', async () => {
      const a = await logar('Device A');
      const b = await logar('Device B');

      await authService.logout(ids.userGroupId, a.sessionId);

      expect(sessoesAtivas()).toBe(1);
      const respostaB = await authService.refresh(b.token, undefined, {});
      expect(respostaB.accessToken).toBeDefined();
      void a;
    });

    it('GET /auth/sessions lista os devices e NUNCA devolve hash', async () => {
      const a = await logar('Notebook');
      await logar('Celular');

      const lista = await authService.listSessions(ids.userGroupId, a.sessionId);

      expect(lista).toHaveLength(2);
      expect(lista.find((s) => s.id === a.sessionId.toString())?.current).toBe(true);

      const serializado = JSON.stringify(lista);
      expect(serializado).not.toContain(sha256(a.token)); // nada de hash
      expect(serializado).not.toContain('prevHash');
      expect(serializado).not.toContain('familyId');
    });

    it('"sair de todos os outros dispositivos" preserva a sessão atual', async () => {
      const atual = await logar('Device atual');
      await logar('Device 2');
      await logar('Device 3');

      const revogadas = await authService.revokeOtherSessions(ids.userGroupId, atual.sessionId);

      expect(revogadas).toBe(2);
      expect(sessoesAtivas()).toBe(1);
      await expect(authService.refresh(atual.token, undefined, {})).resolves.toBeDefined();
    });

    it('revogar sessão de OUTRO usuário responde 404 (anti-enumeração)', async () => {
      const alheia = BigInt(999999);
      await expect(authService.revokeSession(ids.userGroupId, alheia)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §6.7 — O GUARDA DA SEGURANÇA (replay real continua sendo punido)
  // ──────────────────────────────────────────────────────────────────────────
  describe('§6.7 — replay real', () => {
    it('replay FORA da grace revoga a FAMÍLIA, emite DEvento e devolve 401', async () => {
      const notebook = await logar('Notebook');
      const celular = await logar('Celular');

      await authService.refresh(notebook.token, undefined, {}); // RT0 → RT1
      avancar(GRACE_SECONDS + 1); // a janela fecha

      // RT0 volta DEPOIS da janela: isto é replay REAL (RFC 9700).
      await expect(
        authService.refresh(notebook.token, undefined, { ip: '9.9.9.9' }),
      ).rejects.toMatchObject({
        response: { code: AUTH_ERROR_CODES.SESSION_REUSE_DETECTED },
      });

      // A família do notebook morreu…
      const eventos = prisma.eventosPorDescricao('auth.refresh.reuse_detected');
      expect(eventos).toHaveLength(1);
      expect(eventos[0].idClasse).toBe(BigInt(-523));

      // …mas o CELULAR continua válido. É a diferença entre castigar o grant
      // comprometido (RFC 9700) e castigar a conta do usuário (o que fazíamos).
      expect(sessoesAtivas()).toBe(1);
      await expect(authService.refresh(celular.token, undefined, {})).resolves.toBeDefined();
    });

    it('token anterior DENTRO da grace é benigno (corrida de abas) — não revoga', async () => {
      const aba = await logar('Notebook');

      await authService.refresh(aba.token, undefined, {}); // RT0 → RT1
      avancar(GRACE_SECONDS - 10); // ainda dentro da janela

      // A 2ª aba chega com o RT0. Rotaciona de novo, sem revogar nada.
      const resposta = await authService.refresh(aba.token, undefined, {});
      expect(resposta.accessToken).toBeDefined();
      expect(sessoesAtivas()).toBe(1);
      expect(prisma.eventosPorDescricao('auth.refresh.reuse_detected')).toHaveLength(0);
    });

    it('ESCALAÇÃO: replay de sessão JÁ revogada por replay derruba TODAS as sessões', async () => {
      const comprometida = await logar('Device comprometido');
      await logar('Outro device');

      await authService.refresh(comprometida.token, undefined, {});
      avancar(GRACE_SECONDS + 1);

      // 1º replay → revoga a família da sessão comprometida.
      await expect(authService.refresh(comprometida.token, undefined, {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(sessoesAtivas()).toBe(1); // o outro device sobreviveu

      // 2º replay do MESMO token: a credencial vazada continua circulando →
      // RFC 9700 manda derrubar o grant inteiro do usuário.
      await expect(authService.refresh(comprometida.token, undefined, {})).rejects.toMatchObject({
        response: { code: AUTH_ERROR_CODES.SESSION_REUSE_DETECTED },
      });

      expect(sessoesAtivas()).toBe(0); // agora sim: tudo revogado
      const criticos = prisma.eventosPorDescricao('auth.session.all_revoked');
      expect(criticos).toHaveLength(1);
      expect(criticos[0].idClasse).toBe(BigInt(-524));
    });

    it('token completamente desconhecido → 401 TOKEN_INVALID sem revogar nada', async () => {
      await logar('Device legítimo');

      await expect(authService.refresh('lixo-total', undefined, {})).rejects.toMatchObject({
        response: { code: AUTH_ERROR_CODES.TOKEN_INVALID },
      });

      expect(sessoesAtivas()).toBe(1); // ninguém pagou por um token que não é nosso
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // DUAL-READ — "o deploy vai deslogar todo mundo?" (§7, risco nº 1)
  // ──────────────────────────────────────────────────────────────────────────
  describe('dual-read (migração preguiçosa do slot legado)', () => {
    /** Usuário logado ANTES da F3: só tem slot legado, zero linha em DTabela. */
    const logarNoLegado = async (): Promise<string> =>
      refreshTokenService.generate(ids.userGroupId);

    it('usuário com SLOT LEGADO renova normalmente (não é deslogado no deploy)', async () => {
      const tokenLegado = await logarNoLegado();
      expect(sessoesAtivas()).toBe(0); // nenhuma sessão em DTabela ainda

      const resposta = await authService.refresh(tokenLegado, undefined, { ip: '10.0.0.9' });

      expect(resposta.accessToken).toBeDefined();
      expect(resposta.refreshToken).not.toBe(tokenLegado);
    });

    it('o slot legado é MIGRADO para DTabela no primeiro refresh', async () => {
      const tokenLegado = await logarNoLegado();

      await authService.refresh(tokenLegado, undefined, {});

      // A sessão passou a existir — e pertence ao usuário certo.
      expect(sessoesAtivas()).toBe(1);
      const sessao = prisma.tabelas.find((t) => t.idClasse === BigInt(-485));
      expect(sessao?.dEntidadeId).toBe(ids.entidadeId);
      expect(sessao?.metaDados.userGroupId).toBe(ids.userGroupId.toString());
    });

    it('após a migração, o novo token vive na SESSÃO (não mais no slot)', async () => {
      const tokenLegado = await logarNoLegado();
      const primeira = await authService.refresh(tokenLegado, undefined, {});

      avancar(GRACE_SECONDS + 5);

      // O token devolvido pela migração renova pela sessão recém-criada.
      const segunda = await authService.refresh(primeira.refreshToken, undefined, {});
      expect(segunda.accessToken).toBeDefined();
      expect(sessoesAtivas()).toBe(1); // não duplicou a sessão
    });

    it('dual-write: o slot legado acompanha o token vigente (rollback sem logout)', async () => {
      const { token } = await logar('Notebook');

      // Mesmo com a F3 ligada, o slot legado está populado — é o que permite
      // desligar `SESSIONS_V2_ENABLED` sem deslogar ninguém.
      expect(prisma.currentHash(ids.userGroupId)).toBe(sha256(token));

      const resposta = await authService.refresh(token, undefined, {});
      expect(prisma.currentHash(ids.userGroupId)).toBe(sha256(resposta.refreshToken));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Expiração e política de sessões (3.5)
  // ──────────────────────────────────────────────────────────────────────────
  describe('expiração e cap', () => {
    it('sessão idle (7 d sem uso) expira com 401 TOKEN_EXPIRED — sem acusar reuse', async () => {
      const { token } = await logar('Notebook');

      avancar(8 * 24 * 60 * 60); // 8 dias

      await expect(authService.refresh(token, undefined, {})).rejects.toMatchObject({
        response: { code: AUTH_ERROR_CODES.TOKEN_EXPIRED },
      });
      expect(prisma.eventosPorDescricao('auth.refresh.reuse_detected')).toHaveLength(0);
    });

    it('expiração ABSOLUTA (30 d) vence mesmo com uso contínuo', async () => {
      let atual = (await logar('Notebook')).token;

      // Renova a cada 5 dias — o idle nunca vence, mas o teto absoluto sim.
      for (let i = 0; i < 6; i += 1) {
        avancar(5 * 24 * 60 * 60);
        const resposta = await authService.refresh(atual, undefined, {});
        atual = resposta.refreshToken;
      }

      avancar(5 * 24 * 60 * 60); // total > 30 d
      await expect(authService.refresh(atual, undefined, {})).rejects.toMatchObject({
        response: { code: AUTH_ERROR_CODES.TOKEN_EXPIRED },
      });
    });

    it('cap de 10 sessões: a 11ª evicta a mais antiga (LRU)', async () => {
      for (let i = 0; i < 10; i += 1) {
        avancar(60);
        await logar(`Device ${i}`);
      }
      expect(sessoesAtivas()).toBe(10);

      avancar(60);
      await logar('Device 11');

      expect(sessoesAtivas()).toBe(10); // continua no teto
      const evictadas = prisma.tabelas.filter(
        (t) => t.excluido && t.metaDados.revokedReason === 'evicted_lru',
      );
      expect(evictadas).toHaveLength(1);
      expect(evictadas[0].descricao).toBe('Device 0'); // a mais antiga
    });
  });
});
