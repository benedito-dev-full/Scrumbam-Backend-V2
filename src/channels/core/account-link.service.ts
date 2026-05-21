import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * Service de resolucao de vinculo canal-usuario.
 *
 * Resolve o userId (DEntidade.chave) a partir de um chatId externo e nome de canal.
 * Utilizado pelo MessageRouterService antes de rotear qualquer mensagem inbound.
 *
 * Armazenamento: DVincula -483 (CHANNEL_LINK) com `metaDados.channelName`
 * e `metaDados.chatId`. O campo `idLocEscritu` do DVincula armazena
 * `DEntidade.chave` do usuario.
 *
 * IMPORTANTE: `idLocEscritu` SEMPRE aponta para DEntidade.chave, nao
 * DUserGroup.chave. O pareamento correto e feito pelo PairingService via
 * EntidadeService.getEntidadeIdFromUserGroup.
 *
 * @see PairingService - cria/atualiza o DVincula -483
 */
@Injectable()
export class AccountLinkService {
  private readonly logger = new Logger(AccountLinkService.name);

  /** idClasse do DVincula para vinculo canal-usuario. */
  private static readonly CHANNEL_LINK_CLASS = BigInt(-483);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve o userId a partir de um chatId externo e nome de canal.
   *
   * Executa uma unica query em DVincula e filtra `channelName` + `chatId`
   * diretamente no JSONB `metaDados` via Prisma JSON path.
   *
   * @param channelName - Nome do canal, por exemplo `telegram`
   * @param chatId - ID do chat no canal externo
   * @returns DEntidade.chave do usuario, ou null se nao encontrado
   */
  async findByChat(channelName: string, chatId: bigint): Promise<bigint | null> {
    const link = await this.prisma.dVincula.findFirst({
      where: {
        idClasse: AccountLinkService.CHANNEL_LINK_CLASS,
        excluido: false,
        AND: [
          { metaDados: { path: ['channelName'], equals: channelName } },
          { metaDados: { path: ['chatId'], equals: chatId.toString() } },
        ],
      },
      select: {
        chave: true,
        idLocEscritu: true,
      },
    });

    if (!link || !link.idLocEscritu) {
      this.logger.debug(`Vinculo nao encontrado para channel=${channelName} chatId=${chatId}`);
      return null;
    }

    return link.idLocEscritu;
  }

  /**
   * Resolve o chatId externo a partir de um userId (DEntidade.chave) e nome de canal.
   *
   * Query inversa de `findByChat`. Usada por `TelegramNotificationConsumer`
   * (F9c, ADR-V2-049) para descobrir o `chatId` de cada destinatário antes
   * de chamar `telegram.sendMessage`. Se o usuário não pareou o canal,
   * retorna `null` — o consumer faz skip silencioso (não é erro).
   *
   * Mesma topologia do `findByChat`:
   *  - `DVincula idClasse=-483` (CHANNEL_LINK)
   *  - `idLocEscritu = userEntidadeId` (DEntidade.chave do usuário)
   *  - `metaDados.channelName` filtra o canal
   *  - `metaDados.chatId` é a string a retornar (parse para BigInt).
   *
   * @param channelName - Nome do canal (ex: `'telegram'`).
   * @param userEntidadeId - Chave BigInt do `DEntidade` do usuário.
   * @returns ChatId do canal como BigInt, ou `null` se não houver vínculo.
   *
   * @example
   * ```typescript
   * const chatId = await service.findChatByUser('telegram', BigInt(42));
   * if (chatId) {
   *   await telegram.sendMessage(chatId, 'Fase concluída!');
   * }
   * ```
   */
  async findChatByUser(channelName: string, userEntidadeId: bigint): Promise<bigint | null> {
    const link = await this.prisma.dVincula.findFirst({
      where: {
        idClasse: AccountLinkService.CHANNEL_LINK_CLASS,
        excluido: false,
        idLocEscritu: userEntidadeId,
        AND: [{ metaDados: { path: ['channelName'], equals: channelName } }],
      },
      select: { metaDados: true },
    });

    if (!link) {
      this.logger.debug(`Chat nao encontrado para channel=${channelName} userId=${userEntidadeId}`);
      return null;
    }

    const meta = (link.metaDados as Record<string, unknown> | null) ?? null;
    const rawChatId = meta?.['chatId'];

    if (typeof rawChatId !== 'string' || !/^-?\d+$/.test(rawChatId)) {
      this.logger.warn(
        `chatId invalido em vinculo channel=${channelName} userId=${userEntidadeId}`,
      );
      return null;
    }

    return BigInt(rawChatId);
  }
}
