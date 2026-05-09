import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

// Types do projeto
import { EmailProvider, SendEmailInput, SendEmailResult } from './email-provider.interface';

/**
 * Provider de email usando SMTP via nodemailer.
 *
 * Provider padrão para desenvolvimento local (MailHog, Mailtrap, etc.).
 * Lê configuração do ConfigService via variáveis de ambiente.
 *
 * Variáveis de ambiente:
 * - `SMTP_HOST` — host do servidor SMTP (default: 'localhost')
 * - `SMTP_PORT` — porta SMTP (default: 1025)
 * - `SMTP_USER` — usuário SMTP (opcional)
 * - `SMTP_PASS` — senha SMTP (opcional)
 * - `SMTP_FROM` — remetente default (default: 'noreply@scrumban.app')
 * - `EMAIL_MOCK` — se 'true', loga em vez de enviar (útil em CI/testes)
 *
 * @example
 * ```bash
 * # .env.local (desenvolvimento com MailHog)
 * SMTP_HOST=localhost
 * SMTP_PORT=1025
 * EMAIL_MOCK=false
 *
 * # .env.test (CI — não envia emails reais)
 * EMAIL_MOCK=true
 * ```
 */
@Injectable()
export class SmtpProvider implements EmailProvider {
  private readonly logger = new Logger(SmtpProvider.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly defaultFrom: string;
  private readonly isMock: boolean;

  constructor(config: ConfigService) {
    this.isMock = config.get<string>('EMAIL_MOCK', 'false') === 'true';
    this.defaultFrom = config.get<string>('SMTP_FROM', 'noreply@scrumban.app');

    this.transporter = nodemailer.createTransport({
      host: config.get<string>('SMTP_HOST', 'localhost'),
      port: config.get<number>('SMTP_PORT', 1025),
      secure: false,
      auth: config.get<string>('SMTP_USER')
        ? {
            user: config.get<string>('SMTP_USER'),
            pass: config.get<string>('SMTP_PASS'),
          }
        : undefined,
    });
  }

  /**
   * Envia email via SMTP (nodemailer).
   *
   * Se `EMAIL_MOCK=true`, loga o email em vez de enviar (dev/CI friendly).
   *
   * @param input - Dados do email
   * @returns Promise com ID da mensagem e provider 'smtp'
   * @throws {Error} Se o transporter SMTP falhar
   *
   * @example
   * ```typescript
   * const result = await smtpProvider.send({
   *   to: 'user@example.com',
   *   subject: 'Bem-vindo ao Scrumban!',
   *   html: '<h1>Olá!</h1>',
   * });
   * // result: { id: '<messageId>', provider: 'smtp' }
   * ```
   */
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const mailOptions = {
      from: input.from ?? this.defaultFrom,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    };

    if (this.isMock) {
      this.logger.log(`[MOCK] Email: ${input.to} — "${input.subject}"`);
      return { id: `mock-${Date.now()}`, provider: 'smtp-mock' };
    }

    const info = await this.transporter.sendMail(mailOptions);
    this.logger.log(`Email enviado via SMTP: ${info.messageId} → ${input.to}`);

    return {
      id: info.messageId ?? `smtp-${Date.now()}`,
      provider: 'smtp',
    };
  }
}
