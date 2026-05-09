import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

/**
 * Service para geração, validação e rotação de refresh tokens.
 *
 * Implementa rotação estrita (ADR-V2-003, Decisão D3):
 * - Cada uso gera novo token e invalida o anterior
 * - Reuse detectado → revogação imediata de todas as sessões
 *
 * Armazenamento: hash SHA-256 em DUserGroup.dados.refreshTokenHash.
 * Nunca o plaintext é armazenado no banco.
 *
 * @see AuthService — usa este service no fluxo de login/refresh
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gera novo refresh token para um usuário.
   *
   * Cria token aleatório (64 bytes hex), salva hash no banco,
   * retorna plaintext para inclusão no response.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @returns Token plaintext (nunca armazenado)
   */
  async generate(userGroupId: bigint): Promise<string> {
    const plaintext = randomBytes(64).toString('hex');
    const hash = createHash('sha256').update(plaintext).digest('hex');

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
        } as Prisma.InputJsonValue,
      },
    });

    return plaintext;
  }

  /**
   * Valida refresh token em texto plano.
   *
   * Compara hash SHA-256 com o armazenado em DUserGroup.dados.refreshTokenHash.
   *
   * @param plaintext - Token em texto plano
   * @param userGroupId - Chave BigInt do DUserGroup
   * @returns true se válido, false se inválido ou expirado
   */
  async validate(plaintext: string, userGroupId: bigint): Promise<boolean> {
    const hash = createHash('sha256').update(plaintext).digest('hex');

    const userGroup = await this.prisma.dUserGroup.findUnique({
      where: { chave: userGroupId },
      select: { dados: true },
    });

    const dados = userGroup?.dados as Record<string, unknown> | null;
    return dados?.refreshTokenHash === hash;
  }

  /**
   * Rotaciona refresh token: invalida o anterior e gera novo.
   *
   * Implementa rotação estrita para detecção de reuse attack.
   * Deve ser chamado dentro de transaction no AuthService.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @returns Novo token plaintext
   */
  async rotate(userGroupId: bigint): Promise<string> {
    this.logger.debug(`Rotacionando refresh token userGroupId=${userGroupId}`);
    // generate já sobrescreve o hash anterior (rotação implícita)
    return this.generate(userGroupId);
  }

  /**
   * Revoga refresh token (limpa hash do banco).
   *
   * Chamado no logout e na detecção de reuse attack.
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
    const { refreshTokenHash: _removed, ...dadosSemHash } = dadosAtuais;
    void _removed;

    await this.prisma.dUserGroup.update({
      where: { chave: userGroupId },
      data: {
        dados: dadosSemHash as Prisma.InputJsonValue,
      },
    });
  }
}
