import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { MetricsService } from '../../common/observability/metrics.service';

/**
 * Default de validade do refresh token (em dias) quando
 * `REFRESH_TOKEN_EXPIRY_DAYS` está ausente ou inválida.
 */
const DEFAULT_REFRESH_TOKEN_EXPIRY_DAYS = 7;

/**
 * Default da janela de tolerância (grace) do token IMEDIATAMENTE anterior,
 * em segundos, quando `AUTH_REFRESH_GRACE_SECONDS` está ausente ou inválida.
 *
 * 60 s é a ordem de grandeza usada pela indústria (Auth0 "refresh token reuse
 * interval", IdentityServer "one-time use with leeway"): grande o bastante para
 * cobrir a corrida entre abas / retry de rede, pequeno o bastante para que um
 * replay real caia FORA dela.
 */
const DEFAULT_GRACE_SECONDS = 60;

/**
 * Resultado da validação de um refresh token (compat — usado por specs legados).
 *
 * - `'valid'`   — hash bate com o slot corrente E não expirou por idade.
 * - `'expired'` — hash bate MAS passou de `refreshTokenExpiresAt` (ou é registro
 *                 legado sem carimbo). Caso BENIGNO: 401 pedindo re-login.
 * - `'invalid'` — hash NÃO bate nem com o slot corrente nem com o `prevHash`
 *                 dentro da grace. Caso SUSPEITO: replay real.
 */
export type RefreshTokenValidation = 'valid' | 'expired' | 'invalid';

/**
 * Estado detalhado de um refresh token apresentado (F1 — grace window).
 *
 * `'grace'` é o estado NOVO e é o coração do hotfix: o token apresentado é o
 * IMEDIATAMENTE anterior e chegou DENTRO da janela de tolerância. Isso é a
 * assinatura de uma **corrida entre abas**, não de um ataque — e hoje é tratado
 * como REUSE ATTACK, revogando a sessão inteira do usuário (o incidente).
 */
export type RefreshTokenState = 'valid' | 'grace' | 'expired' | 'invalid';

/** Inspeção completa do slot de refresh de um DUserGroup. */
export interface RefreshTokenInspection {
  /** Estado do token apresentado. */
  state: RefreshTokenState;
  /**
   * Hash do refresh token CORRENTE no banco no momento da leitura.
   *
   * É o valor esperado no compare-and-swap de {@link RefreshTokenService.rotateFrom}
   * — garante que só rotaciona quem leu o estado que ainda vale.
   */
  currentHash?: string;
}

/** Chaves do slot de refresh dentro de `DUserGroup.dados` (Json — ZERO tabela nova). */
interface RefreshSlot {
  refreshTokenHash?: string;
  refreshTokenExpiresAt?: string;
  /** Hash do token IMEDIATAMENTE anterior (janela de grace). */
  prevHash?: string;
  /** ISO — até quando o `prevHash` é aceito como benigno. */
  prevHashValidUntil?: string;
}

