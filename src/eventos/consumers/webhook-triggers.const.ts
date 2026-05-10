const WEBHOOK_ALLOWED_PREFIXES = ['task.', 'project.', 'org.', 'execution.'] as const;

const WEBHOOK_BLOCKED_PREFIXES = [
  'system.',
  'webhook.',
  'agent.',
  'mcp.',
  'telegram.',
  'email.',
  'user.login.',
] as const;

/**
 * Verifica se um tipo canonico pode acionar webhooks outbound.
 */
export function isWebhookTrigger(type: string): boolean {
  if (WEBHOOK_BLOCKED_PREFIXES.some((prefix) => type.startsWith(prefix))) {
    return false;
  }

  return WEBHOOK_ALLOWED_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/**
 * Verifica se um padrao de config casa com o tipo de evento.
 *
 * Padroes aceitos:
 *  - `*`
 *  - `task.*`
 *  - `task.created`
 */
export function matchesWebhookEventPattern(pattern: string, eventType: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1);
    return eventType.startsWith(prefix);
  }
  return pattern === eventType;
}
