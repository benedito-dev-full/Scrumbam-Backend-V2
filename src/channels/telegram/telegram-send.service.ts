import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Serviço de envio de mensagens ao Telegram.
 *
 * Responsabilidades:
 * - Enviar texto para um chatId via `sendMessage`
 * - Registrar o webhook via `setWebhook` (chamado em `onModuleInit`)
 *
 * Segurança:
 * - `TELEGRAM_BOT_TOKEN` nunca é logado — logs exibem apenas status HTTP.
 * - URLs construídas com o token nunca aparecem em logs.
 *
 * Comportamento de falha:
 * - `sendMessage` lança se a API retornar status não-OK (caller decide como tratar).
 * - `setWebhook` propaga erro para quem chama — `TelegramWebhookService.onModuleInit`
 *   captura e loga sem derrubar o processo.
 *
 * @example
 * ```typescript
 * await telegramSendService.sendMessage(BigInt(123456789), 'Olá! Como posso ajudar?');
 * ```
 */
@Injectable()
export class TelegramSendService {
  private readonly logger = new Logger(TelegramSendService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Envia uma mensagem de texto para o chatId Telegram informado.
   *
   * Usa `fetch` nativo (Node 18+). Sem dependência de biblioteca HTTP externa.
   *
   * @param chatId - ID do chat Telegram (BigInt)
   * @param text - Texto a enviar (markdown básico suportado)
   *
   * @throws {Error} Se a API Telegram retornar status não-OK
   *
   * @example
   * ```typescript
   * await service.sendMessage(BigInt(123456789), 'Tarefa criada com sucesso!');
   * ```
   */
  async sendMessage(chatId: bigint, text: string): Promise<void> {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');

    if (!token) {
      this.logger.warn('TelegramSendService: TELEGRAM_BOT_TOKEN não configurado — mensagem não enviada');
      return;
    }

    // URL construída com token — NUNCA logar esta URL
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.toString(),
        text,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      // Logar apenas status — não logar a URL que contém o token
      this.logger.error(
        `Falha ao enviar mensagem Telegram: status=${response.status} chatId=${chatId}`,
      );
      throw new Error(`Telegram sendMessage failed: ${response.status} — ${errorBody.slice(0, 100)}`);
    }

    this.logger.debug(`Mensagem enviada ao chatId=${chatId}`);
  }

  /**
   * Registra o webhook do bot no Telegram.
   *
   * Idempotente: re-registrar com a mesma URL não quebra nada no Telegram.
   * Deve ser chamado em `onModuleInit` do `TelegramWebhookService`.
   *
   * Requer:
   * - `TELEGRAM_BOT_TOKEN` — token do bot
   * - `TELEGRAM_WEBHOOK_URL` — URL pública HTTPS do webhook
   * - `TELEGRAM_WEBHOOK_SECRET` — secret token para validação
   *
   * @throws {Error} Se a API Telegram retornar status não-OK
   *
   * @example
   * ```typescript
   * await service.setWebhook();
   * // Registra: POST https://api.telegram.org/bot{TOKEN}/setWebhook
   * //   { url: 'https://myapp.com/webhooks/telegram', secret_token: '...' }
   * ```
   */
  async setWebhook(): Promise<void> {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    const webhookUrl = this.configService.get<string>('TELEGRAM_WEBHOOK_URL');
    const secret = this.configService.get<string>('TELEGRAM_WEBHOOK_SECRET');

    if (!token || !webhookUrl) {
      throw new Error(
        'TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_URL são obrigatórios para registrar o webhook',
      );
    }

    // URL com token — NUNCA logar
    const url = `https://api.telegram.org/bot${token}/setWebhook`;

    const body: Record<string, string> = { url: webhookUrl };
    if (secret) {
      body['secret_token'] = secret;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      // Logar apenas status — não logar a URL que contém o token
      this.logger.error(
        `Falha ao registrar webhook Telegram: status=${response.status}`,
      );
      throw new Error(`Telegram setWebhook failed: ${response.status} — ${errorBody.slice(0, 100)}`);
    }

    // Logar apenas que foi bem-sucedido, sem token ou URL completa
    this.logger.log(`Webhook Telegram registrado com sucesso em ${webhookUrl}`);
  }
}
