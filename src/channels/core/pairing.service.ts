import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma.service';

/** Metadados armazenados no DTabela -474 (PAIRING_TOKEN). */
interface PairingTokenData {
  codeHash: string;
  expiresAt: string; // ISO string
  used: boolean;
  channelHint?: string;
}

/** Metadados armazenados no DVincula -483 (CHANNEL_LINK) — campo metaDados. */
interface ChannelLinkMetaDados {
  channelName: string;
  chatId: string; // BigInt serializado como string
  linkedAt: string; // ISO string
}

/** Parâmetros para consumo do token de pareamento. */
export interface ChannelMeta {
  channelName: string;
  chatId: bigint;
}

/**
 * Serviço de pareamento de canal com conta de usuário.
 *
 * Fluxo de pareamento:
 * 1. Usuário autenticado chama `generate(userId)` → recebe código one-shot
 * 2. Usuário digita o código no canal externo (Telegram)
 * 3. Bot chama `consume(plainCode, channelMeta)` → vincula chatId ao userId
 *
 * Armazenamento canônico (sem tabela nova):
 * - Token: DTabela -474 (PAIRING_TOKEN) com `dados = PairingTokenData`
 * - Vínculo: DVincula -483 (CHANNEL_LINK) com `dados = ChannelLinkData`
 *
 * Segurança:
 * - Código gerado com `crypto.randomBytes` (CSPRNG)
 * - Apenas o hash (SHA-256) é armazenado em banco
 * - One-shot: token marcado como `used=true` na mesma transação do vínculo
 * - TTL configurável via `PAIRING_TOKEN_TTL_MIN` (default: 15 min)
 * - Fail-closed: qualquer erro em `consume` lança UnauthorizedException sem vazar detalhes
 *
 * @see AccountLinkService — consulta DVincula -483 por chatId
 */
@Injectable()
export class PairingService {
  private readonly logger = new Logger(PairingService.name);

  /** idClasse da DTabela para tokens de pareamento. */
  private static readonly PAIRING_TOKEN_CLASS = BigInt(-474);

  /** idClasse do DVincula para vínculo canal↔usuário. */
  private static readonly CHANNEL_LINK_CLASS = BigInt(-483);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Gera um código de pareamento one-shot para o userId informado.
   *
   * Armazena o hash SHA-256 do código em DTabela -474.
   * Retorna o plaintext uma única vez — não pode ser recuperado depois.
   *
   * @param userId - Chave BigInt de DEntidade do usuário (não DUserGroup.chave)
   * @returns Objeto com `code` (plaintext 12 chars) e `expiresAt`
   *
   * @throws {Error} Se houver falha de banco de dados
   *
   * @example
   * ```typescript
   * const { code, expiresAt } = await pairingService.generate(BigInt(userId));
   * // code = 'a1b2c3d4e5f6' (12 chars hex) — retornado uma única vez
   * ```
   */
  async generate(userId: bigint): Promise<{ code: string; expiresAt: Date }> {
    const ttlMin = this.configService.get<number>('PAIRING_TOKEN_TTL_MIN', 15);
    const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000);

    // Gerar código CSPRNG — 6 bytes em hex = 12 chars
    const plainCode = crypto.randomBytes(6).toString('hex');
    const codeHash = crypto.createHash('sha256').update(plainCode).digest('hex');

    const tokenData: PairingTokenData = {
      codeHash,
      expiresAt: expiresAt.toISOString(),
      used: false,
    };

    await this.prisma.dTabela.create({
      data: {
        idClasse: PairingService.PAIRING_TOKEN_CLASS,
        dEntidadeId: userId,
        nome: 'pairing_token',
        // Armazena o hash no campo codigo para permitir WHERE direto no consume()
        // SHA-256 hex = 64 chars, encaixa exatamente no VarChar(64)
        codigo: codeHash,
        dados: tokenData as unknown as import('@prisma/client').Prisma.JsonObject,
        inativo: false,
        excluido: false,
      },
    });

    this.logger.log(`Pairing token gerado para userId=${userId} expiresAt=${expiresAt.toISOString()}`);

