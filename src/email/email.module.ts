import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Providers
import { SmtpProvider } from './providers/smtp.provider';
import { SendgridProvider } from './providers/sendgrid.provider';
import { ResendProvider } from './providers/resend.provider';
import { EMAIL_PROVIDER_TOKEN } from './providers/email-provider.interface';

// Service principal
import { EmailService } from './email.service';

/**
 * Módulo de Email do Scrumban-Backend-V2.
 *
 * Registra os 3 providers (SMTP, SendGrid, Resend) e seleciona o ativo
 * via factory baseada na variável de ambiente `EMAIL_PROVIDER`.
 *
 * Variável de ambiente:
 * - `EMAIL_PROVIDER=smtp` (default) — usa SMTP/nodemailer
 * - `EMAIL_PROVIDER=sendgrid` — usa SendGrid
 * - `EMAIL_PROVIDER=resend` — usa Resend
 *
 * @example
 * ```typescript
 * // app.module.ts
 * @Module({
 *   imports: [EmailModule],
 * })
 * export class AppModule {}
 *
 * // Uso em qualquer service
 * constructor(private readonly emailService: EmailService) {}
 * await emailService.sendTemplate('welcome', data, 'user@example.com');
 * ```
 */
/*
 * Nota: EmailModule não importa CommonModule nem EventosModule explicitamente.
 * Ambos são `@Global()` — providers (PrismaService, CorrelationIdService,
 * EventProducerService) ficam disponíveis para injeção via DI.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    SmtpProvider,
    SendgridProvider,
    ResendProvider,
    {
      provide: EMAIL_PROVIDER_TOKEN,
      useFactory: (
        config: ConfigService,
        smtp: SmtpProvider,
        sendgrid: SendgridProvider,
        resend: ResendProvider,
      ) => {
        const provider = config.get<string>('EMAIL_PROVIDER', 'smtp').toLowerCase();
        switch (provider) {
          case 'sendgrid':
            return sendgrid;
          case 'resend':
            return resend;
          case 'smtp':
          default:
            return smtp;
        }
      },
      inject: [ConfigService, SmtpProvider, SendgridProvider, ResendProvider],
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
