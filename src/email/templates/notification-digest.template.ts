/**
 * Item de notificação para o digest.
 */
export interface DigestNotification {
  /** Título da notificação. */
  title: string;
  /** Corpo/descrição da notificação. */
  body: string;
}

/**
 * Template de email de digest de notificações.
 *
 * Enviado periodicamente (diário/semanal) agrupando múltiplas notificações
 * para o usuário. Reduz o volume de emails enviados individualmente.
 *
 * @param data - Dados para renderizar o template
 * @returns Objeto com `subject`, `html` e `text`
 *
 * @example
 * ```typescript
 * const email = notificationDigestTemplate({
 *   userName: 'João Silva',
 *   notifications: [
 *     { title: 'Nova tarefa atribuída', body: 'Você recebeu a tarefa "Revisar PR #42"' },
 *     { title: 'Sprint finalizado', body: 'Sprint "Sprint 12" foi concluído com 8/10 tarefas' },
 *   ],
 * });
 * ```
 */
export function notificationDigestTemplate(data: {
  userName: string;
  notifications: DigestNotification[];
}): { subject: string; html: string; text: string } {
  const { userName, notifications } = data;
  const count = notifications.length;

  const notificationsHtml = notifications
    .map(
      (n) => `
    <li style="margin-bottom: 16px; padding: 12px; background: #f8f9fa; border-radius: 4px; border-left: 3px solid #1a73e8;">
      <strong style="color: #1a73e8;">${n.title}</strong>
      <p style="margin: 4px 0 0; color: #555;">${n.body}</p>
    </li>`,
    )
    .join('');

  const notificationsText = notifications
    .map((n) => `• ${n.title}\n  ${n.body}`)
    .join('\n\n');

  return {
    subject: `${count} ${count === 1 ? 'notificação' : 'notificações'} pendente${count === 1 ? '' : 's'} — Scrumban`,
    html: `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Digest de Notificações</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h1 style="color: #1a73e8;">Suas Notificações</h1>
  <p>Olá, ${userName}! Você tem <strong>${count} ${count === 1 ? 'notificação' : 'notificações'}</strong> ${count === 1 ? 'pendente' : 'pendentes'}:</p>
  <ul style="list-style: none; padding: 0; margin: 20px 0;">
    ${notificationsHtml}
  </ul>
  <p style="color: #666; font-size: 14px;">
    Para gerenciar suas notificações, acesse as configurações do seu perfil.
  </p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="color: #999; font-size: 12px;">
    © ${new Date().getFullYear()} Scrumban. Todos os direitos reservados.
  </p>
</body>
</html>`,
    text: `Suas Notificações — Scrumban

Olá, ${userName}! Você tem ${count} ${count === 1 ? 'notificação pendente' : 'notificações pendentes'}:

${notificationsText}

Acesse o Scrumban para gerenciar suas notificações.`,
  };
}
