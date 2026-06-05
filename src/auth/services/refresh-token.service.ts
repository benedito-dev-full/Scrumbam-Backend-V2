import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

/**
 * Default de validade do refresh token (em dias) quando
 * `REFRESH_TOKEN_EXPIRY_DAYS` está ausente ou inválida.
 */
const DEFAULT_REFRESH_TOKEN_EXPIRY_DAYS = 7;

/**
 * Resultado da validação de um refresh token.
 *
 * - `'valid'`   — hash bate E o token não expirou por idade.
 * - `'expired'` — hash bate MAS passou de `refreshTokenExpiresAt`
 *                 (ou é registro legado sem carimbo). Caso BENIGNO:
 *                 401 normal pedindo re-login, NÃO é ataque.
 * - `'invalid'` — hash NÃO bate. Caso SUSPEITO: reuse-detection
 *                 (o AuthService revoga todas as sessões).
 */
export type RefreshTokenValidation = 'valid' | 'expired' | 'invalid';

/**
 * Service para geração, validação e rotação de refresh tokens.
 *
 * Implementa rotação estrita (ADR-V2-003, Decisão D3):
 * - Cada uso gera novo token e invalida o anterior
 * - Reuse detectado (hash não bate) → revogação imediata de todas as sessões
 *
 * Implementa também expiração por TEMPO (idade):
 * - `generate()` carimba `refreshTokenExpiresAt` (now + N dias)
 * - `validate()` distingue 3 estados ('valid' | 'expired' | 'invalid')
 * - N dias vem de `REFRESH_TOKEN_EXPIRY_DAYS` (default 7)
 *
 * Armazenamento: hash SHA-256 em DUserGroup.dados.refreshTokenHash +
 * timestamp ISO em DUserGroup.dados.refreshTokenExpiresAt.
 * Nunca o plaintext é armazenado no banco.
 *
 * @see AuthService — usa este service no fluxo de login/refresh
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Lê a validade configurada do refresh token (em dias).
   *
   * Lê `REFRESH_TOKEN_EXPIRY_DAYS`, valida (inteiro > 0 e finito) e,
   * se ausente ou inválida, retorna o default ({@link DEFAULT_REFRESH_TOKEN_EXPIRY_DAYS}).
   * Valor inválido (não-default por ausência) gera um `warn`.
   *
   * @returns Número de dias de validade do refresh token
   */
  private getExpiryDays(): number {
    const raw = this.config.get<string>('REFRESH_TOKEN_EXPIRY_DAYS');

    if (raw === undefined || raw === null || raw === '') {
      return DEFAULT_REFRESH_TOKEN_EXPIRY_DAYS;
    }

    // Aceita SOMENTE inteiro positivo puro. `parseInt('7abc')` devolveria 7
    // silenciosamente (mascarando misconfiguration) — por isso validamos o
    // formato antes de converter.
    const value = String(raw).trim();
    if (!/^\d+$/.test(value)) {
      this.logger.warn(
        `REFRESH_TOKEN_EXPIRY_DAYS inválido ("${value}") — usando default ${DEFAULT_REFRESH_TOKEN_EXPIRY_DAYS} dias`,
      );
      return DEFAULT_REFRESH_TOKEN_EXPIRY_DAYS;
    }

    const parsed = parseInt(value, 10);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.logger.warn(
        `REFRESH_TOKEN_EXPIRY_DAYS inválido ("${value}") — usando default ${DEFAULT_REFRESH_TOKEN_EXPIRY_DAYS} dias`,
      );
      return DEFAULT_REFRESH_TOKEN_EXPIRY_DAYS;
    }

    return parsed;
  }

  /**
   * Gera novo refresh token para um usuário.
   *
   * Cria token aleatório (64 bytes hex), salva hash + carimbo de expiração
   * no banco, retorna plaintext para inclusão no response.
   *
   * O carimbo `refreshTokenExpiresAt` = now + N dias (N de
   * `REFRESH_TOKEN_EXPIRY_DAYS`, default 7) é gravado como ISO string.
   * Demais campos de `dados` são preservados (spread).
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @returns Token plaintext (nunca armazenado)
   */
  async generate(userGroupId: bigint): Promise<string> {
    const plaintext = randomBytes(64).toString('hex');
    const hash = createHash('sha256').update(plaintext).digest('hex');

    const expiryDays = this.getExpiryDays();
    const expiresAt = new Date(
      Date.now() + expiryDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const userGroup = await this.prisma.dUserGroup.findUnique({
      where: { chave: userGroupId },
      select: { dados: true },
    });

    const dadosAtuais = (userGroup?.dados as Record<string, unknown>) ?? {};

    await this.prisma.dUserGroup.update({
      where: { chave: userGroupId },
      data: {
        dados: {
          ...dadosAtuais,
          refreshTokenHash: hash,
          refreshTokenExpiresAt: expiresAt,
        } as Prisma.InputJsonValue,
      },
    });

    return plaintext;
  }

  /**
   * Valida refresh token em texto plano, distinguindo 3 estados.
   *
   * Compara hash SHA-256 com o armazenado em DUserGroup.dados.refreshTokenHash
   * e verifica a expiração por idade via DUserGroup.dados.refreshTokenExpiresAt.
   *
   * Estados retornados:
   * - `'invalid'` — hash NÃO bate (reuse-detection: caller revoga tudo).
   * - `'expired'` — hash bate, mas o token passou da validade OU é registro
   *                 legado sem carimbo (`refreshTokenExpiresAt` ausente).
   *                 Caminho seguro: força re-login benigno, sem revogar.
   * - `'valid'`   — hash bate e não expirou.
   *
   * @param plaintext - Token em texto plano
   * @param userGroupId - Chave BigInt do DUserGroup
   * @returns `'valid'` | `'expired'` | `'invalid'`
   */
  async validate(
    plaintext: string,
    userGroupId: bigint,
  ): Promise<RefreshTokenValidation> {
    const hash = createHash('sha256').update(plaintext).digest('hex');

    const userGroup = await this.prisma.dUserGroup.findUnique({
      where: { chave: userGroupId },
      select: { dados: true },
    });

    const dados = userGroup?.dados as Record<string, unknown> | null;

    if (dados?.refreshTokenHash !== hash) {
      return 'invalid';
    }

    const expiresAtRaw = dados?.refreshTokenExpiresAt;

    // Registro legado (pré-feature) sem carimbo → trata como expirado.
    // Caminho seguro: força re-login, NÃO revoga, NÃO quebra.
    if (typeof expiresAtRaw !== 'string' || expiresAtRaw === '') {
      return 'expired';
    }

    if (new Date(expiresAtRaw).getTime() < Date.now()) {
      return 'expired';
    }

    return 'valid';
  }

  /**
   * Rotaciona refresh token: invalida o anterior e gera novo.
   *
   * Implementa rotação estrita para detecção de reuse attack.
   * O novo carimbo `refreshTokenExpiresAt` é gravado por `generate()`.
   * Deve ser chamado dentro de transaction no AuthService.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @returns Novo token plaintext
   */
  async rotate(userGroupId: bigint): Promise<string> {
    this.logger.debug(`Rotacionando refresh token userGroupId=${userGroupId}`);
    // generate já sobrescreve hash + expiresAt anteriores (rotação implícita)
    return this.generate(userGroupId);
  }

  /**
   * Revoga refresh token (limpa hash e carimbo de expiração do banco).
   *
   * Chamado no logout e na detecção de reuse attack.
   * Remove tanto `refreshTokenHash` quanto `refreshTokenExpiresAt`,
   * preservando os demais campos de `dados`.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   */
  async revoke(userGroupId: bigint): Promise<void> {
    this.logger.debug(`Revogando refresh token userGroupId=${userGroupId}`);

    const userGroup = await this.prisma.dUserGroup.findUnique({
      where: { chave: userGroupId },
      select: { dados: true },
    });

    const dadosAtuais = (userGroup?.dados as Record<string, unknown>) ?? {};
    const {
      refreshTokenHash: _removedHash,
      refreshTokenExpiresAt: _removedExpiresAt,
      ...dadosSemToken
    } = dadosAtuais;
    void _removedHash;
    void _removedExpiresAt;

    await this.prisma.dUserGroup.update({
      where: { chave: userGroupId },
      data: {
        dados: dadosSemToken as Prisma.InputJsonValue,
      },
    });
  }
}
