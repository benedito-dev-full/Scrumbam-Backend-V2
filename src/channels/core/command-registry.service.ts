import { Injectable, Logger } from '@nestjs/common';

/**
 * Handler de comando slash do canal.
 *
 * Implementado por cada handler concreto (StartHandler, PairHandler, etc.).
 * Registrado no CommandRegistryService via `register(handler)`.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class StartHandler implements CommandHandler {
 *   readonly commandName = 'start';
 *   async handle(chatId: bigint, userId: bigint, args: string[]): Promise<string> {
 *     return 'Olá! Use /pair <code> para vincular sua conta.';
 *   }
 * }
 * ```
 */
export interface CommandHandler {
  /** Nome do comando sem barra (ex: 'start', 'pair', 'tasks'). */
  readonly commandName: string;

  /**
   * Executa o comando e retorna o texto de resposta ao usuário.
   *
   * @param chatId - ID do chat no canal externo (BigInt)
   * @param userId - DEntidade.chave do usuário (BigInt), pode ser 0n se não pareado
   * @param args - Argumentos após o nome do comando
   * @returns Texto de resposta a ser enviado ao usuário via ChannelAdapter.send
   */
  handle(chatId: bigint, userId: bigint, args: string[]): Promise<string>;
}

/**
 * Registro de handlers de comandos slash.
 *
 * Mapeamento simples nome→handler sem reflection pesada.
 * Handlers são registrados via DI do NestJS (injeção direta no módulo).
 *
 * Uso:
 * - Handlers se registram em `onModuleInit` via `commandRegistry.register(this)`
 * - MessageRouterService resolve o handler via `commandRegistry.resolve(commandName)`
 *
 * @example
 * ```typescript
 * // No handler:
 * @Injectable()
 * class PairHandler implements OnModuleInit, CommandHandler {
 *   constructor(private readonly registry: CommandRegistryService) {}
 *   onModuleInit() { this.registry.register(this); }
 * }
 *
 * // No router:
 * const handler = this.commandRegistry.resolve('pair');
 * if (handler) {
 *   const reply = await handler.handle(chatId, userId, args);
 * }
 * ```
 */
@Injectable()
export class CommandRegistryService {
  private readonly logger = new Logger(CommandRegistryService.name);
  private readonly handlers = new Map<string, CommandHandler>();

  /**
   * Registra um handler de comando.
   *
   * Se já existir um handler com o mesmo nome, o novo substitui o anterior
   * (permite hot-reload em ambiente de desenvolvimento).
   *
   * @param handler - Handler a registrar
   */
  register(handler: CommandHandler): void {
    this.handlers.set(handler.commandName, handler);
    this.logger.log(`Command handler registrado: /${handler.commandName}`);
  }

  /**
   * Resolve o handler para um nome de comando.
   *
   * @param commandName - Nome do comando sem barra
   * @returns Handler registrado, ou undefined se não encontrado
   *
   * @example
   * ```typescript
   * const handler = registry.resolve('pair');
   * if (!handler) {
   *   // comando desconhecido
   * }
   * ```
   */
  resolve(commandName: string): CommandHandler | undefined {
    return this.handlers.get(commandName);
  }

  /**
   * Lista todos os comandos registrados.
   *
   * @returns Array de nomes de comandos disponíveis
   */
  listCommands(): string[] {
    return Array.from(this.handlers.keys());
  }
}
