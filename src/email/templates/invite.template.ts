/**
 * Template de email de convite para organização/projeto.
 *
 * Enviado quando um usuário convida outro para participar de uma organização
 * ou projeto no Scrumban.
 *
 * @param data - Dados para renderizar o template
 * @returns Objeto com `subject`, `html` e `text`
 *
 * @example
 * ```typescript
 * const email = inviteTemplate({
 *   inviterName: 'Maria Santos',
 *   orgName: 'Devari Tech',
 *   inviteUrl: 'https://app.scrumban.com/invite?token=xyz789',
 * });
 * ```
 */
export function inviteTemplate(data: {
  inviterName: string;
  orgName: string;
  inviteUrl: string;
}): { subject: string; html: string; text: string } {
  const { inviterName, orgName, inviteUrl } = data;

  return {
    subject: `${inviterName} convidou você para o ${orgName} no Scrumban`,
    html: `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Convite para ${orgName}</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h1 style="color: #1a73e8;">Você foi convidado!</h1>
  <p><strong>${inviterName}</strong> convidou você para colaborar em <strong>${orgName}</strong> no Scrumban.</p>
  <p>O Scrumban é uma plataforma de gestão de projetos e tarefas com automação por IA.</p>
  <div style="margin: 30px 0;">
    <a href="${inviteUrl}"
       style="background-color: #1a73e8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
      Aceitar Convite
    </a>
  </div>
  <p style="color: #666; font-size: 14px;">
    Se você não esperava este convite, pode ignorar este email com segurança.
  </p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="color: #999; font-size: 12px;">
    © ${new Date().getFullYear()} Scrumban. Todos os direitos reservados.
  </p>
</body>
</html>`,
    text: `Você foi convidado para o Scrumban!

${inviterName} convidou você para colaborar em ${orgName}.

Aceite o convite em:
${inviteUrl}

Se você não esperava este convite, ignore este email.`,
  };
}
