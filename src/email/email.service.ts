import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';

// Services do projeto
import { AuditService } from '../common/services/audit.service';

// Providers e DTOs
import { EMAIL_PROVIDER_TOKEN, EmailProvider } from './providers/email-provider.interface';
import { SendEmailDto } from './dto/send-email.dto';
import { EmailResponseDto } from './dto/email-response.dto';

// Templates
import { welcomeTemplate } from './templates/welcome.template';
import { passwordResetTemplate } from './templates/password-reset.template';
import { inviteTemplate } from './templates/invite.template';
import {
  notificationDigestTemplate,
  DigestNotification,
} from './templates/notification-digest.template';

/** Mapa de templates disponíveis com seus tipos de dados. */
type TemplateMap = {
  welcome: { name: string; loginUrl: string };
  'password-reset': { name: string; resetUrl: string; expiresIn: string };
  invite: { inviterName: string; orgName: string; inviteUrl: string };
  'notification-digest': { userName: string; notifications: DigestNotification[] };
};

/** Nomes de templates válidos. */
export type TemplateName = keyof TemplateMap;

/**
 * Serviço de email do Scrumban-Backend-V2.
 *
 * Abstrai o envio de emails atrás de uma interface única, suportando
 * múltiplos providers (SMTP, SendGrid, Resend) configuráveis via
 * variável de ambiente `EMAIL_PROVIDER`.
 *
 * Responsabilidades:
 * - Delegar envio ao provider configurado
 * - Renderizar templates TypeScript puros
 * - Emitir eventos de auditoria (`email.sent`, `email.failed`) via AuditService
 *
 * Ordem canônica (Pilar devari-backend-patterns §7):
 * - Enviar → SUCESSO → AuditService.log('email.sent', ...)
 * - Enviar → FALHA → AuditService.log('email.failed', ...) → relança exceção
 *
 * @example
 * ```typescript
 * // Envio direto
 * const result = await emailService.send({
 *   to: 'user@example.com',
 *   subject: 'Teste',
 *   html: '<h1>Olá!</h1>',
 * });
 *
 * // Envio via template
 * const result = await emailService.sendTemplate('welcome', {
 *   name: 'João',
 *   loginUrl: 'https://app.scrumban.com/login',
 * }, 'joao@example.com');
 * ```
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(EMAIL_PROVIDER_TOKEN)
    private readonly emailProvider: EmailProvider,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Envia um email usando o provider configurado.
   *
   * Emite evento de auditoria `email.sent` após envio bem-sucedido,
   * ou `email.failed` em caso de erro (antes de relançar a exceção).
   *
   * @param dto - Dados do email a ser enviado
   * @param userId - ID do usuário que disparou o envio (opcional, para auditoria)
   * @returns Promise com ID, provider e timestamp do envio
   *
   * @throws {Error} Se o provider falhar ao enviar o email
   *
   * @example
   * ```typescript
   * const result = await emailService.send(
   *   { to: 'user@example.com', subject: 'Olá!', html: '<p>Olá!</p>' },
   *   BigInt(42),
   * );
   * // { id: 'msg-id', provider: 'smtp', sentAt: '2026-05-09T...' }
   * ```
   */
  async send(dto: SendEmailDto, userId?: bigint): Promise<EmailResponseDto> {
    try {
      const result = await this.emailProvider.send({
        to: dto.to,
        subject: dto.subject,
        html: dto.html,
        text: dto.text,
        from: dto.from,
      });

      // Auditoria APÓS persistência (regra canônica)
      await this.auditService.log(
        'email.sent',
        BigInt(0),
        {
          to: dto.to,
          subject: dto.subject,
          provider: result.provider,
          messageId: result.id,
        },
        userId,
      );

      this.logger.log(`Email enviado: ${result.id} → ${dto.to} via ${result.provider}`);

      return {
        id: result.id,
        provider: result.provider,
        sentAt: new Date().toISOString(),
      };
    } catch (error) {
      // Auditoria da falha
      await this.auditService.log(
        'email.failed',
        BigInt(0),
        {
          to: dto.to,
          subject: dto.subject,
          error: error instanceof Error ? error.message : String(error),
        },
        userId,
      );

      this.logger.error(
        `Falha ao enviar email → ${dto.to}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Renderiza um template e envia o email resultante.
   *
   * Templates disponíveis:
   * - `welcome` — boas-vindas ao novo usuário
   * - `password-reset` — redefinição de senha
   * - `invite` — convite para organização/projeto
   * - `notification-digest` — digest de notificações agrupadas
   *
   * @param templateName - Nome do template a renderizar
   * @param data - Dados para renderizar o template
   * @param to - Destinatário do email
   * @param userId - ID do usuário (para auditoria, opcional)
   * @returns Promise com resultado do envio
   *
   * @throws {NotFoundException} Se o nome do template não for reconhecido
   * @throws {Error} Se o provider falhar ao enviar
   *
   * @example
   * ```typescript
   * // Enviar boas-vindas
   * await emailService.sendTemplate(
   *   'welcome',
   *   { name: 'João', loginUrl: 'https://app.scrumban.com/login' },
   *   'joao@example.com',
   * );
   *
   * // Enviar digest de notificações
   * await emailService.sendTemplate(
   *   'notification-digest',
   *   {
   *     userName: 'Maria',
   *     notifications: [
   *       { title: 'Nova tarefa', body: 'Tarefa "PR Review" atribuída a você' },
   *     ],
   *   },
   *   'maria@example.com',
   * );
   * ```
   */
  async sendTemplate(
    templateName: string,
    data: Record<string, unknown>,
    to: string,
    userId?: bigint,
  ): Promise<EmailResponseDto> {
    const rendered = this.renderTemplate(templateName, data);

    return this.send(
      {
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      },
      userId,
    );
  }

  /**
   * Renderiza um template pelo nome com os dados fornecidos.
   *
   * @param templateName - Nome do template
   * @param data - Dados para o template
   * @returns Objeto com subject, html e text renderizados
   * @throws {NotFoundException} Se template não encontrado
   */
  private renderTemplate(
    templateName: string,
    data: Record<string, unknown>,
  ): { subject: string; html: string; text: string } {
    switch (templateName) {
      case 'welcome':
        return welcomeTemplate(data as TemplateMap['welcome']);

      case 'password-reset':
        return passwordResetTemplate(data as TemplateMap['password-reset']);

      case 'invite':
        return inviteTemplate(data as TemplateMap['invite']);

      case 'notification-digest':
        return notificationDigestTemplate(data as TemplateMap['notification-digest']);

      default:
        throw new NotFoundException(
          `Template de email '${templateName}' não encontrado. Templates disponíveis: welcome, password-reset, invite, notification-digest`,
        );
    }
  }
}
