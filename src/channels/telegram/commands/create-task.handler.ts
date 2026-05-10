import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UserProjectService } from '../../../projects/user-project.service';
import {
  CommandHandler,
  CommandRegistryService,
} from '../../core/command-registry.service';
import { TasksService } from '../../../tasks/tasks.service';

/**
 * Handler do comando `/create <titulo>` do Telegram.
 *
 * Cria uma nova task no projeto padrao do usuario via `TasksService.create`.
 * O projeto padrao vem de `UserProjectService`, que usa membership canonico
 * de projeto em DVincula -171/-172/-173.
 */
@Injectable()
export class CreateTaskHandler implements OnModuleInit, CommandHandler {
  private readonly logger = new Logger(CreateTaskHandler.name);

  /** Nome do comando sem barra usado pelo CommandRegistryService. */
  readonly commandName = 'create';

  constructor(
    private readonly commandRegistry: CommandRegistryService,
    private readonly tasksService: TasksService,
    private readonly userProjectService: UserProjectService,
  ) {}

  onModuleInit(): void {
    this.commandRegistry.register(this);
    this.logger.log('CreateTaskHandler registrado');
  }

  /**
   * Cria uma nova task com o titulo fornecido no projeto padrao do usuario.
   *
   * @param chatId - ID do chat Telegram
   * @param userId - DEntidade.chave do usuario
   * @param args - Argumentos que formam o titulo da task
   */
  async handle(chatId: bigint, userId: bigint, args: string[]): Promise<string> {
    this.logger.debug(`/create recebido de chatId=${chatId} userId=${userId}`);

    const titulo = args.join(' ').trim();

    if (!titulo || titulo.length < 3) {
      return (
        `âŒ *TÃ­tulo muito curto.*\n\n` +
        `Uso: \`/create <tÃ­tulo da tarefa>\`\n` +
        `Exemplo: \`/create Revisar documentaÃ§Ã£o da API\``
      );
    }

    if (titulo.length > 512) {
      return `âŒ TÃ­tulo muito longo (mÃ¡ximo: 512 caracteres). Encurte e tente novamente.`;
    }

    const projectId = await this.userProjectService.getDefaultProject(userId);

    if (!projectId) {
      return (
        `âŒ *Nenhum projeto encontrado.*\n\n` +
        `Para criar tarefas via Telegram, vocÃª precisa ter um projeto no Scrumban.\n` +
        `Acesse o painel web para criar um projeto primeiro.`
      );
    }

    try {
      const task = await this.tasksService.create(
        {
          nome: titulo,
          projectId: projectId.toString(),
          source: 'telegram',
          rawText: titulo,
          assigneeId: userId.toString(),
        },
        userId,
      );

      this.logger.log(
        `Task criada via Telegram: id=${task.id} identifier=${task.identifier} userId=${userId}`,
      );

      const identifier = task.identifier ? `[${task.identifier}] ` : '';
      return (
        `âœ… *Tarefa criada!*\n\n` +
        `${identifier}${task.nome}\n` +
        `Status: ðŸ“¥ INBOX`
      );
    } catch (error) {
      this.logger.error(
        `Erro ao criar task para userId=${userId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return `âŒ NÃ£o foi possÃ­vel criar a tarefa. Tente novamente em instantes.`;
    }
  }
}
