/**
 * Template de email de boas-vindas.
 *
 * Enviado quando um novo usuário é registrado no sistema.
 * Implementado como função TypeScript pura (sem motor de template externo).
 *
 * @param data - Dados para renderizar o template
 * @returns Objeto com `subject`, `html` e `text`
 *
 * @example
 * ```typescript
 * const email = welcomeTemplate({
 *   name: 'João Silva',
 *   loginUrl: 'https://app.scrumban.com/login',
 * });
 * // email.subject: 'Bem-vindo ao Scrumban, João!'
 * ```
 */
export function welcomeTemplate(data: {
  name: string;
  loginUrl: string;
}): { subject: string; html: string; text: string } {
  const { name, loginUrl } = data;

  return {
    subject: `Bem-vindo ao Scrumban, ${name}!`,
    html: `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Bem-vindo ao Scrumban</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h1 style="color: #1a73e8;">Bem-vindo ao Scrumban, ${name}!</h1>
  <p>Sua conta foi criada com sucesso. Agora você pode acessar o sistema e começar a usar todas as funcionalidades.</p>
  <div style="margin: 30px 0;">
    <a href="${loginUrl}"
       style="background-color: #1a73e8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
      Acessar o Sistema
    </a>
  </div>
  <p style="color: #666; font-size: 14px;">
    Se você não criou esta conta, ignore este email.
  </p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="color: #999; font-size: 12px;">
    © ${new Date().getFullYear()} Scrumban. Todos os direitos reservados.
  </p>
</body>
</html>`,
    text: `Bem-vindo ao Scrumban, ${name}!

Sua conta foi criada com sucesso. Acesse o sistema em:
${loginUrl}

Se você não criou esta conta, ignore este email.`,
  };
}
