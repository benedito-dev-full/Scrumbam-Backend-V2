/**
 * Input para envio de email.
 */
export interface SendEmailInput {
  /** Destinatário do email (endereço de email válido). */
  to: string;
  /** Assunto do email. */
  subject: string;
  /** Corpo HTML do email. */
  html: string;
  /** Corpo em texto plano (fallback). Opcional. */
  text?: string;
  /** Remetente customizado. Se omitido, usa o default do provider. Opcional. */
  from?: string;
}

/**
 * Resultado do envio de email.
 */
export interface SendEmailResult {
  /** ID da mensagem retornado pelo provider. */
  id: string;
  /** Nome do provider que enviou (ex: 'smtp', 'sendgrid', 'resend'). */
  provider: string;
}

/**
 * Interface canônica para providers de email.
 *
 * Abstrai SMTP (nodemailer), SendGrid e Resend atrás de uma interface única.
 * O `EmailService` usa esta interface para delegar o envio, permitindo
 * troca de provider via variável de ambiente `EMAIL_PROVIDER`.
 *
 * @example
 * ```typescript
 * // Injeção via TOKEN
 * @Inject(EMAIL_PROVIDER_TOKEN)
 * private readonly emailProvider: EmailProvider
 *
 * // Uso
 * const result = await this.emailProvider.send({
 *   to: 'user@example.com',
 *   subject: 'Bem-vindo!',
 *   html: '<h1>Olá!</h1>',
 * });
 * ```
 */
export interface EmailProvider {
  /**
   * Envia um email usando o provider configurado.
   *
   * @param input - Dados do email a ser enviado
   * @returns Promise com ID da mensagem e nome do provider
   * @throws {Error} Se o provider falhar ao enviar
   */
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

/** Token de injeção para o provider de email ativo. */
export const EMAIL_PROVIDER_TOKEN = 'EMAIL_PROVIDER';
