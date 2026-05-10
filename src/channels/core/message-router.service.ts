import { Injectable, Logger } from '@nestjs/common';
import { InboundMessage } from './channel-adapter.interface';
import { AccountLinkService } from './account-link.service';
import { CommandRegistryService } from './command-registry.service';

/**
 * Handler de intent (mensagem de texto não-comando).
 *
 * Registrado no MessageRouterService para tratar mensagens de texto livre
 * quando nenhum comando slash corresponde.
 *
 * @example
 * ```typescript
 * class CreateTaskFromTextIntent implements IntentHandler {
 *   readonly intentName = 'create_task_from_text';
 *   canHandle(message: InboundMessage): boolean {
 *     return message.type === 'text' && !!message.text;
 *   }
 *   async handle(chatId: bigint, userId: bigint, message: InboundMessage): Promise<void> { ... }
 * }
 * ```
 */
export interface IntentHandler {
  /** Nome identificador do intent. */
  readonly intentName: string;

  /**
   * Verifica se este handler pode processar a mensagem.
   *
   * @param message - Mensagem inbound normalizada
   * @returns true se o handler deve processar
   */
  canHandle(message: InboundMessage): boolean;

  /**
   * Processa a mensagem.
   *
   * @param chatId - chatId do canal externo (BigInt)
   * @param userId - DEntidade.chave do usuário (BigInt)
   * @param message - Mensagem inbound normalizada
   */
  handle(chatId: bigint, userId: bigint, message: InboundMessage): Promise<void>;
}

/**
 * Roteador de mensagens inbound para handlers de comando e intent.
 *
 * Responsabilidades:
 * 1. Resolver userId a partir do chatId via AccountLinkService
 * 2. Se userId=null (canal não pareado): logar e retornar sem processar
 * 3. Se type='command': resolver handler via CommandRegistryService
 * 4. Se type='text'/'voice': tentar intent handlers em ordem de registro
 *
 * NÃO persiste dados — persistência é responsabilidade dos handlers.
 *
 * @see AccountLinkService — resolve userId por chatId
 * @see CommandRegistryService — resolve handler por nome de comando
 */
@Injectable()
export class MessageRouterService {
  private readonly logger = new Logger(MessageRouterService.name);
  private readonly intentHandlers: IntentHandler[] = [];

  constructor(
    private readonly accountLinkService: AccountLinkService,
    private readonly commandRegistry: CommandRegistryService,
  ) {}

  /**
   * Registra um handler de intent.
   *
   * Handlers são tentados em ordem de registro — o primeiro que retornar
   * `canHandle=true` processa a mensagem.
   *
   * @param handler - Handler de intent a registrar
   */
  registerIntentHandler(handler: IntentHandler): void {
    this.intentHandlers.push(handler);
    this.logger.log(`Intent handler registrado: ${handler.intentName}`);
  }

  /**
   * Roteia uma mensagem inbound para o handler correto.
   *
   * Fluxo:
   * 1. Resolve userId via AccountLinkService.findByChat
   * 2. Se null: loga e retorna (canal não pareado)
   * 3. Se type='command': busca e executa CommandHandler
   * 4. Se type='text'/'voice': busca e executa IntentHandler
   *
   * Erros nos handlers são capturados e logados — não propagam para o caller
   * (evita que um handler quebrado derrube o fluxo de webhook).
   *
   * @param channelName - Nome do canal (ex: 'telegram')
   * @param message - Mensagem inbound normalizada
   *
   * @example
   * ```typescript
   * await messageRouter.handleInbound('telegram', {
   *   chatId: BigInt(123456789),
   *   type: 'command',
   *   commandName: 'tasks',
   *   commandArgs: ['today'],
   * });
   * ```
   */
  async handleInbound(channelName: string, message: InboundMessage): Promise<void> {
    // Passo 1: Resolver userId
    const userId = await this.accountLinkService.findByChat(channelName, message.chatId);

    if (userId === null) {
      this.logger.debug(
        `Mensagem de canal não pareado ignorada: channel=${channelName} chatId=${message.chatId} type=${message.type}`,
      );
      return;
    }

    // Passo 2: Rotear por tipo
    if (message.type === 'command') {
      await this.handleCommand(message, userId);
    } else {
      await this.handleIntent(message, userId);
    }
  }

  /**
   * Roteia para handler de comando slash.
   */
  private async handleCommand(message: InboundMessage, userId: bigint): Promise<void> {
    const commandName = message.commandName ?? '';
    const handler = this.commandRegistry.resolve(commandName);

    if (!handler) {
      this.logger.debug(`Comando não registrado: /${commandName}`);
      return;
    }

    try {
      await handler.handle(message.chatId, userId, message.commandArgs ?? []);
    } catch (error) {
      this.logger.error(
        `Erro ao executar comando /${commandName}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Roteia para handler de intent (texto livre ou voz).
   */
  private async handleIntent(message: InboundMessage, userId: bigint): Promise<void> {
    const handler = this.intentHandlers.find((h) => h.canHandle(message));

    if (!handler) {
      this.logger.debug(
        `Nenhum intent handler para message type=${message.type} chatId=${message.chatId}`,
      );
      return;
    }

    try {
      await handler.handle(message.chatId, userId, message);
    } catch (error) {
      this.logger.error(
        `Erro ao executar intent handler ${handler.intentName}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