    return { code: plainCode, expiresAt };
  }

  /**
   * Consome um código de pareamento e cria/atualiza o vínculo canal↔usuário.
   *
   * Operação atômica via `prisma.$transaction`:
   * 1. Busca token válido (não usado, não expirado) pelo hash do código
   * 2. Marca token como `used=true`
   * 3. Cria ou atualiza DVincula -483 com channelName e chatId
   *
   * Fail-closed: qualquer falha (token inválido, expirado, já usado, erro de banco)
   * lança `UnauthorizedException` sem vazar detalhes sobre o motivo real.
   *
   * @param plainCode - Código plaintext recebido do usuário (12 chars hex)
   * @param channelMeta - Canal e chatId do remetente
   * @returns userId (BigInt = DEntidade.chave) do usuário pareado
   *
   * @throws {UnauthorizedException} Se o código for inválido, expirado ou já usado
   *
   * @example
   * ```typescript
   * const userId = await pairingService.consume('a1b2c3d4e5f6', {
   *   channelName: 'telegram',
   *   chatId: BigInt(123456789),
   * });
   * ```
   */
  async consume(plainCode: string, channelMeta: ChannelMeta): Promise<bigint> {
    const codeHash = crypto.createHash('sha256').update(plainCode).digest('hex');
    const now = new Date();

    try {
      const userId = await this.prisma.$transaction(async (tx) => {
        // Buscar token diretamente pelo hash no campo codigo (O(1) — não scan completo)
        // O hash SHA-256 é armazenado em `codigo` pelo generate() para permitir WHERE direto
        const tokens = await tx.dTabela.findMany({
          where: {
            idClasse: PairingService.PAIRING_TOKEN_CLASS,
            codigo: codeHash,
            excluido: false,
            inativo: false,
          },
          select: {
            chave: true,
            dEntidadeId: true,
            dados: true,
          },
        });

        // Validar TTL e status do único token retornado (hash já filtrado no WHERE)
        const token = tokens.find((t) => {
          const data = t.dados as unknown as PairingTokenData;
          if (!data) return false;
          if (data.used) return false;
          if (new Date(data.expiresAt) <= now) return false;
          return true;
        });

        if (!token || !token.dEntidadeId) {
          throw new UnauthorizedException('Código de pareamento inválido ou expirado');
        }

        const foundUserId = token.dEntidadeId;

        // Marcar token como usado
        const existingData = token.dados as unknown as PairingTokenData;
        await tx.dTabela.update({
          where: { chave: token.chave },
          data: {
            dados: {
              ...existingData,
              used: true,
            } as unknown as import('@prisma/client').Prisma.JsonObject,
          },
        });

        // Criar/atualizar DVincula -483 (CHANNEL_LINK)
        // DVincula usa `metaDados` (não `dados`) — ver schema.prisma
        const linkMetaDados: ChannelLinkMetaDados = {
          channelName: channelMeta.channelName,
          chatId: channelMeta.chatId.toString(),
          linkedAt: now.toISOString(),
        };

        // Verificar se vínculo para este chatId+channel já existe
        const existingLinks = await tx.dVincula.findMany({
          where: {
            idClasse: PairingService.CHANNEL_LINK_CLASS,
            excluido: false,
          },
          select: { chave: true, metaDados: true },
        });

        const existingLink = existingLinks.find((l) => {
          const d = l.metaDados as unknown as ChannelLinkMetaDados;
          return d?.channelName === channelMeta.channelName &&
            d?.chatId === channelMeta.chatId.toString();
        });

        if (existingLink) {
          // Atualizar vínculo existente
          await tx.dVincula.update({
            where: { chave: existingLink.chave },
            data: {
              idLocEscritu: foundUserId,
              metaDados: linkMetaDados as unknown as import('@prisma/client').Prisma.JsonObject,
            },
          });
        } else {
          // Criar novo vínculo
          await tx.dVincula.create({
            data: {
              idClasse: PairingService.CHANNEL_LINK_CLASS,
              idLocEscritu: foundUserId,
              metaDados: linkMetaDados as unknown as import('@prisma/client').Prisma.JsonObject,
              excluido: false,
            },
          });
        }

        return foundUserId;
      });

      this.logger.log(
        `Pareamento concluído: userId=${userId} channel=${channelMeta.channelName} chatId=${channelMeta.chatId}`,
      );

      return userId;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      // Fail-closed: não vazar detalhes do erro interno
      this.logger.warn(
        `Falha ao consumir token de pareamento: ${(error as Error).message}`,
      );
      throw new UnauthorizedException('Código de pareamento inválido ou expirado');
    }
  }
}
