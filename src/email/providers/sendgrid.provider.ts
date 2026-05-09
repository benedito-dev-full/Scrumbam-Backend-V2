import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';

// Types do projeto
import { EmailProvider, SendEmailInput, SendEmailResult } from './email-provider.interface';

/**
 * Provider de email usando SendGrid.
 *
 * Provider recomendado para produção de alta escala.
 * Lê a API key do ConfigService via variável de ambiente `SENDGRID_API_KEY`.
 *
 * Variáveis de ambiente:
 * - `SENDGRID_API_KEY` — API key do SendGrid (obrigatório em prod)
 * - `SENDGRID_FROM` — remetente default (default: 'noreply@scrumban.app')
 *
 * @example
 * ```bash
 * # .env.production
 * EMAIL_PROVIDER=sendgrid
 * SENDGRID_API_KEY=SG.xxxxxxxxxx
 * SENDGRID_FROM=noreply@minha-empresa.com
 * ```
 */
@Injectable()
export class SendgridProvider implements EmailProvider {
  private readonly logger = new Logger(SendgridProvider.name);
  private readonly defaultFrom: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('SENDGRID_API_KEY', '');
    if (apiKey) {
      sgMail.setApiKey(apiKey);
    }
    this.defaultFrom = config.get<string>('SENDGRID_FROM', 'noreply@scrumban.app');
  }

  /**
   * Envia email via SendGrid API.
   *
   * @param input - Dados do email
   * @returns Promise com ID da mensagem e provider 'sendgrid'
   * @throws {Error} Se a API do SendGrid retornar erro
   *
   * @example
   * ```typescript
   * const result = await sendgridProvider.send({
   *   to: 'user@example.com',
   *   subject: 'Bem-vindo!',
   *   html: '<h1>Olá!</h1>',
   * });
   * // result: { id: 'sendgrid-message-id', provider: 'sendgrid' }
   * ```
   */
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const msg: sgMail.MailDataRequired = {
      to: input.to,
      from: input.from ?? this.defaultFrom,
      subject: input.subject,
      html: input.html,
      text: input.text,
    };

    const [response] = await sgMail.send(msg);
    const messageId =
      (response.headers['x-message-id'] as string) ?? `sendgrid-${Date.now()}`;

    this.logger.log(`Email enviado via SendGrid: ${messageId} → ${input.to}`);

    return {
      id: messageId,
      provider: 'sendgrid',
    };
  }
}