/**
 * Service para geração, validação e rotação de refresh tokens.
 *
 * Implementa rotação com **detecção de replay + janela de grace** (F1 do plano
 * `plan-sessao-auth-hardening.md`; ancoragem: RFC 9700 §4.14.2):
 *
 * - Cada uso gera novo token; o anterior vira `prevHash` com validade de
 *   `AUTH_REFRESH_GRACE_SECONDS` (default 60 s).
 * - Token apresentado == slot corrente → `'valid'` (rotaciona).
 * - Token apresentado == `prevHash` DENTRO da janela → `'grace'` (rotaciona,
 *   **NÃO revoga**). É a corrida de duas abas — benigna.
 * - Token apresentado == `prevHash` FORA da janela, ou desconhecido →
 *   `'invalid'` = **replay REAL** → o AuthService revoga a sessão e emite
 *   evento de segurança. **A detecção NÃO foi removida — ela ganhou precisão.**
 *
 * Também implementa expiração por IDADE (`REFRESH_TOKEN_EXPIRY_DAYS`, default 7).
 *
 * Armazenamento: `DUserGroup.dados` (Json) — ZERO tabela nova (ADR-V2-001).
 * Nunca o plaintext é armazenado.
 *
 * @see AuthService.refresh — orquestra validação → rotação → resposta
 * @see RefreshIdempotencyService — garante UMA rotação por token concorrente
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    // F0 — Observabilidade. `@Optional()`: instrumentação nunca quebra o
    // service (nem em specs que montam o provider com mocks explícitos).
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * Lê um inteiro positivo da env, com default e warn em valor inválido.
   *
   * Aceita SOMENTE inteiro positivo puro — `parseInt('7abc')` devolveria 7
   * silenciosamente (mascarando misconfiguration), por isso o guard de formato.
   *
   * @param key - Nome da variável de ambiente
   * @param fallback - Valor usado quando ausente ou inválida
   * @returns Inteiro validado
   */
  private getPositiveInt(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);

    if (raw === undefined || raw === null || raw === '') {
      return fallback;
    }

    const value = String(raw).trim();
    if (!/^\d+$/.test(value)) {
      this.logger.warn(`${key} inválido ("${value}") — usando default ${fallback}`);
      return fallback;
    }

    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.logger.warn(`${key} inválido ("${value}") — usando default ${fallback}`);
      return fallback;
    }

    return parsed;
  }

  /** Validade do refresh token, em dias (`REFRESH_TOKEN_EXPIRY_DAYS`, default 7). */
  private getExpiryDays(): number {
    return this.getPositiveInt('REFRESH_TOKEN_EXPIRY_DAYS', DEFAULT_REFRESH_TOKEN_EXPIRY_DAYS);
  }

  /**
   * Janela de grace, em milissegundos (`AUTH_REFRESH_GRACE_SECONDS`, default 60).
   *
   * Exposto para o {@link RefreshIdempotencyService} usar o MESMO horizonte no
   * cache de resultado — as duas defesas cobrem exatamente a mesma janela.
   */
  getGraceMs(): number {
    return this.getPositiveInt('AUTH_REFRESH_GRACE_SECONDS', DEFAULT_GRACE_SECONDS) * 1000;
  }

  /** SHA-256 hex do plaintext. */
  private hash(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }

  /** Lê o slot de refresh (Json) de um DUserGroup. */
  private async readSlot(userGroupId: bigint): Promise<RefreshSlot | null> {
    const userGroup = await this.prisma.dUserGroup.findUnique({
      where: { chave: userGroupId },
      select: { dados: true },
    });

    if (!userGroup) {
      return null;
    }

    return ((userGroup.dados as RefreshSlot | null) ?? {}) as RefreshSlot;
  }

  /**
   * Gera novo refresh token para um usuário (sessão NOVA — login/register).
   *
   * Sobrescreve o slot e **limpa** `prevHash`/`prevHashValidUntil`: uma sessão
   * nova não herda a janela de grace da anterior. Demais campos de `dados`
   * (ex.: `mcpKeyHash`) são preservados.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @returns Token plaintext (nunca armazenado)
   */
  async generate(userGroupId: bigint): Promise<string> {
    const plaintext = randomBytes(64).toString('hex');
    const hash = this.hash(plaintext);

    const userGroup = await this.prisma.dUserGroup.findUnique({
      where: { chave: userGroupId },
      select: { dados: true },
    });

    const dadosAtuais = (userGroup?.dados as Record<string, unknown>) ?? {};
    const {
      prevHash: _prevHash,
      prevHashValidUntil: _prevValidUntil,
      ...dadosSemGrace
    } = dadosAtuais;
    void _prevHash;
    void _prevValidUntil;

    await this.prisma.dUserGroup.update({
      where: { chave: userGroupId },
      data: {
        dados: {
          ...dadosSemGrace,
          refreshTokenHash: hash,
          refreshTokenExpiresAt: this.buildExpiresAt(),
        } as Prisma.InputJsonValue,
      },
    });

    return plaintext;
  }

  /**
   * Inspeciona o token apresentado contra o slot corrente + janela de grace.
   *
   * @param plaintext - Token em texto plano
   * @param userGroupId - Chave BigInt do DUserGroup
   * @returns Estado (`valid` | `grace` | `expired` | `invalid`) + hash corrente
   *
   * @example
   * ```typescript
   * const { state, currentHash } = await refreshTokenService.inspect(rt, userGroupId);
   * if (state === 'invalid') { /* replay real → revogar *\/ }
   * ```
   */
  async inspect(plaintext: string, userGroupId: bigint): Promise<RefreshTokenInspection> {
    const hash = this.hash(plaintext);
    const dados = await this.readSlot(userGroupId);

    const currentHash =
      typeof dados?.refreshTokenHash === 'string' ? dados.refreshTokenHash : undefined;
    const telemetria = { userGroupId: userGroupId.toString() };

    // Caso 1 — bate com o slot corrente.
    if (currentHash !== undefined && currentHash === hash) {
      const expirado = this.isExpired(dados?.refreshTokenExpiresAt);
      if (expirado) {
        this.metrics?.increment('auth.refresh.validate', {
          ...telemetria,
          result: 'expired',
          reason: expirado,
        });
        return { state: 'expired', currentHash };
      }

      this.metrics?.increment(
        'auth.refresh.validate',
        { ...telemetria, result: 'valid' },
        { silent: true },
      );
      return { state: 'valid', currentHash };
    }

    // Caso 2 — bate com o token IMEDIATAMENTE anterior, dentro da grace.
    // É a corrida de duas abas. NÃO é ataque. Rotaciona e segue a vida.
    if (typeof dados?.prevHash === 'string' && dados.prevHash === hash) {
      const validUntil = Date.parse(dados.prevHashValidUntil ?? '');
      const dentroDaJanela = Number.isFinite(validUntil) && Date.now() <= validUntil;

      if (dentroDaJanela) {
        this.metrics?.increment('auth.refresh.grace_hit', telemetria);
        return { state: 'grace', currentHash };
      }

      // Fora da janela: o token anterior chegou tarde demais → replay REAL.
      this.metrics?.increment(
        'auth.refresh.validate',
        { ...telemetria, result: 'invalid', reason: 'prev_hash_outside_grace' },
        { level: 'warn' },
      );
      return { state: 'invalid', currentHash };
    }

    // Caso 3 — desconhecido. Ou é replay real, ou a sessão já foi revogada.
    const semSlot = currentHash === undefined;
    this.metrics?.increment(
      'auth.refresh.validate',
      {
        ...telemetria,
        result: 'invalid',
        reason: semSlot ? 'no_slot_stored' : 'unknown_hash',
        slotPresent: !semSlot,
      },
      { level: 'warn' },
    );
    if (semSlot) {
      this.metrics?.increment('auth.refresh.not_found', {
        ...telemetria,
        reason: 'no_slot_stored',
      });
    }

    return { state: 'invalid', currentHash };
  }

  /**
   * Valida refresh token (API legada — 3 estados).
   *
   * Mantida por compatibilidade. `'grace'` é reportado como `'valid'` porque,
   * do ponto de vista de quem só quer saber "posso seguir?", ele é válido.
   * Quem precisa distinguir usa {@link inspect}.
   *
   * @param plaintext - Token em texto plano
   * @param userGroupId - Chave BigInt do DUserGroup
   * @returns `'valid'` | `'expired'` | `'invalid'`
   */
  async validate(plaintext: string, userGroupId: bigint): Promise<RefreshTokenValidation> {
    const { state } = await this.inspect(plaintext, userGroupId);
    return state === 'grace' ? 'valid' : state;
  }

  /**
   * Rotaciona o refresh token com **compare-and-swap** sobre o hash corrente.
   *
   * O UPDATE só se aplica se o slot no banco AINDA for `expectedCurrentHash`.
   * Sem isso, dois refresh concorrentes fariam read-modify-write cegos e o
   * último venceria — deixando o token devolvido ao primeiro cliente órfão
   * (que na volta seria classificado como replay e derrubaria a sessão).
   *
   * O hash anterior vira `prevHash`, válido por {@link getGraceMs}.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @param expectedCurrentHash - Hash que DEVE estar no slot para a troca valer
   * @returns Novo token plaintext, ou `null` se perdeu a corrida (alguém já rotacionou)
   */
  async rotateFrom(userGroupId: bigint, expectedCurrentHash: string): Promise<string | null> {
    const dadosAtuais = await this.readSlot(userGroupId);
    if (!dadosAtuais || dadosAtuais.refreshTokenHash !== expectedCurrentHash) {
      // Alguém rotacionou entre a leitura e agora.
      return null;
    }

    const plaintext = randomBytes(64).toString('hex');
    const novoSlot = {
      ...dadosAtuais,
      refreshTokenHash: this.hash(plaintext),
      refreshTokenExpiresAt: this.buildExpiresAt(),
      prevHash: expectedCurrentHash,
      prevHashValidUntil: new Date(Date.now() + this.getGraceMs()).toISOString(),
    };

    // CAS: só grava se o hash corrente ainda for o esperado.
    const { count } = await this.prisma.dUserGroup.updateMany({
      where: {
        chave: userGroupId,
        dados: { path: ['refreshTokenHash'], equals: expectedCurrentHash },
      },
      data: { dados: novoSlot as Prisma.InputJsonValue },
    });

    if (count === 0) {
      // Ou perdemos a corrida, ou o filtro Json não é efetivo neste banco.
      // Distinguimos relendo: se o slot AINDA é o esperado, o filtro falhou —
      // e nesse caso NÃO podemos deixar o refresh parar de funcionar
      // (disponibilidade > otimização). Grava incondicionalmente e alerta.
      const releitura = await this.readSlot(userGroupId);
      if (releitura?.refreshTokenHash === expectedCurrentHash) {
        this.logger.warn(
          'CAS de rotação não teve efeito com o slot inalterado — filtro Json ineficaz. ' +
            'Gravando incondicionalmente (fail-open).',
        );
        this.metrics?.increment(
          'auth.refresh.cas_fallback',
          { userGroupId: userGroupId.toString() },
          { level: 'warn' },
        );

        await this.prisma.dUserGroup.update({
          where: { chave: userGroupId },
          data: { dados: novoSlot as Prisma.InputJsonValue },
        });
        return plaintext;
      }

      this.metrics?.increment('auth.refresh.cas_lost', {
        userGroupId: userGroupId.toString(),
      });
      return null;
    }

    this.logger.debug(`Refresh token rotacionado userGroupId=${userGroupId}`);
    return plaintext;
  }

  /**
   * Rotaciona o refresh token incondicionalmente (sem CAS).
   *
   * Usado em fluxos onde o token corrente não é apresentado pelo cliente
   * (ex.: `POST /auth/switch-org`, que roda com o access token). O hash anterior
   * também vira `prevHash` — isso protege o refresh token que o cliente tinha em
   * mãos no instante do switch-org de virar falso positivo de replay.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @returns Novo token plaintext
   */
  async rotate(userGroupId: bigint): Promise<string> {
    const dadosAtuais = (await this.readSlot(userGroupId)) ?? {};
    const hashAnterior = dadosAtuais.refreshTokenHash;

    const plaintext = randomBytes(64).toString('hex');

    await this.prisma.dUserGroup.update({
      where: { chave: userGroupId },
      data: {
        dados: {
          ...dadosAtuais,
          refreshTokenHash: this.hash(plaintext),
          refreshTokenExpiresAt: this.buildExpiresAt(),
          ...(hashAnterior
            ? {
                prevHash: hashAnterior,
                prevHashValidUntil: new Date(Date.now() + this.getGraceMs()).toISOString(),
              }
            : {}),
        } as Prisma.InputJsonValue,
      },
    });

    return plaintext;
  }

  /**
   * Revoga o refresh token (limpa slot corrente E janela de grace).
   *
   * Chamado no logout, na troca de senha e na detecção de replay REAL.
   * Preserva os demais campos de `dados` (ex.: `mcpKeyHash`).
   *
   * **Slot único (F1):** revogar aqui derruba a sessão do usuário em TODOS os
   * devices/abas. Por isso o `reason` importa — ele separa a revogação legítima
   * (`logout`, `password_changed`) da revogação por replay (`reuse_detected`).
   * Revogação por sessão individual é a F3 (sessões em DTabela).
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @param reason - Rótulo de telemetria. NÃO altera comportamento.
   */
  async revoke(userGroupId: bigint, reason = 'unspecified'): Promise<void> {
    this.logger.debug(`Revogando refresh token userGroupId=${userGroupId} reason=${reason}`);

    this.metrics?.increment(
      'auth.refresh.revoke',
      { userGroupId: userGroupId.toString(), reason },
      { level: reason === 'reuse_detected' ? 'warn' : 'log' },
    );

    const dadosAtuais = (await this.readSlot(userGroupId)) ?? {};
    const {
      refreshTokenHash: _hash,
      refreshTokenExpiresAt: _expiresAt,
      prevHash: _prevHash,
      prevHashValidUntil: _prevValidUntil,
      ...dadosSemToken
    } = dadosAtuais;
    void _hash;
    void _expiresAt;
    void _prevHash;
    void _prevValidUntil;

    await this.prisma.dUserGroup.update({
      where: { chave: userGroupId },
      data: { dados: dadosSemToken as Prisma.InputJsonValue },
    });
  }

  /**
   * Espelha o hash do token vigente no SLOT LEGADO (**dual-write** — F3, §7).
   *
   * A F3 move a verdade da sessão para `DTabela` (uma linha por sessão). Este
   * método mantém `DUserGroup.dados` populado com a sessão **mais recente** do
   * usuário para que o rollback (`SESSIONS_V2_ENABLED=false`) seja instantâneo
   * e **não desloge ninguém**: ao voltar ao caminho F1, o slot está lá.
   *
   * Semântica do rollback (honesta): o slot é único, então após desligar a flag
   * o usuário mantém **a sessão mais recente**; devices mais antigos precisam
   * refazer login. É a mesma garantia da F1 — nunca pior que o estado anterior.
   *
   * Este slot **não** é lido enquanto a F3 está ligada, exceto na migração
   * preguiçosa ({@link SessionService.inspect}), que só o consulta quando NÃO
   * existe sessão em `DTabela` para o hash apresentado.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @param plaintext - Refresh token recém-emitido (nunca armazenado em claro)
   * @param prevHash - Hash do token imediatamente anterior (janela de grace)
   */
  async mirrorLegacySlot(userGroupId: bigint, plaintext: string, prevHash?: string): Promise<void> {
    const dadosAtuais = (await this.readSlot(userGroupId)) ?? {};

    await this.prisma.dUserGroup.update({
      where: { chave: userGroupId },
      data: {
        dados: {
          ...dadosAtuais,
          refreshTokenHash: this.hash(plaintext),
          refreshTokenExpiresAt: this.buildExpiresAt(),
          ...(prevHash
            ? {
                prevHash,
                prevHashValidUntil: new Date(Date.now() + this.getGraceMs()).toISOString(),
              }
            : {}),
        } as Prisma.InputJsonValue,
      },
    });
  }

  /** Carimbo ISO de expiração por idade (now + N dias). */
  private buildExpiresAt(): string {
    return new Date(Date.now() + this.getExpiryDays() * 24 * 60 * 60 * 1000).toISOString();
  }

  /**
   * Classifica a expiração por idade do slot.
   *
   * @returns `'no_expiry_stamp'` (registro legado), `'age'` (expirou) ou `null`
   */
  private isExpired(expiresAtRaw: unknown): 'no_expiry_stamp' | 'age' | null {
    if (typeof expiresAtRaw !== 'string' || expiresAtRaw === '') {
      // Registro legado (pré-feature) sem carimbo → trata como expirado.
      // Caminho seguro: força re-login, NÃO revoga, NÃO quebra.
      return 'no_expiry_stamp';
    }

    return new Date(expiresAtRaw).getTime() < Date.now() ? 'age' : null;
  }
}
