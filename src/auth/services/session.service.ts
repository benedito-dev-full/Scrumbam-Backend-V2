import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';

import { PrismaService } from '../../prisma.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { RefreshTokenService } from './refresh-token.service';

/** DClasse da sessão (DTabela). Seed: `prisma/seeds/classes.seed.ts`. */
export const ID_CLASSE_SESSION = BigInt(-485);

/** DEventos de ciclo de vida / segurança de sessão (ADR-V2-077). */
export const ID_CLASSE_SESSION_CREATED = BigInt(-504);
export const ID_CLASSE_SESSION_REVOKED = BigInt(-509);
export const ID_CLASSE_SECURITY_REUSE_DETECTED = BigInt(-523);
export const ID_CLASSE_SECURITY_ALL_SESSIONS_REVOKED = BigInt(-524);

/** DClasse da DEntidade de usuário (-150 USER). */
const ID_CLASSE_USER = BigInt(-150);

/** Teto de sessões ativas por usuário (evicção LRU da mais antiga). */
const DEFAULT_MAX_SESSIONS_PER_USER = 10;

/** Expiração ABSOLUTA (dias) — teto duro; força re-login mesmo em uso contínuo. */
const DEFAULT_ABSOLUTE_EXPIRY_DAYS = 30;

/** Expiração IDLE (dias) — renovada a cada rotação. */
const DEFAULT_IDLE_EXPIRY_DAYS = 7;

/** Motivos de revogação (rótulo em `metaDados.revokedReason` e telemetria). */
export type SessionRevokeReason =
  | 'logout'
  | 'logout_all'
  | 'revoked_by_user'
  | 'password_changed'
  | 'reuse_detected'
  | 'reuse_escalation'
  | 'evicted_lru'
  | 'expired';

/** `metaDados` de uma linha de sessão (DTabela idClasse=-485). */
export interface SessionMeta {
  /** Chave do DUserGroup dono (string — Json não carrega BigInt). */
  userGroupId: string;
  /** Identificador único desta emissão de token (RFC 9700). */
  jti: string;
  /** Hash do refresh token IMEDIATAMENTE anterior (janela de grace). */
  prevHash?: string;
  /** ISO — até quando o `prevHash` é aceito como benigno (corrida de abas). */
  prevHashValidUntil?: string;
  issuedAt: string;
  /** ISO — expira se ficar N dias sem uso (renovado a cada rotação). */
  idleExpiresAt: string;
  /** ISO — teto duro; NUNCA é estendido. */
  absoluteExpiresAt: string;
  lastUsedAt: string;
  ip?: string;
  userAgent?: string;
  revokedAt?: string;
  revokedReason?: SessionRevokeReason;
}

/** Linha de sessão materializada (projeção interna — NUNCA vai para a rede). */
export interface SessionRow {
  chave: bigint;
  /** sha256 do refresh token CORRENTE. */
  codigo: string;
  /** familyId (uuid) — a família RFC 9700. */
  familyId: string;
  /** DEntidade (-150) do dono. */
  entidadeId: bigint | null;
  deviceLabel: string | null;
  excluido: boolean;
  meta: SessionMeta;
}

/**
 * Estado do refresh token apresentado, do ponto de vista das SESSÕES (F3).
 *
 * - `valid`   — bate com o `codigo` da sessão ativa → rotaciona.
 * - `grace`   — bate com o `prevHash` DENTRO da janela → corrida de abas,
 *               **benigno**: rotaciona, NÃO revoga.
 * - `expired` — sessão ativa, mas idle/absoluta venceu → 401 pedindo re-login.
 * - `replay`  — sessão ATIVA e o token é anterior FORA da grace → replay REAL:
 *               revoga a **FAMÍLIA** (não a conta).
 * - `revoked` — a sessão já foi revogada por motivo benigno (logout, etc.).
 * - `reuse_escalation` — o token é de uma sessão já revogada **por replay**:
 *               credencial vazada (RFC 9700) → revoga **TODAS** as sessões.
 * - `unknown` — nenhuma sessão nem slot legado casa. Não sabemos de quem é →
 *               401 sem revogar nada.
 */
export type SessionState =
  | 'valid'
  | 'grace'
  | 'expired'
  | 'replay'
  | 'revoked'
  | 'reuse_escalation'
  | 'unknown';

/** Resultado de {@link SessionService.inspect}. */
export interface SessionInspection {
  state: SessionState;
  session?: SessionRow;
  /** `true` quando a sessão foi materializada AGORA a partir do slot legado. */
  migratedFromLegacy?: boolean;
}

/** Contexto do device (telemetria + UX de "dispositivos conectados"). */
export interface SessionContext {
  ip?: string;
  userAgent?: string;
}

/** Par emitido ao criar/rotacionar uma sessão. */
export interface IssuedSession {
  /** Refresh token plaintext — devolvido ao cliente, NUNCA persistido. */
  plaintext: string;
  sessionId: bigint;
  familyId: string;
}

