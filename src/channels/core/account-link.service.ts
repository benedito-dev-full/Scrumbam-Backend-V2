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
      this.logger.debug(
        `Vinculo nao encontrado para channel=${channelName} chatId=${chatId}`,
      );
      return null;
    }

    return link.idLocEscritu;
  }
}
