import {
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { MetricsService } from '../common/observability/metrics.service';
import { AUTH_ERROR_CODES } from '../common/errors/error-codes';
import { RefreshTokenService } from './services/refresh-token.service';
import { RefreshIdempotencyService } from './services/refresh-idempotency.service';
import { SessionService, SessionRow } from './services/session.service';
import { SessionResponseDto } from './dto/session-response.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto, AvailableOrgDto, UserProfileDto } from './dto/auth-response.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UserPreferencesDto } from './dto/user-preferences.dto';
// forwardRef para evitar circular dependency AuthModule ↔ OrganizationsModule
import { OrganizationsService } from '../organizations/organizations.service';

/** Bcrypt rounds — NUNCA abaixo de 12 (ADR-V2-003). */
const BCRYPT_ROUNDS = 12;

/**
 * Contexto de request propagado apenas para **telemetria** (F0).
 *
 * NUNCA carrega credencial — só as dimensões permitidas em log (`ip`, `ua`).
 * Opcional em toda assinatura: sem ele, o fluxo é idêntico (só perde a label).
 */
export interface AuthRequestContext {
  ip?: string;
  userAgent?: string;
}

/** idClasses usados no register. */
const ID_CLASSE_USER_GROUP = BigInt(-46);
const ID_CLASSE_USER = BigInt(-150);
const ID_CLASSE_USER_LOGIN_EVENT = BigInt(-501);

