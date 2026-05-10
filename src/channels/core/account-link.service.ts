import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/** Metadados armazenados em DVincula -483 (CHANNEL_LINK) — campo metaDados. */
interface ChannelLinkMetaDados {
  channelName: string;
  chatId: string; // BigInt serializado como string
  linkedAt: string;
}

/**
 * Serviço de resolução de vínculo canal↔usuário.
 *
 * Resolve o userId (DEntidade.chave) a partir de um chatId externo e nome de canal.
 * Utilizado pelo MessageRouterService antes de rotear qualquer mensagem inbound.
 *
 * Armazenamento: DVincula -483 (CHANNEL_LINK) com `dados.channelName` e `dados.chatId`.
 * O campo `idLocEscritu` do DVincula armazena `DEntidade.chave` do usuário.
 *
 * IMPORTANTE: `idLocEscritu` SEMPRE aponta para DEntidade.chave (não DUserGroup.chave).
 * O pareamento correto é feito pelo PairingService via EntidadeService.getEntidadeIdFromUserGroup.
 *
 * @see PairingService — cria/atualiza o DVincula -483
 */
@Injectable()
export class AccountLinkService {
  private readonly logger = new Logger(AccountLinkService.name);

  /** idClasse do DVincula para vínculo canal↔usuário. */
  private static readonly CHANNEL_LINK_CLASS = BigInt(-483);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve o userId a partir de um chatId externo e nome de canal.
   *
   * Executa uma única query em DVincula — sem N+1.
   * Filtra pelo campo `dados` (JSONB) usando operador `@>`.
   *
   * @param channelName - Nome do canal (ex: 'telegram')
   * @param chatId - ID do chat no canal externo (BigInt)
   * @returns DEntidade.chave do usuário, ou null se não encontrado
   *
   * @example
   * ```typescript
   * const userId = await accountLinkService.findByChat('telegram', BigInt(123456789));
   * if (userId === null) {
   *   // canal não pareado — enviar instruções de pareamento
   * }
   * ```
   */
  async findByChat(channelName: string, chatId: bigint): Promise<bigint | null> {
    // Uma única query — sem N+1
    // Nota: DVincula usa `metaDados` (Json?), não `dados`
    const link = await this.prisma.dVincula.findFirst({
      where: {
        idClasse: AccountLinkService.CHANNEL_LINK_CLASS,
        excluido: false,
        metaDados: {
          path: ['channelName'],
          equals: channelName,
        },
      },
      select: {
        chave: true,
        idLocEscritu: true,
        metaDados: true,
      },
    });

    if (!link || !link.idLocEscritu) {
      this.logger.debug(
        `Vínculo não encontrado para channel=${channelName} chatId=${chatId}`,
      );
      return null;
    }

    // Verificar se o chatId bate (filtro adicional em memória, mas query já foi única)
    const meta = link.metaDados as unknown as ChannelLinkMetaDados;
    if (meta?.chatId !== chatId.toString()) {
      this.logger.debug(
        `chatId não corresponde ao vínculo encontrado: esperado=${chatId} encontrado=${meta?.chatId}`,
      );
      return null;
    }

    return link.idLocEscritu;
  }
}