/**
 * Sessões multi-device sobre `DTabela` (F3 — ADR-V2-077).
 *
 * ## O bug que esta classe mata
 *
 * Até a F2, o refresh token vivia num **slot único** em `DUserGroup.dados`.
 * `RefreshTokenService.generate()` (usado no LOGIN) sobrescrevia esse slot e
 * limpava o `prevHash`. Consequência **real e viva em produção**:
 *
 * ```
 * 1. usuário loga no notebook  → slot = tokenA
 * 2. usuário loga no celular   → slot = tokenB   (tokenA APAGADO)
 * 3. notebook tenta renovar    → hash desconhecido → REUSE ATTACK → revoga
 * ```
 *
 * **Logar num 2º dispositivo matava a sessão do 1º — e ainda acusava o usuário
 * de roubo de credencial.** A grace window da F1 não cobre isso: ela protege a
 * *rotação*; o *login* não rotaciona, sobrescreve. Slot único é a doença;
 * uma-linha-por-sessão é a cura.
 *
 * ## Modelagem (ZERO tabela nova — ADR-V2-001)
 *
 * Precedente ratificado: **ADR-V2-004** (API Keys -471 / MCP Keys -472 já são
 * credenciais de longa duração morando em `DTabela`). Sessão segue o padrão:
 *
 * | coluna        | conteúdo                                        |
 * |---------------|-------------------------------------------------|
 * | `idClasse`    | -485 SESSION                                    |
 * | `codigo`      | `sha256(refreshToken)` CORRENTE → lookup indexado |
 * | `nome`        | `familyId` (uuid) — a família do RFC 9700       |
 * | `descricao`   | device label (User-Agent resumido)               |
 * | `dEntidadeId` | DEntidade (-150) do usuário — listagem/revoke    |
 * | `metaDados`   | {@link SessionMeta}                              |
 * | `excluido`    | revogada                                        |
 *
 * ## Deploy sem deslogar ninguém (§7 do plano)
 *
 * **Dual-read com migração preguiçosa:** {@link inspect} procura a sessão em
 * `DTabela`; **se não achar, cai no slot legado** (`DUserGroup.dados`) e, se
 * bater, **materializa a sessão naquele instante** ({@link migrateLegacySlot}).
 * Em ≤ 7 dias (validade do refresh) 100% da base migra sozinha.
 *
 * **Dual-write:** toda emissão/rotação espelha o hash corrente no slot legado
 * ({@link RefreshTokenService.mirrorLegacySlot}). Isso torna o rollback
 * (`SESSIONS_V2_ENABLED=false`) instantâneo e **sem logout** — o slot legado
 * está sempre populado com a sessão mais recente do usuário.
 *
 * @see AuthService.refresh — orquestra inspeção → rotação → resposta
 * @see TabelaService — DENYLIST de -485 no endpoint genérico `/tabelas`
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly refreshTokenService: RefreshTokenService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  // ─── Configuração ────────────────────────────────────────────────────────

  /**
   * Feature flag de rollback instantâneo (§7 do plano).
   *
   * `SESSIONS_V2_ENABLED=false` devolve o refresh ao caminho F1 (slot único).
   * Como o dual-write mantém o slot legado sempre populado, desligar a flag
   * **não desloga ninguém**. Default: **ligado**.
   */
  isEnabled(): boolean {
    return String(this.config.get<string>('SESSIONS_V2_ENABLED') ?? 'true').trim() !== 'false';
  }

  /** Teto de sessões ativas por usuário (`SESSION_MAX_PER_USER`, default 10). */
  private getMaxSessions(): number {
    return this.getPositiveInt('SESSION_MAX_PER_USER', DEFAULT_MAX_SESSIONS_PER_USER);
  }

  /** Expiração idle em dias (`REFRESH_TOKEN_EXPIRY_DAYS`, default 7). */
  private getIdleDays(): number {
    return this.getPositiveInt('REFRESH_TOKEN_EXPIRY_DAYS', DEFAULT_IDLE_EXPIRY_DAYS);
  }

  /** Expiração absoluta em dias (`SESSION_ABSOLUTE_EXPIRY_DAYS`, default 30). */
  private getAbsoluteDays(): number {
    return this.getPositiveInt('SESSION_ABSOLUTE_EXPIRY_DAYS', DEFAULT_ABSOLUTE_EXPIRY_DAYS);
  }

  /** Lê inteiro positivo da env, com default e warn em valor inválido. */
  private getPositiveInt(key: string, fallback: number): number {
    const raw = String(this.config.get<string>(key) ?? '').trim();
    if (raw === '') return fallback;
    if (!/^\d+$/.test(raw)) {
      this.logger.warn(`${key} inválido ("${raw}") — usando default ${fallback}`);
      return fallback;
    }
    const parsed = parseInt(raw, 10);
    return parsed > 0 ? parsed : fallback;
  }

  /** SHA-256 hex. */
  private hash(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }

  /** Janela de grace em ms — MESMO horizonte da F1 (fonte única). */
  private getGraceMs(): number {
    return this.refreshTokenService.getGraceMs();
  }

  private diasEmMs(dias: number): number {
    return dias * 24 * 60 * 60 * 1000;
  }

  // ─── Criação ─────────────────────────────────────────────────────────────

  /**
   * Cria uma sessão NOVA (login / register / aceite de convite).
   *
   * **NÃO toca as demais sessões do usuário** — é exatamente o ponto da F3.
   * Aplica o cap de {@link getMaxSessions} com evicção LRU (a mais antiga por
   * `lastUsedAt` sai) e espelha o slot legado (dual-write / rollback).
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @param ctx - ip / user-agent (device label + telemetria)
   * @returns Refresh token plaintext + id da sessão + familyId
   *
   * @example
   * ```typescript
   * const { plaintext, sessionId } = await sessions.createSession(ug.chave, ctx);
   * // `plaintext` volta ao cliente; `sessionId` vira o claim `sid` do JWT.
   * ```
   */
  async createSession(userGroupId: bigint, ctx?: SessionContext): Promise<IssuedSession> {
    const entidadeId = await this.resolveEntidadeId(userGroupId);
    const plaintext = randomBytes(64).toString('hex');
    const agora = Date.now();
    const familyId = randomUUID();

    const meta: SessionMeta = {
      userGroupId: userGroupId.toString(),
      jti: randomUUID(),
      issuedAt: new Date(agora).toISOString(),
      idleExpiresAt: new Date(agora + this.diasEmMs(this.getIdleDays())).toISOString(),
      absoluteExpiresAt: new Date(agora + this.diasEmMs(this.getAbsoluteDays())).toISOString(),
      lastUsedAt: new Date(agora).toISOString(),
      ...(ctx?.ip && { ip: ctx.ip }),
      ...(ctx?.userAgent && { userAgent: ctx.userAgent }),
    };

    // Evicção ANTES do insert: o cap vale para o estado final.
    if (entidadeId !== null) {
      await this.evictOldestIfOverCap(entidadeId);
    }

    const criada = await this.prisma.dTabela.create({
      data: {
        idClasse: ID_CLASSE_SESSION,
        codigo: this.hash(plaintext),
        nome: familyId,
        descricao: this.deviceLabel(ctx),
        ...(entidadeId !== null && { dEntidadeId: entidadeId }),
        metaDados: meta as unknown as Prisma.InputJsonValue,
      },
      select: { chave: true },
    });

    // Dual-write (§7): slot legado espelhado → rollback da flag não desloga.
    await this.refreshTokenService.mirrorLegacySlot(userGroupId, plaintext);

    this.metrics?.increment('auth.session.created', {
      userGroupId: userGroupId.toString(),
      ip: ctx?.ip,
    });

    await this.emitEvent(ID_CLASSE_SESSION_CREATED, entidadeId, 'auth.session.created', {
      sessionId: criada.chave.toString(),
      userGroupId: userGroupId.toString(),
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
    });

    this.logger.log(`Sessão criada sessionId=${criada.chave} userGroupId=${userGroupId}`);

    return { plaintext, sessionId: criada.chave, familyId };
  }

  // ─── Inspeção (o coração) ────────────────────────────────────────────────

  /**
   * Classifica o refresh token apresentado contra as sessões (+ dual-read).
   *
   * Ordem de resolução — **a sessão sempre vence o slot legado**:
   *
   * 1. Linha de `DTabela` cujo `codigo` OU `metaDados.prevHash` casa com o hash
   *    (inclui as REVOGADAS — é assim que se detecta replay de sessão morta).
   * 2. Não achou? Slot legado em `DUserGroup.dados` → se casar, **materializa a
   *    sessão agora** (migração preguiçosa) e devolve `valid`/`grace`.
   * 3. Não achou nada → `unknown` (401, sem revogar nada — não sabemos de quem é).
   *
   * @param plaintext - Refresh token apresentado
   * @returns Estado + a sessão (quando identificada)
   */
  async inspect(plaintext: string): Promise<SessionInspection> {
    const hash = this.hash(plaintext);

    const session = await this.findByHash(hash);

    if (!session) {
      const legacy = await this.migrateLegacySlot(hash);
      if (legacy) {
        return legacy;
      }
      this.metrics?.increment(
        'auth.session.not_found',
        { reason: 'unknown_hash' },
        { level: 'warn' },
      );
      return { state: 'unknown' };
    }

    // Sessão REVOGADA. Só escala para "derrubar tudo" se ela tiver sido
    // revogada POR REPLAY (RFC 9700 — grant comprometido). Logout normal
    // seguido de um retry atrasado do cliente NÃO pode nukar o usuário.
    if (session.excluido) {
      const porReplay =
        session.meta.revokedReason === 'reuse_detected' ||
        session.meta.revokedReason === 'reuse_escalation';
      return { state: porReplay ? 'reuse_escalation' : 'revoked', session };
    }

    if (session.codigo === hash) {
      return { state: this.isExpired(session.meta) ? 'expired' : 'valid', session };
    }

    // Casou com o prevHash: corrida de abas (benigno) ou replay real?
    const validUntil = Date.parse(session.meta.prevHashValidUntil ?? '');
    const dentroDaGrace = Number.isFinite(validUntil) && Date.now() <= validUntil;

    if (dentroDaGrace) {
      this.metrics?.increment('auth.session.grace_hit', {
        sessionId: session.chave.toString(),
      });
      return { state: 'grace', session };
    }

    return { state: 'replay', session };
  }

  /** Sessão expirou por idle OU pelo teto absoluto? */
  private isExpired(meta: SessionMeta): boolean {
    const agora = Date.now();
    const idle = Date.parse(meta.idleExpiresAt);
    const absoluta = Date.parse(meta.absoluteExpiresAt);
    if (Number.isFinite(idle) && idle < agora) return true;
    if (Number.isFinite(absoluta) && absoluta < agora) return true;
    return false;
  }

  /**
   * Busca a sessão por hash — corrente OU anterior (grace), ATIVA ou REVOGADA.
   *
   * SQL cru **de propósito**: casa exatamente com os índices da migration
   * (`DTabela_idClasse_codigo_idx` e `DTabela_session_prev_hash_idx`) e evita a
   * ambiguidade do filtro Json do Prisma (que já se mostrou não-confiável neste
   * projeto — ver o fallback `cas_fallback` em `RefreshTokenService.rotateFrom`).
   * Determinismo importa mais aqui do que açúcar de ORM: é o caminho de auth.
   *
   * `ORDER BY excluido ASC` → a sessão ATIVA vence a revogada em caso de empate.
   */
  private async findByHash(hash: string): Promise<SessionRow | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        chave: bigint;
        codigo: string | null;
        nome: string;
        descricao: string | null;
        dEntidadeId: bigint | null;
        excluido: boolean;
        metaDados: unknown;
      }>
    >(Prisma.sql`
      SELECT "chave", "codigo", "nome", "descricao", "dEntidadeId", "excluido", "metaDados"
        FROM "DTabela"
       WHERE "idClasse" = ${ID_CLASSE_SESSION}
         AND ("codigo" = ${hash} OR ("metaDados" ->> 'prevHash') = ${hash})
       ORDER BY "excluido" ASC, "chave" DESC
       LIMIT 1
    `);

    const row = rows[0];
    if (!row) return null;

    return {
      chave: row.chave,
      codigo: row.codigo ?? '',
      familyId: row.nome,
      entidadeId: row.dEntidadeId,
      deviceLabel: row.descricao,
      excluido: row.excluido,
      meta: (row.metaDados as SessionMeta | null) ?? ({} as SessionMeta),
    };
  }

  // ─── Dual-read: migração preguiçosa do slot legado ───────────────────────

  /**
   * **A peça que garante ZERO LOGOUT no deploy** (§7 — risco nº 1).
   *
   * Um usuário que já estava logado quando a F3 subiu tem refresh token
   * **apenas** no slot legado (`DUserGroup.dados.refreshTokenHash`) — nenhuma
   * linha em `DTabela`. Sem este fallback, o primeiro refresh dele daria
   * `unknown` → 401 → **logout em massa no deploy**.
   *
   * Aqui: se o hash bater com o slot legado (corrente **ou** `prevHash` dentro
   * da grace), a sessão é **materializada naquele instante** com o mesmo
   * `codigo`, e o fluxo segue como se ela sempre tivesse existido. Em ≤ 7 dias
   * (validade do refresh) toda a base terá migrado sozinha, sem intervenção.
   *
   * A busca é **INDEXADA** (`DUserGroup_legacy_refresh_hash_idx` /
   * `..._prev_hash_idx`) — não é o full scan `take: 1000` que morreu na 3.7.
   *
   * @param hash - sha256 do token apresentado
   * @returns Inspeção já resolvida (`valid`/`grace`) ou `null` se não é legado
   */
  private async migrateLegacySlot(hash: string): Promise<SessionInspection | null> {
    const rows = await this.prisma.$queryRaw<Array<{ chave: bigint; dados: unknown }>>(Prisma.sql`
      SELECT "chave", "dados"
        FROM "DUserGroup"
       WHERE "excluido" = false
         AND "ativo" = true
         AND (("dados" ->> 'refreshTokenHash') = ${hash} OR ("dados" ->> 'prevHash') = ${hash})
       LIMIT 1
    `);

    const row = rows[0];
    if (!row) return null;

    const dados = (row.dados as Record<string, unknown> | null) ?? {};
    const corrente =
      typeof dados.refreshTokenHash === 'string' ? dados.refreshTokenHash : undefined;
    const ehCorrente = corrente === hash;

    // Casou pelo prevHash legado: só vale DENTRO da grace (senão é replay).
    if (!ehCorrente) {
      const validUntil = Date.parse(String(dados.prevHashValidUntil ?? ''));
      if (!Number.isFinite(validUntil) || Date.now() > validUntil) {
        this.metrics?.increment(
          'auth.refresh.legacy_slot_hit',
          { stage: 'prev_hash_outside_grace' },
          { level: 'warn' },
        );
        // Fora da grace e sem sessão: é replay de um token legado já rotacionado.
        // Não temos família para revogar (o slot já foi sobrescrito) → 401 seco.
        return { state: 'unknown' };
      }
    }

    const userGroupId = row.chave;
    const entidadeId = await this.resolveEntidadeId(userGroupId);
    const agora = Date.now();

    // Preserva a expiração legada quando existe (não estende sessão velha de
    // graça); o teto absoluto passa a contar a partir da emissão original
    // conhecida — na ausência dela, de agora (conservador: nunca alonga).
    const expiraLegado = Date.parse(String(dados.refreshTokenExpiresAt ?? ''));
    const idleExpiresAt = Number.isFinite(expiraLegado)
      ? new Date(expiraLegado).toISOString()
      : new Date(agora + this.diasEmMs(this.getIdleDays())).toISOString();

    const meta: SessionMeta = {
      userGroupId: userGroupId.toString(),
      jti: randomUUID(),
      issuedAt: new Date(agora).toISOString(),
      idleExpiresAt,
      absoluteExpiresAt: new Date(agora + this.diasEmMs(this.getAbsoluteDays())).toISOString(),
      lastUsedAt: new Date(agora).toISOString(),
      ...(ehCorrente
        ? {}
        : {
            prevHash: hash,
            prevHashValidUntil: String(dados.prevHashValidUntil ?? ''),
          }),
    };

    const criada = await this.prisma.dTabela.create({
      data: {
        idClasse: ID_CLASSE_SESSION,
        // Se casou pelo prevHash legado, o `codigo` (corrente) é o hash legado
        // corrente — assim a cadeia continua consistente após a rotação.
        codigo: corrente ?? hash,
        nome: randomUUID(),
        descricao: 'Sessão migrada do slot legado (F1)',
        ...(entidadeId !== null && { dEntidadeId: entidadeId }),
        metaDados: meta as unknown as Prisma.InputJsonValue,
      },
      select: { chave: true, codigo: true, nome: true, descricao: true, excluido: true },
    });

    this.metrics?.increment('auth.refresh.legacy_slot_hit', {
      stage: ehCorrente ? 'current' : 'prev_hash_in_grace',
      userGroupId: userGroupId.toString(),
    });
    this.logger.log(
      `Sessão materializada do slot legado (migração preguiçosa) ` +
        `sessionId=${criada.chave} userGroupId=${userGroupId}`,
    );

    const session: SessionRow = {
      chave: criada.chave,
      codigo: criada.codigo ?? '',
      familyId: criada.nome,
      entidadeId,
      deviceLabel: criada.descricao,
      excluido: false,
      meta,
    };

    return {
      state: ehCorrente ? (this.isExpired(meta) ? 'expired' : 'valid') : 'grace',
      session,
      migratedFromLegacy: true,
    };
  }

  // ─── Rotação ─────────────────────────────────────────────────────────────

  /**
   * Rotaciona o refresh token DA SESSÃO (compare-and-swap sobre `codigo`).
   *
   * O `codigo` anterior vira `metaDados.prevHash`, válido pela janela de grace
   * — é o que faz a corrida de duas abas do MESMO device ser benigna. Renova o
   * idle; **NUNCA** estende o teto absoluto.
   *
   * O CAS (`where codigo = esperado`) protege contra duas rotações concorrentes
   * em réplicas diferentes: quem perde re-lê e rotaciona a partir do novo
   * corrente. **Ninguém é revogado por perder a corrida** — disponibilidade
   * acima de otimização (o pior caso é uma rotação a mais).
   *
   * @param session - Sessão inspecionada
   * @param ctx - ip / user-agent (atualiza o device label e a telemetria)
   * @returns Novo refresh token plaintext
   */
  async rotate(session: SessionRow, ctx?: SessionContext): Promise<string> {
    const userGroupId = BigInt(session.meta.userGroupId);

    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      const esperado =
        tentativa === 0 ? session.codigo : (await this.reload(session.chave))?.codigo;
      if (esperado === undefined) break;

      const plaintext = randomBytes(64).toString('hex');
      const agora = Date.now();
      const meta: SessionMeta = {
        ...session.meta,
        jti: randomUUID(),
        prevHash: esperado,
        prevHashValidUntil: new Date(agora + this.getGraceMs()).toISOString(),
        idleExpiresAt: new Date(agora + this.diasEmMs(this.getIdleDays())).toISOString(),
        lastUsedAt: new Date(agora).toISOString(),
        ...(ctx?.ip && { ip: ctx.ip }),
        ...(ctx?.userAgent && { userAgent: ctx.userAgent }),
      };

      const { count } = await this.prisma.dTabela.updateMany({
        where: { chave: session.chave, codigo: esperado, excluido: false },
        data: {
          codigo: this.hash(plaintext),
          metaDados: meta as unknown as Prisma.InputJsonValue,
        },
      });

      if (count > 0) {
        // Dual-write: mantém o slot legado apontando para o token vigente mais
        // recente → desligar `SESSIONS_V2_ENABLED` não desloga ninguém.
        await this.refreshTokenService.mirrorLegacySlot(userGroupId, plaintext, esperado);
        return plaintext;
      }

      this.metrics?.increment('auth.session.cas_retry', {
        sessionId: session.chave.toString(),
        attempt: tentativa + 1,
      });
    }

    // 3 perdas seguidas (ou sessão sumiu no meio): rotação incondicional.
    // Nunca deixamos o usuário sem token por causa de contenção.
    const plaintext = randomBytes(64).toString('hex');
    const agora = Date.now();
    const meta: SessionMeta = {
      ...session.meta,
      jti: randomUUID(),
      prevHash: session.codigo,
      prevHashValidUntil: new Date(agora + this.getGraceMs()).toISOString(),
      idleExpiresAt: new Date(agora + this.diasEmMs(this.getIdleDays())).toISOString(),
      lastUsedAt: new Date(agora).toISOString(),
    };
    await this.prisma.dTabela.update({
      where: { chave: session.chave },
      data: {
        codigo: this.hash(plaintext),
        metaDados: meta as unknown as Prisma.InputJsonValue,
      },
    });
    await this.refreshTokenService.mirrorLegacySlot(userGroupId, plaintext, session.codigo);
    this.logger.warn(`Rotação incondicional após 3 perdas de CAS sessionId=${session.chave}`);
    return plaintext;
  }

  /** Re-lê a sessão (usado no retry do CAS). */
  private async reload(sessionId: bigint): Promise<SessionRow | null> {
    const row = await this.prisma.dTabela.findFirst({
      where: { chave: sessionId, idClasse: ID_CLASSE_SESSION, excluido: false },
      select: {
        chave: true,
        codigo: true,
        nome: true,
        descricao: true,
        dEntidadeId: true,
        excluido: true,
        metaDados: true,
      },
    });
    if (!row) return null;
    return {
      chave: row.chave,
      codigo: row.codigo ?? '',
      familyId: row.nome,
      entidadeId: row.dEntidadeId,
      deviceLabel: row.descricao,
      excluido: row.excluido,
      meta: (row.metaDados as SessionMeta | null) ?? ({} as SessionMeta),
    };
  }

  // ─── Revogação ───────────────────────────────────────────────────────────

  /**
   * Revoga UMA sessão (soft-delete + carimbo de motivo).
   *
   * As demais sessões do usuário **continuam válidas** — é o requisito de
   * "revogar o notebook sem derrubar o celular" (OWASP ASVS).
   *
   * @param sessionId - Chave da linha de DTabela
   * @param reason - Motivo (telemetria/forense; não muda comportamento)
   * @returns `true` se revogou (era ativa), `false` se já estava revogada
   */
  async revokeSession(sessionId: bigint, reason: SessionRevokeReason): Promise<boolean> {
    const session = await this.reload(sessionId);
    if (!session) return false;

    const meta: SessionMeta = {
      ...session.meta,
      revokedAt: new Date().toISOString(),
      revokedReason: reason,
    };

    const { count } = await this.prisma.dTabela.updateMany({
      where: { chave: sessionId, idClasse: ID_CLASSE_SESSION, excluido: false },
      data: { excluido: true, metaDados: meta as unknown as Prisma.InputJsonValue },
    });

    if (count === 0) return false;

    this.metrics?.increment('auth.session.revoked', {
      sessionId: sessionId.toString(),
      reason,
    });
    await this.emitEvent(ID_CLASSE_SESSION_REVOKED, session.entidadeId, 'auth.session.revoked', {
      sessionId: sessionId.toString(),
      reason,
    });

    return true;
  }

  /**
   * Revoga a FAMÍLIA da sessão (RFC 9700 — revogar o *grant*, não a conta).
   *
   * Chamado no replay REAL. **Este é o castigo proporcional**: derruba a cadeia
   * de tokens comprometida e **deixa os outros devices do usuário em paz** —
   * antes da F3, o mesmo evento revogava tudo (e quase sempre era falso positivo).
   *
   * @param session - Sessão em que o replay foi detectado
   * @param telemetry - Dimensões já montadas (ip/ua)
   * @returns Quantidade de sessões revogadas
   */
  async revokeFamily(
    session: SessionRow,
    telemetry: Record<string, string | undefined> = {},
  ): Promise<number> {
    const meta: SessionMeta = {
      ...session.meta,
      revokedAt: new Date().toISOString(),
      revokedReason: 'reuse_detected',
    };

    const { count } = await this.prisma.dTabela.updateMany({
      where: { idClasse: ID_CLASSE_SESSION, nome: session.familyId, excluido: false },
      data: { excluido: true, metaDados: meta as unknown as Prisma.InputJsonValue },
    });

    this.logger.warn(
      `REPLAY REAL — família revogada familyId=${session.familyId} sessões=${count} ` +
        `userGroupId=${session.meta.userGroupId}`,
    );
    this.metrics?.increment(
      'auth.refresh.reuse_detected',
      { ...telemetry, familyId: session.familyId, revoked: count },
      { level: 'warn' },
    );

    await this.emitEvent(
      ID_CLASSE_SECURITY_REUSE_DETECTED,
      session.entidadeId,
      'auth.refresh.reuse_detected',
      {
        action: 'SECURITY_REFRESH_REUSE_DETECTED',
        familyId: session.familyId,
        sessionId: session.chave.toString(),
        userGroupId: session.meta.userGroupId,
        revokedSessions: count,
        ip: telemetry.ip ?? null,
        userAgent: telemetry.ua ?? null,
      },
    );

    return count;
  }

  /**
   * Revoga TODAS as sessões do usuário (escalação RFC 9700 / troca de senha).
   *
   * Cenário de segurança: alguém apresentou um token de uma sessão **já revogada
   * por replay**. Isso não é corrida de aba — é credencial vazada circulando.
   * Aqui, e **só** aqui, o castigo é a conta inteira.
   *
   * @param entidadeId - DEntidade (-150) do usuário
   * @param reason - Motivo
   * @param telemetry - Dimensões (ip/ua)
   * @returns Quantidade de sessões revogadas
   */
  async revokeAllForUser(
    entidadeId: bigint,
    reason: SessionRevokeReason,
    telemetry: Record<string, string | undefined> = {},
  ): Promise<number> {
    const ativas = await this.prisma.dTabela.findMany({
      where: { idClasse: ID_CLASSE_SESSION, dEntidadeId: entidadeId, excluido: false },
      select: { chave: true, metaDados: true },
    });

    if (ativas.length === 0) return 0;

    const agora = new Date().toISOString();

    // 1 UPDATE por linha porque o carimbo (`revokedAt`/`revokedReason`) precisa
    // preservar o `metaDados` de CADA sessão. É O(sessões do usuário) — teto 10
    // pelo cap LRU, e só roda em evento raro (escalação/troca de senha).
    // ZERO N+1 no caminho quente: nenhum refresh normal passa por aqui.
    await this.prisma.$transaction(
      ativas.map((s) =>
        this.prisma.dTabela.update({
          where: { chave: s.chave },
          data: {
            excluido: true,
            metaDados: {
              ...((s.metaDados as SessionMeta | null) ?? {}),
              revokedAt: agora,
              revokedReason: reason,
            } as unknown as Prisma.InputJsonValue,
          },
        }),
      ),
    );

    this.logger.warn(
      `TODAS as sessões revogadas entidadeId=${entidadeId} reason=${reason} total=${ativas.length}`,
    );
    this.metrics?.increment(
      'auth.refresh.revoke_all',
      { ...telemetry, entidadeId: entidadeId.toString(), reason, revoked: ativas.length },
      { level: 'warn' },
    );

    if (reason === 'reuse_escalation') {
      await this.emitEvent(
        ID_CLASSE_SECURITY_ALL_SESSIONS_REVOKED,
        entidadeId,
        'auth.session.all_revoked',
        {
          action: 'SECURITY_ALL_SESSIONS_REVOKED',
          reason,
          revokedSessions: ativas.length,
          ip: telemetry.ip ?? null,
          userAgent: telemetry.ua ?? null,
        },
      );
    }

    return ativas.length;
  }

  // ─── Enumeração / política ───────────────────────────────────────────────

  /**
   * Lista as sessões ATIVAS do usuário (mais recentemente usadas primeiro).
   *
   * Projeção SEGURA: o caller nunca recebe `codigo` nem `prevHash` — é a
   * fonte do `GET /auth/sessions` (OWASP ASVS: sessões devem ser enumeráveis
   * e termináveis individualmente).
   *
   * @param entidadeId - DEntidade (-150) do usuário
   * @returns Sessões ativas (1 query — ZERO N+1)
   */
  async listSessions(entidadeId: bigint): Promise<SessionRow[]> {
    const rows = await this.prisma.dTabela.findMany({
      where: { idClasse: ID_CLASSE_SESSION, dEntidadeId: entidadeId, excluido: false },
      select: {
        chave: true,
        codigo: true,
        nome: true,
        descricao: true,
        dEntidadeId: true,
        excluido: true,
        metaDados: true,
      },
      orderBy: { chave: 'desc' },
    });

    return rows
      .map((row) => ({
        chave: row.chave,
        codigo: row.codigo ?? '',
        familyId: row.nome,
        entidadeId: row.dEntidadeId,
        deviceLabel: row.descricao,
        excluido: row.excluido,
        meta: (row.metaDados as SessionMeta | null) ?? ({} as SessionMeta),
      }))
      .sort((a, b) => Date.parse(b.meta.lastUsedAt ?? '') - Date.parse(a.meta.lastUsedAt ?? ''));
  }

  /**
   * Aplica o cap de sessões por usuário com evicção **LRU** (`lastUsedAt`).
   *
   * Política explícita (OWASP Session Management Cheat Sheet: sessões
   * concorrentes são legítimas, mas a política precisa ser **declarada**, nunca
   * acidental). Default: 10 sessões; a 11ª evicta a mais antiga.
   *
   * @param entidadeId - DEntidade (-150) do usuário
   */
  private async evictOldestIfOverCap(entidadeId: bigint): Promise<void> {
    const max = this.getMaxSessions();
    const ativas = await this.listSessions(entidadeId);
    if (ativas.length < max) return;

    // `listSessions` já vem ordenada por lastUsedAt DESC → a cauda é a mais velha.
    const excedente = ativas.slice(max - 1);
    for (const sessao of excedente) {
      await this.revokeSession(sessao.chave, 'evicted_lru');
    }
    this.metrics?.increment('auth.session.evicted', {
      entidadeId: entidadeId.toString(),
      evicted: excedente.length,
    });
  }

  /**
   * Purga sessões expiradas (idle OU absoluta) — soft-delete em lote.
   *
   * Roda no cron do {@link SessionPurgeService}. Uma única UPDATE (sem N+1);
   * `jsonb_set` preserva o `metaDados` existente e carimba o motivo.
   *
   * @returns Quantidade de sessões purgadas
   */
  async purgeExpired(): Promise<number> {
    const agora = new Date().toISOString();

    const purgadas = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "DTabela"
         SET "excluido" = true,
             "metaDados" = jsonb_set(
               jsonb_set(
                 COALESCE("metaDados", '{}'::jsonb),
                 '{revokedAt}', to_jsonb(${agora}::text), true
               ),
               '{revokedReason}', '"expired"'::jsonb, true
             )
       WHERE "idClasse" = ${ID_CLASSE_SESSION}
         AND "excluido" = false
         AND (
              ("metaDados" ->> 'idleExpiresAt')::timestamptz < now()
           OR ("metaDados" ->> 'absoluteExpiresAt')::timestamptz < now()
         )
    `);

    if (purgadas > 0) {
      this.logger.log(`Purga de sessões expiradas: ${purgadas} revogada(s)`);
      this.metrics?.increment('auth.session.purged', { count: purgadas });
    }

    return purgadas;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** DEntidade (-150) do DUserGroup — dona das sessões (listagem/revoke). */
  private async resolveEntidadeId(userGroupId: bigint): Promise<bigint | null> {
    const entidade = await this.prisma.dEntidade.findFirst({
      where: { dUserGroupId: userGroupId, idClasse: ID_CLASSE_USER, excluido: false },
      select: { chave: true },
    });
    return entidade?.chave ?? null;
  }

  /** Rótulo legível do device (nunca credencial — só o UA truncado). */
  private deviceLabel(ctx?: SessionContext): string {
    const ua = ctx?.userAgent?.trim();
    if (!ua || ua === 'unknown') return 'Dispositivo desconhecido';
    return ua.slice(0, 120);
  }

  /**
   * Emite DEvento de sessão APÓS a persistência (padrão canônico).
   *
   * Auditoria NUNCA pode mascarar a operação que já ocorreu → try/catch mudo
   * com log de erro. Sem `entidadeId` (usuário sem DEntidade -150), não emite.
   */
  private async emitEvent(
    idClasse: bigint,
    entidadeId: bigint | null,
    descricao: string,
    metaDados: Record<string, unknown>,
  ): Promise<void> {
    if (entidadeId === null) return;

    try {
      await this.prisma.dEvento.create({
        data: {
          idClasse,
          idEntidade: entidadeId,
          descricao,
          metaDados: metaDados as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(`Falha ao emitir DEvento ${descricao}: ${(err as Error).message}`);
    }
  }
}