/**
 * Service principal de autenticação.
 *
 * Implementa:
 * - register: transaction atômica (DUserGroup + DEntidade + DVincula + DEvento)
 * - login: bcrypt.compare + JWT + refresh token rotativo
 * - refresh: validação + rotação + reuse detection
 * - logout: revogação de refresh token + DEvento
 * - getMe: perfil completo (≤ 3 queries)
 * - updateMe / deleteMe: PATCH/DELETE em DEntidade
 *
 * Pilar 1: ZERO Engine — auth é cadastro estrutural (Prisma direto em transaction).
 * ADR-V2-003: roles via DVincula, nunca coluna `role`.
 *
 * @see RefreshTokenService — gerencia lifecycle do refresh token
 * @see JwtStrategy — valida o access token
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly refreshTokenService: RefreshTokenService,
    // F1 (item 1.2) — serializa refresh concorrente do MESMO token: duas abas
    // recebem o MESMO par de tokens em vez de brigar pela rotação.
    private readonly refreshIdempotency: RefreshIdempotencyService,
    // F3 (ADR-V2-077) — sessões multi-device em DTabela. Enquanto
    // `SESSIONS_V2_ENABLED` estiver ligado, é ele quem manda no refresh; o
    // caminho F1 (slot único) fica como rollback instantâneo via flag.
    private readonly sessions: SessionService,
    @Inject(forwardRef(() => OrganizationsService))
    private readonly organizationsService: OrganizationsService,
    // F0 — Observabilidade. `@Optional()` de propósito: instrumentação NUNCA
    // pode quebrar a construção do service (nem em testes unitários que montam
    // o provider com mocks explícitos). Todo uso é `this.metrics?.increment`.
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * Registra novo usuário e cria organização completa (com Default Team + Issue Counter).
   *
   * Fluxo refatorado (F5 — Opção A aprovada):
   * Transaction 1 (atomica):
   *   1. DUserGroup (-46) — credenciais (bcrypt hash rounds=12)
   *   2. DEntidade (-150) — perfil do usuário
   *   3. DEvento (-501) — audit trail de register
   *
   * Pós-commit: OrganizationsService.create() — transaction separada:
   *   4. DEntidade (-152) — organização
   *   5. DEntidade (-180) — Default Team
   *   6. DTabela (-475) — Issue Counter
   *   7. DVincula (-161) — user é ADMIN da org
   *   8. DVincula (-181) — user é LEAD do Default Team
   *
   * Separar as duas transactions garante que:
   * - Criação de usuário e org são independentes
   * - OrganizationsService permanece canônico (reutilizável via POST /organizations)
   *
   * @param dto - Dados de cadastro
   * @returns AuthResponseDto com JWT + refresh token
   * @throws {ConflictException} Se email já existe
   */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    // Verificar duplicidade antes da transaction
    const existing = await this.prisma.dUserGroup.findFirst({
      where: { usuario: dto.email.toLowerCase() },
      select: { chave: true },
    });
    if (existing) {
      throw new ConflictException('Email já cadastrado');
    }

    const senhaHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const orgNome = dto.organizationName ?? `${dto.name}'s Org`;

    this.logger.log(`Registrando usuário email="${dto.email}"`);

    // Transaction 1: criar usuário (DUserGroup + DEntidade + DEvento)
    const userResult = await this.prisma.$transaction(async (tx) => {
      // 1. Criar DUserGroup (credenciais)
      const userGroup = await tx.dUserGroup.create({
        data: {
          idClasse: ID_CLASSE_USER_GROUP,
          usuario: dto.email.toLowerCase(),
          email: dto.email.toLowerCase(),
          senha: senhaHash,
          nome: dto.name,
          dados: {} as Prisma.InputJsonValue,
        },
      });

      // 2. Criar DEntidade (-150 USER)
      const entidade = await tx.dEntidade.create({
        data: {
          idClasse: ID_CLASSE_USER,
          nome: dto.name,
          email: dto.email.toLowerCase(),
          dUserGroupId: userGroup.chave,
        },
      });

      // 3. DEvento (-501 USER_LOGIN) — audit register
      await tx.dEvento.create({
        data: {
          idClasse: ID_CLASSE_USER_LOGIN_EVENT,
          idEntidade: entidade.chave,
          descricao: 'auth.register',
          metaDados: {
            action: 'register',
            email: dto.email.toLowerCase(),
          } as Prisma.InputJsonValue,
        },
      });

      return { userGroup, entidade };
    });

    // Transaction 2 (via OrganizationsService): criar org completa + default team + memberships
    const org = await this.organizationsService.create(
      { nome: orgNome },
      userResult.entidade.chave,
    );

    const orgIdBigInt = BigInt(org.id);

    // Gerar tokens APÓS persistência bem-sucedida. Sessão primeiro — o `sid`
    // dela entra no access token (F3).
    const { refreshToken, sessionId } = await this.issueRefreshToken(userResult.userGroup.chave);
    const accessToken = this.generateAccessToken(
      userResult.userGroup.chave,
      userResult.entidade.chave,
      orgIdBigInt,
      dto.email.toLowerCase(),
      sessionId,
    );

    return this.buildAuthResponse(
      accessToken,
      refreshToken,
      userResult.userGroup.chave,
      userResult.entidade.chave,
      orgIdBigInt,
      dto.email.toLowerCase(),
      dto.name,
      orgNome,
      'ADMIN',
    );
  }

  /**
   * Autentica usuário com email + senha.
   *
   * Queries: 2 (DUserGroup + DVincula org)
   *
   * @param dto - Credenciais de login
   * @param ctx - ip / user-agent — vira o rótulo do device na sessão (F3)
   * @returns AuthResponseDto com JWT + refresh token
   * @throws {UnauthorizedException} Se credenciais inválidas
   */
  async login(dto: LoginDto, ctx?: AuthRequestContext): Promise<AuthResponseDto> {
    // Query 1: buscar DUserGroup + DEntidade em JOIN
    const userGroup = await this.prisma.dUserGroup.findFirst({
      where: { usuario: dto.email.toLowerCase(), excluido: false, ativo: true },
      include: {
        entidades: {
          where: { idClasse: ID_CLASSE_USER, excluido: false },
          take: 1,
        },
      },
    });

    if (!userGroup) {
      this.logger.debug(`Login falhou: email="${dto.email}" não encontrado`);
      await this.registrarEventoLoginFalhou(null, dto.email);
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const senhaValida = await bcrypt.compare(dto.password, userGroup.senha);
    if (!senhaValida) {
      this.logger.debug(`Login falhou: senha incorreta para email="${dto.email}"`);
      await this.registrarEventoLoginFalhou(userGroup.entidades[0]?.chave ?? null, dto.email);
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const entidade = userGroup.entidades[0];
    if (!entidade) {
      throw new UnauthorizedException('Perfil de usuário não encontrado');
    }

    // Query 2: buscar org role via DVincula
    const orgVinculo = await this.prisma.dVincula.findFirst({
      where: {
        idEntidade: entidade.chave,
        idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
        excluido: false,
      },
      include: {
        locEscritu: { select: { chave: true, nome: true } },
      },
      orderBy: { idClasse: 'asc' }, // -161 (ADMIN) vem primeiro
    });

    // ADR-V2-038 (proposto) — Etapa 3: login órfão destravado.
    //
    // Quando o usuário não tem DVincula -161/-162/-163 ativa (estado órfão —
    // sem workspace), o login agora SUCEDE com JWT sem `organizationId` no
    // payload. O frontend usa `user.isOrphan === true` (alimentado por
    // `/auth/me`) + `availableOrgs: []` para renderizar `<NoWorkspaces />`
    // com CTAs (criar workspace, aceitar convite, logout).
    //
    // Rotas tenant-scoped (`/projects`, `/tasks`, etc.) continuam bloqueadas
    // pelo `RequireWorkspaceGuard` (Etapa 2) com 403 `NO_WORKSPACE`. Apenas
    // rotas marcadas com `@AllowOrphan()` aceitam JWT sem `organizationId`.
    const orgId = orgVinculo?.idLocEscritu;
    const orgNome = orgVinculo?.locEscritu?.nome ?? '';
    const orgRole = this.mapOrgRole(orgVinculo?.idClasse ?? null);

    if (orgId === undefined) {
      this.logger.log(
        `Login órfão (sem workspace): email="${dto.email.toLowerCase()}" entidadeId=${entidade.chave}`,
      );
    }

    // Atualizar ultimoLogin
    await this.prisma.dUserGroup.update({
      where: { chave: userGroup.chave },
      data: { ultimoLogin: new Date() },
    });

    // Audit login (APÓS persistência). `orphan: true` em metaDados quando
    // o usuário logou sem nenhuma workspace ativa — facilita diagnóstico
    // operacional e auditoria de fluxos de onboarding órfão.
    await this.prisma.dEvento.create({
      data: {
        idClasse: ID_CLASSE_USER_LOGIN_EVENT,
        idEntidade: entidade.chave,
        descricao: 'auth.login',
        metaDados: {
          action: 'login',
          email: dto.email.toLowerCase(),
          ...(orgId === undefined && { orphan: true }),
        } as Prisma.InputJsonValue,
      },
    });

    // F3: cria uma sessão NOVA — as sessões dos outros devices deste usuário
    // seguem intactas (antes, este login as APAGAVA: era o bug do slot único).
    const { refreshToken, sessionId } = await this.issueRefreshToken(userGroup.chave, ctx);
    const accessToken = this.generateAccessToken(
      userGroup.chave,
      entidade.chave,
      orgId,
      userGroup.usuario,
      sessionId,
    );

    return this.buildAuthResponse(
      accessToken,
      refreshToken,
      userGroup.chave,
      entidade.chave,
      orgId,
      userGroup.usuario,
      entidade.nome,
      orgNome,
      orgRole,
    );
  }

  /**
   * Renova access token via refresh token (rotação + grace + idempotência).
   *
   * **F1 — hotfix do incidente de sessão** (plano `plan-sessao-auth-hardening.md`,
   * itens 1.1/1.2/1.3). Três defesas, nesta ordem:
   *
   * 1. **Idempotência** ({@link RefreshIdempotencyService}) — dois requests
   *    concorrentes com o MESMO token produzem UMA rotação e recebem a MESMA
   *    resposta. Duas abas → uma única cadeia de tokens.
   * 2. **Janela de grace** (60 s) — um token que era o corrente até agora há
   *    pouco (`prevHash` dentro da janela) é **benigno**: rotaciona, NÃO revoga.
   *    É aqui que o falso positivo morre.
   * 3. **Detecção de replay preservada (RFC 9700)** — token desconhecido, ou
   *    `prevHash` FORA da janela, continua sendo replay REAL: revoga a sessão,
   *    emite `SECURITY_REFRESH_REUSE_DETECTED` (DEvento) e devolve 401. A
   *    segurança não foi trocada por conveniência — ela ganhou precisão.
   *
   * Contadores (F0, reaproveitados): `auth.refresh.attempt` / `.success` /
   * `.grace_hit` / `.idempotent_hit` / `.reuse_detected` / `.revoke_all` /
   * `.expired` / `.user_not_found`. `auth.refresh.revoke_all` é **o contador do
   * sangramento** e deve cair a ~0 depois desta fase.
   *
   * @param refreshTokenPlaintext - Token em texto plano
   * @param userGroupId - Chave BigInt do DUserGroup
   * @param ctx - Contexto do request (ip/userAgent) — usado **só** em telemetria
   * @returns AuthResponseDto com novo par de tokens
   * @throws {UnauthorizedException} `TOKEN_EXPIRED` (sessão velha) |
   *   `SESSION_REUSE_DETECTED` (replay real) | `TOKEN_INVALID` (usuário sumiu)
   */
  async refresh(
    refreshTokenPlaintext: string,
    userGroupId?: bigint,
    ctx?: AuthRequestContext,
  ): Promise<AuthResponseDto> {
    // Idempotência: a corrida de duas abas é resolvida ANTES de tocar o banco.
    return this.refreshIdempotency.run(refreshTokenPlaintext, async () => {
      if (this.sessions.isEnabled()) {
        // F3: o token IDENTIFICA a sessão (lookup indexado). O `userGroupId`
        // vindo do caller vira irrelevante — e com ele morre o full scan.
        return this.executeRefreshV2(refreshTokenPlaintext, ctx);
      }

      // Rollback (SESSIONS_V2_ENABLED=false): caminho F1, slot único.
      const alvo = userGroupId ?? (await this.resolveUserGroupIdByToken(refreshTokenPlaintext));
      return this.executeRefresh(refreshTokenPlaintext, alvo, ctx);
    });
  }

  /**
   * Refresh sobre SESSÕES (F3 — ADR-V2-077). O caminho vigente.
   *
   * Máquina de estados (ver {@link SessionService.inspect}):
   *
   * | estado             | o que aconteceu                          | resposta |
   * |--------------------|------------------------------------------|----------|
   * | `valid`            | token corrente da sessão                 | rotaciona, 200 |
   * | `grace`            | token anterior DENTRO da janela (2 abas) | rotaciona, 200 — **NÃO revoga** |
   * | `expired`          | idle 7 d ou absoluta 30 d venceu         | 401 `TOKEN_EXPIRED` |
   * | `replay`           | token anterior FORA da janela            | revoga a **FAMÍLIA**, 401 `SESSION_REUSE_DETECTED` |
   * | `revoked`          | sessão morta por logout/evicção          | 401 `SESSION_REVOKED` |
   * | `reuse_escalation` | token de sessão já revogada **por replay** | revoga **TODAS** as sessões, 401 `SESSION_REUSE_DETECTED` |
   * | `unknown`          | não casa com nada                        | 401 `TOKEN_INVALID` (nada é revogado) |
   *
   * **A detecção de replay do RFC 9700 continua inteira** — o que mudou é o
   * *alvo* do castigo: a família comprometida, não a conta do usuário. Antes da
   * F3, o mesmo evento derrubava todos os devices — e era quase sempre falso
   * positivo (login em outro device, ver {@link SessionService}).
   *
   * @param refreshTokenPlaintext - Token em texto plano
   * @param ctx - ip / user-agent (telemetria + device label)
   * @throws {UnauthorizedException} Com `code` do catálogo (RFC 9457)
   */
  private async executeRefreshV2(
    refreshTokenPlaintext: string,
    ctx?: AuthRequestContext,
  ): Promise<AuthResponseDto> {
    const telemetryBase = { ip: ctx?.ip, ua: ctx?.userAgent };
    this.metrics?.increment('auth.refresh.attempt', telemetryBase);

    const { state, session } = await this.sessions.inspect(refreshTokenPlaintext);

    if (state === 'unknown' || !session) {
      this.metrics?.increment(
        'auth.refresh.not_found',
        { ...telemetryBase, reason: 'no_session_match' },
        { level: 'warn' },
      );
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.TOKEN_INVALID,
        message: 'Refresh token inválido. Faça login novamente.',
      });
    }

    const userGroupId = BigInt(session.meta.userGroupId);
    const telemetry = { ...telemetryBase, userGroupId: userGroupId.toString() };

    // ESCALAÇÃO (RFC 9700): token de uma sessão que JÁ tinha sido revogada por
    // replay. Não é corrida de aba — é credencial vazada circulando. Só aqui a
    // conta inteira cai.
    if (state === 'reuse_escalation') {
      if (session.entidadeId !== null) {
        await this.sessions.revokeAllForUser(session.entidadeId, 'reuse_escalation', telemetry);
      }
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.SESSION_REUSE_DETECTED,
        message: 'Sessão revogada por segurança. Faça login novamente.',
      });
    }

    // REPLAY REAL (fora da grace): revoga a FAMÍLIA. As OUTRAS sessões do
    // usuário (celular, tablet) continuam válidas — castigo proporcional.
    if (state === 'replay') {
      await this.sessions.revokeFamily(session, telemetry);
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.SESSION_REUSE_DETECTED,
        message: 'Refresh token já utilizado. Faça login novamente.',
      });
    }

    if (state === 'revoked') {
      this.metrics?.increment('auth.refresh.session_revoked', telemetry);
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.SESSION_REVOKED,
        message: 'Sessão encerrada. Faça login novamente.',
      });
    }

    if (state === 'expired') {
      this.metrics?.increment('auth.refresh.expired', telemetry);
      await this.sessions.revokeSession(session.chave, 'expired');
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.TOKEN_EXPIRED,
        message: 'Sessão expirada. Faça login novamente.',
      });
    }

    if (state === 'grace') {
      this.logger.log(
        `Refresh na janela de grace (corrida de abas — benigno) sessionId=${session.chave}`,
      );
    }

    const userGroup = await this.prisma.dUserGroup.findUnique({
      where: { chave: userGroupId },
      include: {
        entidades: { where: { idClasse: ID_CLASSE_USER, excluido: false }, take: 1 },
      },
    });

    const entidade = userGroup?.entidades[0];
    if (!userGroup || !entidade) {
      this.metrics?.increment(
        'auth.refresh.user_not_found',
        { ...telemetry, stage: userGroup ? 'entidade' : 'usergroup' },
        { level: 'warn' },
      );
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.TOKEN_INVALID,
        message: 'Usuário não encontrado',
      });
    }

    // ADR-V2-038 — refresh órfão: sem DVincula ativa, JWT sem organizationId.
    const orgVinculo = await this.prisma.dVincula.findFirst({
      where: {
        idEntidade: entidade.chave,
        idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
        excluido: false,
      },
    });
    const orgId = orgVinculo?.idLocEscritu;
    const orgRole = this.mapOrgRole(orgVinculo?.idClasse ?? null);

    const newRefreshToken = await this.sessions.rotate(session, ctx);

    const accessToken = this.generateAccessToken(
      userGroup.chave,
      entidade.chave,
      orgId,
      userGroup.usuario,
      session.chave,
    );

    this.metrics?.increment('auth.refresh.success', {
      ...telemetry,
      sessionId: session.chave.toString(),
      orphan: orgId === undefined,
      grace: state === 'grace',
    });

    return this.buildAuthResponse(
      accessToken,
      newRefreshToken,
      userGroup.chave,
      entidade.chave,
      orgId,
      userGroup.usuario,
      entidade.nome,
      '',
      orgRole,
    );
  }

  /**
   * Resolve o dono de um refresh token **por índice** (mata o full scan — 3.7).
   *
   * O que existia aqui antes (em `auth.controller.ts:426-446`) era um
   * `findMany({ take: 1000 })` que trazia MIL usuários para a memória do Node e
   * comparava os hashes em JavaScript. Duas consequências: O(n) por refresh, e —
   * pior — acima de 1000 `DUserGroup` ativos o dono legítimo simplesmente **caía
   * fora da janela** e o refresh QUEBRAVA. Bomba-relógio de disponibilidade.
   *
   * Agora: uma query com predicado indexado (`DUserGroup_legacy_refresh_hash_idx`
   * / `..._prev_hash_idx`), `LIMIT 1`, custo constante em qualquer escala.
   *
   * Só é usado no caminho de ROLLBACK (`SESSIONS_V2_ENABLED=false`) — com a F3
   * ligada, quem identifica o dono é a própria sessão.
   *
   * @param plaintext - Refresh token apresentado
   * @returns Chave do DUserGroup dono
   * @throws {UnauthorizedException} `TOKEN_INVALID` se nenhum slot casa
   */
  private async resolveUserGroupIdByToken(plaintext: string): Promise<bigint> {
    const hash = createHash('sha256').update(plaintext).digest('hex');

    const rows = await this.prisma.$queryRaw<Array<{ chave: bigint }>>(Prisma.sql`
      SELECT "chave"
        FROM "DUserGroup"
       WHERE "excluido" = false
         AND "ativo" = true
         AND (("dados" ->> 'refreshTokenHash') = ${hash} OR ("dados" ->> 'prevHash') = ${hash})
       LIMIT 1
    `);

    const dono = rows[0];
    if (!dono) {
      this.metrics?.increment(
        'auth.refresh.not_found',
        { reason: 'no_hash_match' },
        { level: 'warn' },
      );
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.TOKEN_INVALID,
        message: 'Refresh token inválido. Faça login novamente.',
      });
    }

    return dono.chave;
  }

  /**
   * Rotação de verdade — caminho F1 (slot único), usado só em rollback.
   *
   * @param refreshTokenPlaintext - Token em texto plano
   * @param userGroupId - Chave BigInt do DUserGroup
   * @param ctx - Contexto do request (telemetria)
   */
  private async executeRefresh(
    refreshTokenPlaintext: string,
    userGroupId: bigint,
    ctx?: AuthRequestContext,
  ): Promise<AuthResponseDto> {
    const telemetry = {
      userGroupId: userGroupId.toString(),
      ip: ctx?.ip,
      ua: ctx?.userAgent,
    };

    this.metrics?.increment('auth.refresh.attempt', telemetry);

    const inspection = await this.refreshTokenService.inspect(refreshTokenPlaintext, userGroupId);

    if (inspection.state === 'invalid') {
      // REPLAY REAL: o token não é o corrente NEM o anterior dentro da grace.
      // RFC 9700: revogar o grant. Aqui (slot único) isso derruba a sessão —
      // e agora só acontece quando é ataque de verdade, não corrida de abas.
      await this.handleReuseDetected(userGroupId, telemetry);
    }

    if (inspection.state === 'expired') {
      // Expiração benigna por idade (ou registro legado sem carimbo).
      // NÃO é ataque: não revoga, apenas pede re-login.
      this.logger.log(`Refresh token expirado (re-login) userGroupId=${userGroupId}`);
      this.metrics?.increment('auth.refresh.expired', telemetry);
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.TOKEN_EXPIRED,
        message: 'Sessão expirada. Faça login novamente.',
      });
    }

    if (inspection.state === 'grace') {
      // A CORREÇÃO DO INCIDENTE: o token anterior chegou dentro da janela.
      // Antes: REUSE ATTACK → revoke() → CEO deslogado. Agora: rotaciona.
      this.logger.log(
        `Refresh dentro da janela de grace (corrida de abas — benigno) userGroupId=${userGroupId}`,
      );
    }

    const userGroup = await this.prisma.dUserGroup.findUnique({
      where: { chave: userGroupId },
      include: {
        entidades: {
          where: { idClasse: ID_CLASSE_USER, excluido: false },
          take: 1,
        },
      },
    });

    if (!userGroup) {
      this.metrics?.increment(
        'auth.refresh.user_not_found',
        { ...telemetry, stage: 'usergroup' },
        { level: 'warn' },
      );
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.TOKEN_INVALID,
        message: 'Usuário não encontrado',
      });
    }

    const entidade = userGroup.entidades[0];
    if (!entidade) {
      this.metrics?.increment(
        'auth.refresh.user_not_found',
        { ...telemetry, stage: 'entidade' },
        { level: 'warn' },
      );
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.TOKEN_INVALID,
        message: 'Perfil de usuário não encontrado',
      });
    }

    const orgVinculo = await this.prisma.dVincula.findFirst({
      where: {
        idEntidade: entidade.chave,
        idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
        excluido: false,
      },
    });

    // ADR-V2-038 — refresh órfão destravado: quando o usuário perdeu todos os
    // vínculos entre o último access token e este refresh, retornamos JWT sem
    // `organizationId` em vez de 401. O frontend mostra `<NoWorkspaces />`.
    const orgId = orgVinculo?.idLocEscritu;
    const orgRole = this.mapOrgRole(orgVinculo?.idClasse ?? null);

    if (orgId === undefined) {
      this.logger.log(
        `Refresh órfão (sem workspace): userGroupId=${userGroupId} entidadeId=${entidade.chave}`,
      );
    }

    const newRefreshToken = await this.rotateComRetry(userGroupId, inspection.currentHash);

    const accessToken = this.generateAccessToken(
      userGroup.chave,
      entidade.chave,
      orgId,
      userGroup.usuario,
    );

    this.metrics?.increment('auth.refresh.success', {
      ...telemetry,
      orphan: orgId === undefined,
      grace: inspection.state === 'grace',
    });

    return this.buildAuthResponse(
      accessToken,
      newRefreshToken,
      userGroup.chave,
      entidade.chave,
      orgId,
      userGroup.usuario,
      entidade.nome,
      '',
      orgRole,
    );
  }

  /**
   * Rotaciona com compare-and-swap, tolerando perda de corrida entre réplicas.
   *
   * O CAS falha (`null`) quando OUTRO processo rotacionou entre a inspeção e a
   * gravação — cenário possível só em multi-réplica (dentro de um processo, a
   * idempotência já serializou). Nesse caso re-inspecionamos: o hash do banco
   * mudou, então rotacionamos a partir do NOVO corrente. O cliente recebe um
   * token válido e **ninguém é revogado**.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @param expectedHash - Hash corrente lido na inspeção
   * @returns Novo refresh token plaintext
   */
  private async rotateComRetry(
    userGroupId: bigint,
    expectedHash: string | undefined,
  ): Promise<string> {
    let hashEsperado = expectedHash;

    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      if (hashEsperado === undefined) {
        break;
      }

      const plaintext = await this.refreshTokenService.rotateFrom(userGroupId, hashEsperado);
      if (plaintext !== null) {
        return plaintext;
      }

      this.metrics?.increment('auth.refresh.cas_retry', {
        userGroupId: userGroupId.toString(),
        attempt: tentativa + 1,
      });

      const atual = await this.prisma.dUserGroup.findUnique({
        where: { chave: userGroupId },
        select: { dados: true },
      });
      const dados = (atual?.dados as Record<string, unknown> | null) ?? {};
      hashEsperado =
        typeof dados.refreshTokenHash === 'string' ? dados.refreshTokenHash : undefined;
    }

    // Sem slot corrente (sessão revogada no meio do caminho) ou 3 perdas
    // seguidas: rotação incondicional. Disponibilidade acima de otimização —
    // o pior caso aqui é uma rotação a mais, nunca um usuário deslogado.
    return this.refreshTokenService.rotate(userGroupId);
  }

  /**
   * Trata um replay REAL de refresh token (RFC 9700 §4.14.2).
   *
   * Revoga a sessão, contabiliza o sangramento e emite o DEvento de segurança
   * `SECURITY_REFRESH_REUSE_DETECTED` (idClasse -501, a classe de audit de auth —
   * ZERO DClasse nova nesta fase, ADR-V2-001).
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @param telemetry - Dimensões já montadas (userGroupId/ip/ua)
   * @throws {UnauthorizedException} Sempre — `code: SESSION_REUSE_DETECTED`
   */
  private async handleReuseDetected(
    userGroupId: bigint,
    telemetry: Record<string, string | undefined>,
  ): Promise<never> {
    this.logger.warn(`REUSE ATTACK (replay real, fora da grace) userGroupId=${userGroupId}`);
    this.metrics?.increment('auth.refresh.reuse_detected', telemetry, { level: 'warn' });
    this.metrics?.increment(
      'auth.refresh.revoke_all',
      { ...telemetry, reason: 'reuse_detected' },
      { level: 'warn' },
    );

    await this.refreshTokenService.revoke(userGroupId, 'reuse_detected');

    // Evento de segurança APÓS a revogação (persistir → emitir).
    const entidade = await this.prisma.dEntidade.findFirst({
      where: { dUserGroupId: userGroupId, excluido: false },
      select: { chave: true },
    });

    if (entidade) {
      try {
        await this.prisma.dEvento.create({
          data: {
            idClasse: ID_CLASSE_USER_LOGIN_EVENT,
            idEntidade: entidade.chave,
            descricao: 'auth.refresh.reuse_detected',
            metaDados: {
              action: 'SECURITY_REFRESH_REUSE_DETECTED',
              userGroupId: userGroupId.toString(),
              ip: telemetry.ip ?? null,
              userAgent: telemetry.ua ?? null,
            } as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        // Auditoria nunca pode mascarar a revogação (que já ocorreu).
        this.logger.error(`Falha ao registrar evento de reuse: ${(err as Error).message}`);
      }
    }

    throw new UnauthorizedException({
      code: AUTH_ERROR_CODES.SESSION_REUSE_DETECTED,
      message: 'Refresh token inválido ou já utilizado. Faça login novamente.',
    });
  }

  /**
   * Realiza logout — revoga **apenas a sessão deste device** (F3).
   *
   * Antes da F3, logout no celular derrubava o notebook (slot único). Agora,
   * com o claim `sid`, a revogação é cirúrgica. Sem `sid` (token pré-F3), o
   * comportamento degrada para "revoga tudo" — que é o comportamento antigo,
   * seguro por definição.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @param sessionId - Sessão do request (claim `sid`); ausente → revoga todas
   */
  async logout(userGroupId: bigint, sessionId?: bigint): Promise<void> {
    this.logger.log(`Logout userGroupId=${userGroupId} sessionId=${sessionId ?? 'n/a'}`);

    const entidade = await this.prisma.dEntidade.findFirst({
      where: { dUserGroupId: userGroupId, excluido: false },
      select: { chave: true },
    });

    if (this.sessions.isEnabled()) {
      if (sessionId !== undefined) {
        await this.sessions.revokeSession(sessionId, 'logout');
      } else if (entidade) {
        // Token sem `sid` (pré-F3): não dá para saber QUAL sessão é esta.
        // Fail-safe = revogar todas (nunca deixar sessão viva num logout).
        await this.sessions.revokeAllForUser(entidade.chave, 'logout_all');
      }
    }

    // Slot legado sempre limpo — mantém o rollback coerente com o logout.
    // `reason` só rotula a telemetria (F0): logout é revogação LEGÍTIMA e
    // precisa ser separável do `revoke_all` por falso-positivo de reuse.
    await this.refreshTokenService.revoke(userGroupId, 'logout');

    // Audit logout (APÓS persistência)
    if (entidade) {
      await this.prisma.dEvento.create({
        data: {
          idClasse: ID_CLASSE_USER_LOGIN_EVENT,
          idEntidade: entidade.chave,
          descricao: 'auth.logout',
          metaDados: { action: 'logout' } as Prisma.InputJsonValue,
        },
      });
    }
  }

  /**
   * Retorna perfil completo do usuário autenticado (≤ 3 queries).
   *
   * Query 1: DUserGroup + DEntidade (JOIN)
   * Query 2: DVincula org role
   * (Query 3: opcional DEntidade org nome)
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @returns UserProfileDto completo
   * @throws {NotFoundException} Se usuário não encontrado
   */
  async getMe(userGroupId: bigint): Promise<UserProfileDto> {
    // Query 1: DUserGroup + DEntidade em JOIN (N+1 ZERO).
    // `dados: true` selecionado na entidade para extrair `preferences`
    // (E1 — preferências em DEntidade.dados.preferences).
    const userGroup = await this.prisma.dUserGroup.findUnique({
      where: { chave: userGroupId },
      include: {
        entidades: {
          where: { idClasse: ID_CLASSE_USER, excluido: false },
          take: 1,
          select: { chave: true, nome: true, dados: true },
        },
      },
    });

    if (!userGroup || !userGroup.entidades[0]) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const entidade = userGroup.entidades[0];
    const dados = (entidade.dados as Record<string, unknown>) ?? {};
    const preferences = dados.preferences as UserPreferencesDto | undefined;

    // Query 2: TODOS os vinculos ativos do usuario (-161/-162/-163) com nome
    // da org em JOIN. Ordenados ADMIN antes — o primeiro vira a org "default"
    // do perfil (compat com /me legado). availableOrgs[] inclui todos para
    // alimentar o workspace switcher (ADR-V2-030).
    const orgVinculos = await this.prisma.dVincula.findMany({
      where: {
        idEntidade: entidade.chave,
        idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
        excluido: false,
      },
      include: {
        locEscritu: { select: { chave: true, nome: true } },
      },
      orderBy: { idClasse: 'asc' },
    });

    const primary = orgVinculos[0];
    const availableOrgs: AvailableOrgDto[] = orgVinculos
      .filter((v) => v.locEscritu)
      .map((v) => ({
        id: v.idLocEscritu.toString(),
        nome: v.locEscritu!.nome,
        role: (this.mapOrgRole(v.idClasse) ?? 'MEMBER') as 'ADMIN' | 'MEMBER' | 'VIEWER',
      }));

    return {
      id: userGroup.chave.toString(),
      entidadeId: entidade.chave.toString(),
      email: userGroup.usuario,
      name: entidade.nome,
      organizationId: primary?.idLocEscritu?.toString(),
      organizationName: primary?.locEscritu?.nome,
      orgRole: this.mapOrgRole(primary?.idClasse ?? null),
      availableOrgs,
      // ADR-V2-038 (proposto) — Etapa 3: flag de estado órfão.
      // `true` quando user não tem nenhuma DVincula -161/-162/-163 ativa.
      // O frontend usa para renderizar `<NoWorkspaces />` com CTAs.
      isOrphan: availableOrgs.length === 0,
      // E1 — preferências persistidas em DEntidade.dados.preferences.
      // `undefined` quando o usuário ainda não gravou nenhuma preferência
      // (frontend aplica defaults). Outras chaves de `dados`
      // (defaultProjectId etc.) NÃO são expostas aqui — fora de escopo.
      preferences,
    };
  }

  /**
   * Atualiza perfil do usuário autenticado (PATCH semântico).
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @param dto - Campos a atualizar
   * @returns UserProfileDto atualizado
   */
  async updateMe(userGroupId: bigint, dto: UpdateMeDto): Promise<UserProfileDto> {
    const entidade = await this.prisma.dEntidade.findFirst({
      where: { dUserGroupId: userGroupId, excluido: false },
      select: { chave: true, dados: true },
    });

    if (!entidade) {
      throw new NotFoundException('Perfil de usuário não encontrado');
    }

    // Troca de senha: se newPassword vier, currentPassword é obrigatória e
    // validada via bcrypt contra DUserGroup.senha. O hash da nova é calculado
    // ANTES da transaction (bcrypt é CPU-bound — não prolongar lock de DB).
    let novaSenhaHash: string | null = null;
    if (dto.newPassword) {
      if (!dto.currentPassword) {
        throw new UnauthorizedException('Senha atual é obrigatória para trocar a senha');
      }

      const userGroup = await this.prisma.dUserGroup.findUnique({
        where: { chave: userGroupId },
        select: { senha: true },
      });
      if (!userGroup) {
        throw new NotFoundException('Credenciais não encontradas');
      }

      const senhaValida = await bcrypt.compare(dto.currentPassword, userGroup.senha);
      if (!senhaValida) {
        throw new UnauthorizedException('Senha atual incorreta');
      }

      novaSenhaHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    }

    const dadosAtuais = (entidade.dados as Record<string, unknown>) ?? {};
    const prefsAtuais = (dadosAtuais.preferences as Record<string, unknown>) ?? {};

    // Merge por chave de 1º nível em `preferences`: mandar `appearance`
    // substitui o bloco appearance inteiro, sem tocar `locale` ou
    // `notifications`. `undefined` em qualquer sub-bloco = preservar.
    const novasPrefs = dto.preferences;
    const prefsAtualizadas = novasPrefs
      ? {
          ...prefsAtuais,
          ...(novasPrefs.appearance !== undefined && { appearance: novasPrefs.appearance }),
          ...(novasPrefs.locale !== undefined && { locale: novasPrefs.locale }),
          ...(novasPrefs.notifications !== undefined && {
            notifications: novasPrefs.notifications,
          }),
        }
      : prefsAtuais;

    await this.prisma.$transaction(async (tx) => {
      await tx.dEntidade.update({
        where: { chave: entidade.chave },
        data: {
          ...(dto.name !== undefined && { nome: dto.name }),
          ...(dto.email !== undefined && { email: dto.email.toLowerCase() }),
          dados: {
            ...dadosAtuais,
            ...(dto.defaultProjectId !== undefined && { defaultProjectId: dto.defaultProjectId }),
            ...(dto.defaultTeamId !== undefined && { defaultTeamId: dto.defaultTeamId }),
            ...(dto.onboardingCompleted !== undefined && {
              onboardingCompleted: dto.onboardingCompleted,
            }),
            ...(novasPrefs !== undefined && { preferences: prefsAtualizadas }),
          } as Prisma.InputJsonValue,
        },
      });

      // Atualiza DUserGroup quando email (login) e/ou senha mudam.
      const userGroupData: Prisma.DUserGroupUpdateInput = {};
      if (dto.email !== undefined) {
        userGroupData.usuario = dto.email.toLowerCase();
        userGroupData.email = dto.email.toLowerCase();
      }
      if (novaSenhaHash) {
        userGroupData.senha = novaSenhaHash;
      }
      if (Object.keys(userGroupData).length > 0) {
        await tx.dUserGroup.update({
          where: { chave: userGroupId },
          data: userGroupData,
        });
      }
    });

    // Após trocar a senha, revoga o refresh token vigente — invalida sessões
    // antigas, forçando re-login (segurança). Fora da transaction porque
    // revoke() faz sua própria leitura/escrita do DUserGroup.dados.
    if (novaSenhaHash) {
      await this.refreshTokenService.revoke(userGroupId, 'password_changed');
      // F3: troca de senha derruba TODOS os devices — aqui a revogação total é
      // a semântica CORRETA (é o que o usuário espera ao trocar a senha), ao
      // contrário do replay, onde ela era o castigo desproporcional.
      if (this.sessions.isEnabled()) {
        await this.sessions.revokeAllForUser(entidade.chave, 'password_changed');
      }
      this.logger.log(`Senha alterada e sessões revogadas userGroupId=${userGroupId}`);
    }

    return this.getMe(userGroupId);
  }

  // ─── Sessões (F3 — ADR-V2-077 / OWASP ASVS Session Management) ────────────

  /**
   * Lista os dispositivos conectados do usuário (`GET /auth/sessions`).
   *
   * Projeção segura ({@link SessionResponseDto}) — **nunca** devolve o `codigo`
   * (hash do refresh token) nem o `prevHash`. É por isso que a DClasse -485 é
   * denylisted no `/tabelas` genérico: lá ela sairia crua.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @param currentSessionId - Claim `sid` do JWT (marca `current: true`)
   * @returns Sessões ativas, mais recentemente usada primeiro (1 query)
   *
   * @example
   * ```bash
   * curl -H "Authorization: Bearer $JWT" http://localhost:3000/api/v1/auth/sessions
   * ```
   */
  async listSessions(
    userGroupId: bigint,
    currentSessionId?: bigint,
  ): Promise<SessionResponseDto[]> {
    const entidade = await this.prisma.dEntidade.findFirst({
      where: { dUserGroupId: userGroupId, idClasse: ID_CLASSE_USER, excluido: false },
      select: { chave: true },
    });
    if (!entidade) {
      throw new NotFoundException('Perfil de usuário não encontrado');
    }

    const sessoes = await this.sessions.listSessions(entidade.chave);
    return sessoes.map((s) => this.toSessionResponse(s, currentSessionId));
  }

  /**
   * Revoga UMA sessão do usuário (`DELETE /auth/sessions/:id`).
   *
   * Só revoga sessões que **pertencem ao usuário autenticado** — a checagem de
   * posse é feita contra a `DEntidade` dona da linha (nunca confiar no `:id`).
   * Uma sessão de OUTRO usuário responde 404 (anti-enumeração), não 403.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @param sessionId - Sessão alvo
   * @throws {NotFoundException} Se a sessão não existe ou não é do usuário
   */
  async revokeSession(userGroupId: bigint, sessionId: bigint): Promise<void> {
    const entidade = await this.prisma.dEntidade.findFirst({
      where: { dUserGroupId: userGroupId, idClasse: ID_CLASSE_USER, excluido: false },
      select: { chave: true },
    });
    if (!entidade) {
      throw new NotFoundException('Perfil de usuário não encontrado');
    }

    const minhas = await this.sessions.listSessions(entidade.chave);
    const alvo = minhas.find((s) => s.chave === sessionId);
    if (!alvo) {
      throw new NotFoundException(`Sessão ${sessionId} não encontrada`);
    }

    await this.sessions.revokeSession(sessionId, 'revoked_by_user');
    this.logger.log(`Sessão revogada pelo usuário sessionId=${sessionId}`);
  }

  /**
   * "Sair de todos os outros dispositivos" (`DELETE /auth/sessions`).
   *
   * Revoga todas as sessões do usuário **exceto a atual** (claim `sid`). Sem
   * `sid` no token, revoga todas — inclusive a atual (fail-safe: o usuário pediu
   * para sair de tudo; melhor derrubar a mais do que deixar uma viva).
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @param currentSessionId - Sessão a preservar (claim `sid`)
   * @returns Quantidade de sessões revogadas
   */
  async revokeOtherSessions(userGroupId: bigint, currentSessionId?: bigint): Promise<number> {
    const entidade = await this.prisma.dEntidade.findFirst({
      where: { dUserGroupId: userGroupId, idClasse: ID_CLASSE_USER, excluido: false },
      select: { chave: true },
    });
    if (!entidade) {
      throw new NotFoundException('Perfil de usuário não encontrado');
    }

    const minhas = await this.sessions.listSessions(entidade.chave);
    const outras = minhas.filter((s) => s.chave !== currentSessionId);

    for (const sessao of outras) {
      await this.sessions.revokeSession(sessao.chave, 'logout_all');
    }

    this.logger.log(
      `Sair de todos os dispositivos userGroupId=${userGroupId} revogadas=${outras.length}`,
    );
    return outras.length;
  }

  /** Projeção segura de uma sessão (sem hash, sem família, sem jti). */
  private toSessionResponse(session: SessionRow, currentSessionId?: bigint): SessionResponseDto {
    return {
      id: session.chave.toString(),
      device: session.deviceLabel ?? 'Dispositivo desconhecido',
      ip: session.meta.ip ?? null,
      createdAt: session.meta.issuedAt,
      lastUsedAt: session.meta.lastUsedAt,
      expiresAt: session.meta.idleExpiresAt,
      absoluteExpiresAt: session.meta.absoluteExpiresAt,
      current: currentSessionId !== undefined && session.chave === currentSessionId,
    };
  }

  /**
   * Soft-delete do usuário autenticado.
   *
   * Marca DEntidade, DUserGroup e DVincula como excluido=true em transaction.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   */
  async deleteMe(userGroupId: bigint): Promise<void> {
    const entidade = await this.prisma.dEntidade.findFirst({
      where: { dUserGroupId: userGroupId, excluido: false },
      select: { chave: true },
    });

    if (!entidade) {
      throw new NotFoundException('Usuário não encontrado');
    }

    this.logger.log(`Soft-delete usuário entidadeId=${entidade.chave}`);

    await this.prisma.$transaction(async (tx) => {
      await tx.dEntidade.update({ where: { chave: entidade.chave }, data: { excluido: true } });
      await tx.dUserGroup.update({
        where: { chave: userGroupId },
        data: { excluido: true, ativo: false },
      });
      await tx.dVincula.updateMany({
        where: { idEntidade: entidade.chave, excluido: false },
        data: { excluido: true },
      });
    });
  }

  /**
   * Emite par de tokens (access + refresh) para um usuario ja persistido,
   * SEM validar senha. Uso restrito a fluxos pos-cadastro auto-autenticados
   * (ex.: accept de convite — ADR-V2-028).
   *
   * Reusa exatamente o mesmo pipeline do `login()`:
   *  - Resolve org/role via DVincula (-161/-162/-163).
   *  - Gera JWT + refresh token (rotacao estrita).
   *  - Emite `user.login.succeeded` para audit (mesma trilha do login normal).
   *
   * NUNCA deve ser exposto via endpoint publico. Chamado apenas por services
   * confiaveis que ja validaram a identidade por outro mecanismo (token de
   * convite, magic link, etc.).
   *
   * @param userGroupId - Chave BigInt do DUserGroup ja criado/persistido.
   * @returns AuthResponseDto identica a `login()`.
   * @throws {NotFoundException} Se DUserGroup ou DEntidade nao existir.
   *
   * @example
   * ```typescript
   * // Dentro do InvitesService, apos $transaction do accept:
   * const session = await this.authService.issueSessionForUser(newUserGroupId);
   * return { ...session, redirectTo: '/intentions' };
   * ```
   */
  async issueSessionForUser(
    userGroupId: bigint,
    preferredOrgId?: bigint,
  ): Promise<AuthResponseDto> {
    const userGroup = await this.prisma.dUserGroup.findUnique({
      where: { chave: userGroupId },
      include: {
        entidades: {
          where: { idClasse: ID_CLASSE_USER, excluido: false },
          take: 1,
        },
      },
    });

    if (!userGroup) {
      throw new NotFoundException('Usuario nao encontrado');
    }
    const entidade = userGroup.entidades[0];
    if (!entidade) {
      throw new NotFoundException('Perfil de usuario nao encontrado');
    }

    // Se preferredOrgId fornecido (ex: accept de convite merge), priorizar
    // esse vinculo. Senao, comportamento padrao: primeiro vinculo ativo
    // ordenado por idClasse (ADMIN -161 antes de MEMBER/VIEWER).
    const preferred =
      preferredOrgId !== undefined
        ? await this.prisma.dVincula.findFirst({
            where: {
              idEntidade: entidade.chave,
              idLocEscritu: preferredOrgId,
              idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
              excluido: false,
            },
            include: { locEscritu: { select: { chave: true, nome: true } } },
          })
        : null;
    const orgVinculo =
      preferred ??
      (await this.prisma.dVincula.findFirst({
        where: {
          idEntidade: entidade.chave,
          idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
          excluido: false,
        },
        include: { locEscritu: { select: { chave: true, nome: true } } },
        orderBy: { idClasse: 'asc' },
      }));

    // ADR-V2-038 (proposto) — Etapa 3: sessão órfã destravada.
    // Quando `preferredOrgId` não é fornecido e o user não tem nenhuma
    // DVincula ativa (ex: convite cancelado entre invite-flow e accept,
    // ou flow que cria DUserGroup antes da org), emitimos JWT órfão.
    // O caller (ex: InvitesService) decide o redirect — fluxo de criar
    // workspace pode pular o `<NoWorkspaces />` mostrando o wizard direto.
    const orgId = orgVinculo?.idLocEscritu;
    const orgNome = orgVinculo?.locEscritu?.nome ?? '';
    const orgRole = this.mapOrgRole(orgVinculo?.idClasse ?? null);

    if (orgId === undefined) {
      this.logger.log(
        `issueSessionForUser órfão (sem workspace): userGroupId=${userGroupId} entidadeId=${entidade.chave} preferredOrgId=${preferredOrgId ?? 'undefined'}`,
      );
    }

    // F3: convite aceito = sessão nova (não sobrescreve as demais do usuário).
    const { refreshToken, sessionId } = await this.issueRefreshToken(userGroup.chave);
    const accessToken = this.generateAccessToken(
      userGroup.chave,
      entidade.chave,
      orgId,
      userGroup.usuario,
      sessionId,
    );

    return this.buildAuthResponse(
      accessToken,
      refreshToken,
      userGroup.chave,
      entidade.chave,
      orgId,
      userGroup.usuario,
      entidade.nome,
      orgNome,
      orgRole,
    );
  }

  /**
   * Troca a organizacao ativa da sessao (ADR-V2-030).
   *
   * Valida que o usuario tem DVincula ativo na org alvo, emite novo par de
   * tokens (access + refresh rotacionado) com `organizationId` apontando
   * para a org de destino e emite `DEvento -501` com `action='org.switch'`.
   *
   * O refresh token e rotacionado (estrita): tokens antigos sao invalidados.
   * O frontend DEVE atualizar AMBOS os tokens apos a chamada — usar o
   * refresh velho falhara com reuse detection.
   *
   * Race contra membership removida: a propria validacao de DVincula cobre
   * — se admin removeu o user da org alvo entre o GET /auth/me e o POST
   * /auth/switch-org, retorna 403.
   *
   * Queries: 3 (DUserGroup+DEntidade JOIN, DVincula da org alvo, availableOrgs).
   *
   * @param userGroupId - Chave BigInt do DUserGroup (do JWT atual).
   * @param targetOrgId - Chave BigInt da org alvo.
   * @returns AuthResponseDto com tokens novos + perfil com availableOrgs.
   * @throws {NotFoundException} Se usuario nao existe.
   * @throws {ForbiddenException} Se nao tem DVincula ativo na org alvo.
   */
  async switchOrg(
    userGroupId: bigint,
    targetOrgId: bigint,
    sessionId?: bigint,
  ): Promise<AuthResponseDto> {
    // Query 1: DUserGroup + DEntidade (mesmo padrao do login).
    const userGroup = await this.prisma.dUserGroup.findUnique({
      where: { chave: userGroupId },
      include: {
        entidades: {
          where: { idClasse: ID_CLASSE_USER, excluido: false },
          take: 1,
        },
      },
    });
    if (!userGroup) {
      throw new NotFoundException('Usuario nao encontrado');
    }
    const entidade = userGroup.entidades[0];
    if (!entidade) {
      throw new NotFoundException('Perfil de usuario nao encontrado');
    }

    // Query 2: validar DVincula ativo na org alvo (segurança — cobre
    // membership removida entre /me e /switch-org).
    const targetVinculo = await this.prisma.dVincula.findFirst({
      where: {
        idEntidade: entidade.chave,
        idLocEscritu: targetOrgId,
        idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
        excluido: false,
      },
      include: { locEscritu: { select: { chave: true, nome: true } } },
    });
    if (!targetVinculo) {
      throw new ForbiddenException('Voce nao e membro desta organizacao');
    }

    const orgNome = targetVinculo.locEscritu?.nome ?? '';
    const orgRole = this.mapOrgRole(targetVinculo.idClasse);

    // Audit DEvento -501 com action='org.switch'.
    await this.prisma.dEvento.create({
      data: {
        idClasse: ID_CLASSE_USER_LOGIN_EVENT,
        idEntidade: entidade.chave,
        descricao: 'auth.org.switch',
        metaDados: {
          action: 'org.switch',
          toOrgId: targetOrgId.toString(),
          email: userGroup.usuario,
        } as Prisma.InputJsonValue,
      },
    });

    // Emitir novo access token + rotacionar o refresh DESTA sessão (F3).
    //
    // Antes, switch-org chamava `refreshTokenService.rotate(userGroupId)`, que
    // mexia no slot ÚNICO — ou seja, trocar de workspace no notebook invalidava
    // o refresh do celular. Agora a rotação é escopada à sessão do request
    // (claim `sid`). Sem sessão identificável, cai no caminho legado.
    const sessaoAtual =
      this.sessions.isEnabled() && sessionId !== undefined
        ? await this.sessions
            .listSessions(entidade.chave)
            .then((lista) => lista.find((s) => s.chave === sessionId))
        : undefined;

    const newRefreshToken = sessaoAtual
      ? await this.sessions.rotate(sessaoAtual)
      : await this.refreshTokenService.rotate(userGroupId);

    const accessToken = this.generateAccessToken(
      userGroup.chave,
      entidade.chave,
      targetOrgId,
      userGroup.usuario,
      sessaoAtual?.chave,
    );

    this.logger.log(
      `org.switch userGroupId=${userGroupId} entidadeId=${entidade.chave} toOrgId=${targetOrgId}`,
    );

    return this.buildAuthResponse(
      accessToken,
      newRefreshToken,
      userGroup.chave,
      entidade.chave,
      targetOrgId,
      userGroup.usuario,
      entidade.nome,
      orgNome,
      orgRole,
    );
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  /**
   * Gera access token JWT com payload tipado.
   *
   * Campos como string (evita BigInt serialization issues).
   *
   * **Estado órfão (ADR-V2-038, proposto):** quando `orgId === undefined`,
   * o JWT é emitido SEM o campo `organizationId`. Usuário órfão (sem nenhuma
   * DVincula -161/-162/-163 ativa) pode receber JWT válido para acessar
   * apenas rotas marcadas com `@AllowOrphan()` — demais rotas rejeitam com
   * 403 `NO_WORKSPACE` (Etapa 2 do plano orphan-workspace).
   *
   * Até a Etapa 3, este caminho não é exercitado em produção: `login`/`refresh`/
   * `issueSessionForUser` ainda bloqueiam user órfão com 401. O parâmetro
   * `orgId?: bigint` prepara o terreno sem alterar comportamento externo.
   */
  private generateAccessToken(
    userGroupId: bigint,
    entidadeId: bigint,
    orgId: bigint | undefined,
    email: string,
    sessionId?: bigint,
  ): string {
    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN', '900');
    const payload: Record<string, unknown> = {
      sub: userGroupId.toString(),
      entidadeId: entidadeId.toString(),
      email,
      ...(orgId !== undefined && { organizationId: orgId.toString() }),
      // F3 — `sid`: a QUAL sessão este access token pertence. Habilita
      // `current: true` em GET /auth/sessions, logout só-deste-device e
      // "sair de todos os outros". Ausente em tokens pré-F3 (degradação
      // benigna: some o rótulo "este dispositivo" até o próximo refresh).
      ...(sessionId !== undefined && { sid: sessionId.toString() }),
    };
    return this.jwtService.sign(payload, { expiresIn: parseInt(expiresIn, 10) });
  }

  /**
   * Emite um refresh token para uma sessão NOVA (login / register / convite).
   *
   * **É AQUI que o bug do slot único morre.** Com a F3 ligada, cada login cria
   * uma LINHA de sessão própria em `DTabela` — logar no celular **não toca** a
   * sessão do notebook. Antes, `RefreshTokenService.generate()` sobrescrevia o
   * slot único e limpava o `prevHash`: o device anterior era não só deslogado
   * como classificado como REUSE ATTACK no refresh seguinte.
   *
   * Com a flag desligada (`SESSIONS_V2_ENABLED=false`), volta ao caminho F1.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @param ctx - ip / user-agent (device label)
   * @returns Refresh token plaintext + `sessionId` (vira o claim `sid`)
   */
  private async issueRefreshToken(
    userGroupId: bigint,
    ctx?: AuthRequestContext,
  ): Promise<{ refreshToken: string; sessionId?: bigint }> {
    if (!this.sessions.isEnabled()) {
      return { refreshToken: await this.refreshTokenService.generate(userGroupId) };
    }

    const { plaintext, sessionId } = await this.sessions.createSession(userGroupId, ctx);
    return { refreshToken: plaintext, sessionId };
  }

  /**
   * Monta AuthResponseDto padronizado.
   *
   * Se `availableOrgs` for omitido, o helper faz a query para popular a
   * lista (ADR-V2-030). Callers que ja tem essa info em maos podem passar
   * para evitar query duplicada.
   */
  private async buildAuthResponse(
    accessToken: string,
    refreshToken: string,
    userGroupId: bigint,
    entidadeId: bigint,
    orgId: bigint | undefined,
    email: string,
    name: string,
    orgNome: string,
    orgRole?: string | null,
    availableOrgs?: AvailableOrgDto[],
  ): Promise<AuthResponseDto> {
    const expiresIn = parseInt(this.configService.get<string>('JWT_EXPIRES_IN', '900'), 10);

    const orgs = availableOrgs ?? (await this.loadAvailableOrgs(entidadeId));

    return {
      accessToken,
      refreshToken,
      expiresIn,
      tokenType: 'Bearer',
      user: {
        id: userGroupId.toString(),
        entidadeId: entidadeId.toString(),
        email,
        name,
        // Estado órfão (ADR-V2-038 — Etapa 3): quando user não tem DVincula
        // ativa, organizationId/organizationName vêm como undefined e
        // `isOrphan: true` sinaliza ao frontend para renderizar
        // `<NoWorkspaces />`. Apenas rotas marcadas com `@AllowOrphan()`
        // aceitam JWT sem `organizationId` — demais retornam 403 NO_WORKSPACE
        // via RequireWorkspaceGuard.
        organizationId: orgId?.toString(),
        organizationName: orgId !== undefined ? orgNome : undefined,
        orgRole: orgRole ?? undefined,
        availableOrgs: orgs,
        isOrphan: orgs.length === 0,
      },
    };
  }

  /**
   * Lista todas as DVinculas ativas (-161/-162/-163) do usuario.
   *
   * Usado para popular `availableOrgs[]` no AuthResponseDto. 1 query
   * indexada com JOIN para nome da org — ZERO N+1.
   */
  private async loadAvailableOrgs(entidadeId: bigint): Promise<AvailableOrgDto[]> {
    const vinculos = await this.prisma.dVincula.findMany({
      where: {
        idEntidade: entidadeId,
        idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
        excluido: false,
      },
      include: { locEscritu: { select: { chave: true, nome: true } } },
      orderBy: { idClasse: 'asc' },
    });
    return vinculos
      .filter((v) => v.locEscritu)
      .map((v) => ({
        id: v.idLocEscritu.toString(),
        nome: v.locEscritu!.nome,
        role: (this.mapOrgRole(v.idClasse) ?? 'MEMBER') as 'ADMIN' | 'MEMBER' | 'VIEWER',
      }));
  }

  /**
   * Mapeia idClasse DVincula para string de role.
   */
  private mapOrgRole(idClasse: bigint | null): string | undefined {
    if (idClasse === BigInt(-161)) return 'ADMIN';
    if (idClasse === BigInt(-162)) return 'MEMBER';
    if (idClasse === BigInt(-163)) return 'VIEWER';
    return undefined;
  }

  /**
   * Registra DEvento de login falhou (APÓS tentativa).
   */
  private async registrarEventoLoginFalhou(
    entidadeId: bigint | null,
    email: string,
  ): Promise<void> {
    try {
      await this.prisma.dEvento.create({
        data: {
          idClasse: ID_CLASSE_USER_LOGIN_EVENT,
          ...(entidadeId && { idEntidade: entidadeId }),
          descricao: 'auth.failed',
          metaDados: {
            action: 'login_failed',
            email: email.toLowerCase(),
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(`Falha ao registrar evento login_failed: ${(err as Error).message}`);
    }
  }
}
