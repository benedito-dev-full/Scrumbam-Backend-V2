import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CommandHandler,
  CommandRegistryService,
} from '../../core/command-registry.service';
import { PairingService } from '../../core/pairing.service';

/**
 * Handler do comando `/pair <codigo>` do Telegram.
 *
 * Consome um token de pareamento one-shot e vincula o chatId ao userId
 * na tabela DVincula -483 (CHANNEL_LINK).
 *
 * Fluxo:
 * 1. Usuário autentica-se no painel web e gera um código
 * 2. Usuário digita `/pair <codigo>` no Telegram
 * 3. Este handler chama `PairingService.consume()` com o código e o chatId
 * 4. Se válido: vínculo criado/atualizado — confirmação enviada
 * 5. Se inválido/expirado/já usado: mensagem de erro clara
 *
 * Segurança:
 * - O código é one-shot — segundo uso do mesmo código falha
 * - `PairingService.consume` é fail-closed: não vaza detalhes do motivo
 * - `chatId` sempre BigInt — nunca parseInt/Number
 *
 * @see PairingService — lógica de consumo do token
 */
@Injectable()
export class PairHandler implements OnModuleInit, CommandHandler {
  private readonly logger = new Logger(PairHandler.name);

  /** Nome do comando sem barra — usado pelo `CommandRegistryService`. */
  readonly commandName = 'pair';

  constructor(
    private readonly commandRegistry: CommandRegistryService,
    private readonly pairingService: PairingService,
  ) {}

  /** Autorregistra este handler no registry ao inicializar o módulo. */
  onModuleInit(): void {
    this.commandRegistry.register(this);
    this.logger.log('PairHandler registrado');
  }

  /**
   * Consome token de pareamento e vincula chatId ao userId.
   *
   * @param chatId - ID do chat Telegram (BigInt) — NUNCA parseInt
   * @param _userId - Não utilizado neste handler (usuário ainda não pareado)
   * @param args - args[0] deve ser o código de pareamento (12 chars hex)
   * @returns Mensagem de sucesso ou erro a ser enviada ao usuário
   */
  async handle(chatId: bigint, _userId: bigint, args: string[]): Promise<string> {
    this.logger.debug(`/pair recebido de chatId=${chatId}`);

    const plainCode = args[0]?.trim();

    if (!plainCode) {
      return (
        `❌ *Código não informado.*\n\n` +
        `Uso: \`/pair <codigo>\`\n` +
        `O código é gerado no painel web em *Configurações → Integrações → Telegram*.`
      );
    }

    try {
      const userId = await this.pairingService.consume(plainCode, {
        channelName: 'telegram',
        chatId,
      });

      this.logger.log(`Pareamento concluído via /pair: userId=${userId} chatId=${chatId}`);

      return (
        `✅ *Conta vinculada com sucesso!*\n\n` +
        `Agora você pode usar os comandos:\n` +
        `• \`/tasks\` — ver suas tarefas\n` +
        `• \`/create <título>\` — criar nova tarefa\n` +
        `• \`/status\` — verificar pareamento`
      );
    } catch {
      // UnauthorizedException do PairingService — não propagar stack trace ao usuário
      this.logger.warn(`Falha ao parear chatId=${chatId}: código inválido ou expirado`);

      return (
        `❌ *Código inválido ou expirado.*\n\n` +
        `Possíveis motivos:\n` +
        `• O código já foi usado anteriormente\n` +
        `• O código expirou (validade: 15 minutos)\n` +
        `• O código foi digitado incorretamente\n\n` +
        `Gere um novo código no painel web e tente novamente.`
      );
    }
  }
}
