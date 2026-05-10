import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CommandHandler,
  CommandRegistryService,
} from '../../core/command-registry.service';

/**
 * Handler do comando `/start` do Telegram.
 *
 * Envia mensagem de boas-vindas orientando o usuário sobre os próximos passos.
 * Não acessa banco de dados nem executa fluxo acoplado.
 *
 * Registro: autorregistra-se no `CommandRegistryService` em `onModuleInit`.
 *
 * @example
 * ```
 * Usuário: /start
 * Bot: Olá! Eu sou o Scrumban Bot...
 * ```
 */
@Injectable()
export class StartHandler implements OnModuleInit, CommandHandler {
  private readonly logger = new Logger(StartHandler.name);

  /** Nome do comando sem barra — usado pelo `CommandRegistryService`. */
  readonly commandName = 'start';

  constructor(private readonly commandRegistry: CommandRegistryService) {}

  /** Autorregistra este handler no registry ao inicializar o módulo. */
  onModuleInit(): void {
    this.commandRegistry.register(this);
    this.logger.log('StartHandler registrado');
  }

  /**
   * Retorna mensagem de boas-vindas com instruções de uso.
   *
   * Não requer pareamento — responde mesmo para chatIds não vinculados.
   * `userId` é ignorado (pode ser 0n quando não pareado).
   *
   * @param chatId - ID do chat Telegram (BigInt)
   * @param _userId - DEntidade.chave do usuário (ignorado neste handler)
   * @param _args - Argumentos adicionais (ignorados)
   * @returns Texto de boas-vindas com lista de comandos disponíveis
   */
  async handle(chatId: bigint, _userId: bigint, _args: string[]): Promise<string> {
    this.logger.debug(`/start recebido de chatId=${chatId}`);

    return (
      `Olá! Eu sou o *Scrumban Bot* 🤖\n\n` +
      `Para começar, vincule sua conta usando o código gerado no painel web:\n` +
      `👉 \`/pair <codigo>\`\n\n` +
      `*Comandos disponíveis após vincular:*\n` +
      `• \`/tasks\` — listar suas tarefas (opções: today, week, backlog)\n` +
      `• \`/create <título>\` — criar nova tarefa\n` +
      `• \`/status\` — verificar status do pareamento\n\n` +
      `Você também pode enviar texto livre para criar uma tarefa rapidamente.`
    );
  }
}
