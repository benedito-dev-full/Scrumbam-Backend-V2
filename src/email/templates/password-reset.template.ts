/**
 * Template de email de redefinição de senha.
 *
 * Enviado quando um usuário solicita redefinição de senha.
 * O link expira no tempo configurado (normalmente 30 minutos).
 *
 * @param data - Dados para renderizar o template
 * @returns Objeto com `subject`, `html` e `text`
 *
 * @example
 * ```typescript
 * const email = passwordResetTemplate({
 *   name: 'João Silva',
 *   resetUrl: 'https://app.scrumban.com/reset?token=abc123',
 *   expiresIn: '30 minutos',
 * });
 * ```
 */
export function passwordResetTemplate(data: {
  name: string;
  resetUrl: string;
  expiresIn: string;
}): { subject: string; html: string; text: string } {
  const { name, resetUrl, expiresIn } = data;

  return {
    subject: 'Redefinição de senha — Scrumban',
    html: `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Redefinição de Senha</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h1 style="color: #d93025;">Redefinição de Senha</h1>
  <p>Olá, ${name}!</p>
  <p>Recebemos uma solicitação para redefinir a senha da sua conta Scrumban.</p>
  <p>Clique no botão abaixo para criar uma nova senha. Este link expira em <strong>${expiresIn}</strong>.</p>
  <div style="margin: 30px 0;">
    <a href="${resetUrl}"
       style="background-color: #d93025; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
      Redefinir Senha
    </a>
  </div>
  <p style="color: #666; font-size: 14px;">
    Se você não solicitou a redefinição de senha, ignore este email. Sua senha permanece a mesma.
  </p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="color: #999; font-size: 12px;">
    © ${new Date().getFullYear()} Scrumban. Todos os direitos reservados.
  </p>
</body>
</html>`,
    text: `Redefinição de Senha — Scrumban

Olá, ${name}!

Recebemos uma solicitação para redefinir a senha da sua conta.
Acesse o link abaixo para criar uma nova senha (expira em ${expiresIn}):

${resetUrl}

Se você não solicitou a redefinição, ignore este email.`,
  };
}
