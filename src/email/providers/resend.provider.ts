import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

// Types do projeto
import { EmailProvider, SendEmailInput, SendEmailResult } from './email-provider.interface';

/**
 * Provider de email usando Resend.
 *
 * Provider moderno com excelente DX e dashboard de métricas.
 * Alternativa ao SendGrid para projetos novos.
 *
 * Variáveis de ambiente:
 * - `RESEND_API_KEY` — API key do Resend (obrigatório)
 * - `RESEND_FROM` — remetente default (ex: 'Scrumban <noreply@scrumban.app>')
 *
 * @example
 * ```bash
 * # .env.production
 * EMAIL_PROVIDER=resend
 * RESEND_API_KEY=re_xxxxxxxxxx
 * RESEND_FROM=Scrumban <noreply@minha-empresa.com>
 * ```
 */
@Injectable()
export class ResendProvider implements EmailProvider {
  private readonly logger = new Logger(ResendProvider.name);
  private readonly client: Resend;
  private readonly defaultFrom: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY', 'dummy-key');
    this.client = new Resend(apiKey);
    this.defaultFrom = config.get<string>(
      'RESEND_FROM',
      'Scrumban <noreply@scrumban.app>',
    );
  }

  /**
   * Envia email via Resend API.
   *
   * @param input - Dados do email
   * @returns Promise com ID da mensagem e provider 'resend'
   * @throws {Error} Se a API do Resend retornar erro
   *
   * @example
   * ```typescript
   * const result = await resendProvider.send({
   *   to: 'user@example.com',
   *   subject: 'Bem-vindo!',
   *   html: '<h1>Olá!</h1>',
   * });
   * // result: { id: 'resend-message-id', provider: 'resend' }
   * ```
   */
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const { data, error } = await this.client.emails.send({
      from: input.from ?? this.defaultFrom,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    if (error) {
      throw new Error(`Resend API error: ${error.message}`);
    }

    const messageId = data?.id ?? `resend-${Date.now()}`;
    this.logger.log(`Email enviado via Resend: ${messageId} → ${input.to}`);

    return {
      id: messageId,
      provider: 'resend',
    };
  }
}
