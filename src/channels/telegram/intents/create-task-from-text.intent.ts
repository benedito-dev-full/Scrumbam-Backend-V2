import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { InboundMessage } from '../../core/channel-adapter.interface';
import {
  IntentHandler,
  MessageRouterService,
} from '../../core/message-router.service';
import { TasksService } from '../../../tasks/tasks.service';
import { TelegramSendService } from '../telegram-send.service';

/**
 * Intent handler para criação de task a partir de texto livre.
 *
 * Ativado quando o usuário envia uma mensagem de texto não-comando
 * no Telegram após o pareamento.
 *
 * Comportamento:
 * - `canHandle`: retorna true apenas para mensagens do tipo 'text' com texto presente
 *   (não para 'command' nem 'voice')
 * - `handle`: usa o texto como título da task e delega ao `TasksService.create`
 *
 * O projeto padrão é determinado buscando o DProject mais recente onde
 * o usuário é criador (idCreator = userId). Se nenhum projeto encontrado,
 * envia instrução para criar um projeto no painel web.
 *
 * `userId` é `DEntidade.chave` — garantido pelo router antes de chegar aqui.
 *
 * NOTA: Textos muito curtos (<3 chars) ou muito longos (>512 chars) são
 * rejeitados com mensagem de orientação — sem criar task inválida.
 *
 * @see TasksService — criação com identifier atômico e estado INBOX
 * @see TelegramSendService — envio de resposta ao usuário
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
    private readonly prisma: PrismaService,
  ) {}

  /** Autorregistra este intent handler no router ao inicializar o módulo. */
  onModuleInit(): void {
    this.messageRouterService.registerIntentHandler(this);
    this.logger.log('CreateTaskFromTextIntent registrado');
  }

  /**
   * Verifica se este handler pode processar a mensagem.
   *
   * Retorna true apenas para mensagens do tipo 'text' com texto presente
   * e não-comando (comandos têm type='command' e são roteados separadamente).
   *
   * @param message - Mensagem inbound normalizada
   * @returns true se deve processar (texto livre, não-comando)
   */
  canHandle(message: InboundMessage): boolean {
    return message.type === 'text' && typeof message.text === 'string' && message.text.length > 0;
  }

  /**
   * Cria uma task a partir do texto livre recebido.
   *
   * Usa o texto da mensagem como título da task.
   * Delega criação ao `TasksService.create` sem duplicar lógica.
   *
   * @param chatId - chatId do canal externo (BigInt)
   * @param userId - DEntidade.chave do usuário (BigInt) — já resolvido pelo router
   * @param message - Mensagem inbound com o texto livre
   */
  async handle(chatId: bigint, userId: bigint, message: InboundMessage): Promise<void> {
    const texto = message.text?.trim() ?? '';
    this.logger.debug(
      `CreateTaskFromTextIntent: chatId=${chatId} userId=${userId} text="${texto.slice(0, 50)}"`,
    );

    if (texto.length < 3) {
      await this.telegramSend.sendMessage(
        chatId,
        `❌ Mensagem muito curta para criar uma tarefa (mínimo: 3 caracteres).\n\n` +
        `Tente: \`Revisar documentação da API\``,
      );
      return;
    }

    if (texto.length > 512) {
      await this.telegramSend.sendMessage(
        chatId,
        `❌ Mensagem muito longa para usar como título de tarefa (máximo: 512 caracteres).\n\n` +
        `Use \`/create <título resumido>\` para títulos longos.`,
      );
      return;
    }

    const projectId = await this.resolveDefaultProjectId(userId);

    if (!projectId) {
      await this.telegramSend.sendMessage(
        chatId,
        `❌ *Nenhum projeto encontrado.*\n\n` +
        `Para criar tarefas via Telegram, você precisa ter um projeto no Scrumban.\n` +
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
        `✅ *Tarefa criada!*\n\n${identifier}${task.nome}\nStatus: 📥 INBOX`,
      );
    } catch (error) {
      this.logger.error(
        `Erro ao criar task via texto livre para userId=${userId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.telegramSend.sendMessage(
        chatId,
        `❌ Não foi possível criar a tarefa. Tente novamente em instantes.`,
      );
    }
  }

  // ─── Helpers privados ──────────────────────────────────────────────────────

  /**
   * Resolve o projeto padrão para o usuário buscando o mais recente
   * associado à sua organização (`idEstab = userId` ou primeiro disponível).
   *
   * NOTA: DProject não tem campo `idCreator` no schema V2. Buscamos o
   * projeto mais recente onde `idEstab` = DEntidade do usuário (org).
   * Se não encontrado por idEstab, retornamos o projeto mais recente
   * não excluído como fallback.
   *
   * 1-2 queries — sem N+1.
   *
   * @param userId - DEntidade.chave do usuário
   * @returns chave BigInt do projeto padrão, ou null se não encontrado
   */
  private async resolveDefaultProjectId(userId: bigint): Promise<bigint | null> {
    // Primeiro: tentar projeto associado ao usuário via idEstab
    const projectByEstab = await this.prisma.dProject.findFirst({
      where: {
        excluido: false,
        idEstab: userId,
      },
      select: { chave: true },
      orderBy: { chave: 'desc' },
    });

    if (projectByEstab) {
      return projectByEstab.chave;
    }

    // Fallback: projeto mais recente não excluído
    const project = await this.prisma.dProject.findFirst({
      where: { excluido: false },
      select: { chave: true },
      orderBy: { chave: 'desc' },
    });

    return project?.chave ?? null;
  }
}
