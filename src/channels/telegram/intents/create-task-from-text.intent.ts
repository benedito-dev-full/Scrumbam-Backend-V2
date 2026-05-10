import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UserProjectService } from '../../../projects/user-project.service';
import { InboundMessage } from '../../core/channel-adapter.interface';
import {
  IntentHandler,
  MessageRouterService,
} from '../../core/message-router.service';
import { TasksService } from '../../../tasks/tasks.service';
import { TelegramSendService } from '../telegram-send.service';

/**
 * Intent handler para criacao de task a partir de texto livre.
 *
 * Usa o texto da mensagem como titulo e delega a criacao para `TasksService`.
 * O projeto padrao vem de `UserProjectService`, sem fallback global inseguro.
 */
@Injectable()
export class CreateTaskFromTextIntent implements OnModuleInit, IntentHandler {
  private readonly logger = new Logger(CreateTaskFromTextIntent.name);

  /** Nome identificador do intent. */
  readonly intentName = 'create_task_from_text';

  constructor(
    private readonly messageRouterService: MessageRouterService,
    private readonly tasksService: TasksService,
    private readonly telegramSend: TelegramSendService,
    private readonly userProjectService: UserProjectService,
  ) {}

  onModuleInit(): void {
    this.messageRouterService.registerIntentHandler(this);
    this.logger.log('CreateTaskFromTextIntent registrado');
  }

  canHandle(message: InboundMessage): boolean {
    return message.type === 'text' && typeof message.text === 'string' && message.text.length > 0;
  }

  /**
   * Cria uma task a partir do texto livre recebido.
   *
   * @param chatId - chatId do canal externo
   * @param userId - DEntidade.chave do usuario
   * @param message - Mensagem inbound com texto livre
   */
  async handle(chatId: bigint, userId: bigint, message: InboundMessage): Promise<void> {
    const texto = message.text?.trim() ?? '';
    this.logger.debug(
      `CreateTaskFromTextIntent: chatId=${chatId} userId=${userId} text="${texto.slice(0, 50)}"`,
    );

    if (texto.length < 3) {
      await this.telegramSend.sendMessage(
        chatId,
        `âŒ Mensagem muito curta para criar uma tarefa (mÃ­nimo: 3 caracteres).\n\n` +
          `Tente: \`Revisar documentaÃ§Ã£o da API\``,
      );
      return;
    }

    if (texto.length > 512) {
      await this.telegramSend.sendMessage(
        chatId,
        `âŒ Mensagem muito longa para usar como tÃ­tulo de tarefa (mÃ¡ximo: 512 caracteres).\n\n` +
          `Use \`/create <tÃ­tulo resumido>\` para tÃ­tulos longos.`,
      );
      return;
    }

    const projectId = await this.userProjectService.getDefaultProject(userId);

    if (!projectId) {
      await this.telegramSend.sendMessage(
        chatId,
        `âŒ *Nenhum projeto encontrado.*\n\n` +
          `Para criar tarefas via Telegram, vocÃª precisa ter um projeto no Scrumban.\n` +
          `Acesse o painel web para criar um projeto primeiro.`,
      );
      return;
    }

    try {
      const task = await this.tasksService.create(
        {
          nome: texto,
          projectId: projectId.toString(),
          source: 'telegram',
          rawText: texto,
          assigneeId: userId.toString(),
        },
        userId,
      );

      this.logger.log(
        `Task criada via texto livre: id=${task.id} identifier=${task.identifier} userId=${userId}`,
      );

      const identifier = task.identifier ? `[${task.identifier}] ` : '';
      await this.telegramSend.sendMessage(
        chatId,
        `âœ… *Tarefa criada!*\n\n${identifier}${task.nome}\nStatus: ðŸ“¥ INBOX`,
      );
    } catch (error) {
      this.logger.error(
        `Erro ao criar task via texto livre para userId=${userId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.telegramSend.sendMessage(
        chatId,
        `âŒ NÃ£o foi possÃ­vel criar a tarefa. Tente novamente em instantes.`,
      );
    }
  }
}
