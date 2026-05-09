/**
 * Schema para o campo `dados` (Json) de DProject.
 *
 * Armazena metadados polimórficos do projeto:
 * - prefix: prefixo do identifier de tasks (ex: "DEV")
 * - description: descrição estendida do projeto
 * - automationEnabled: se automação Claude Code está ativa
 * - agentId: DEntidade -156 AGENT vinculado
 * - gitRepo: URL do repositório git
 * - webhookSecret: segredo para webhooks HMAC
 * - apiKeyId: chave da DTabela API key
 * - telegramChatId: chat ID Telegram para notificações
 *
 * @example
 * ```typescript
 * const dados: ProjectDados = {
 *   prefix: 'FEAT',
 *   automationEnabled: true,
 *   gitRepo: 'https://github.com/org/repo',
 * };
 * ```
 */
export interface ProjectDados {
  prefix?: string;
  description?: string;
  automationEnabled?: boolean;
  agentId?: string;
  gitRepo?: string;
  webhookSecret?: string;
  apiKeyId?: string;
  telegramChatId?: string;
}

/**
 * Parse seguro de dados de projeto a partir de um valor Json bruto.
 *
 * @param raw - Valor bruto do campo Json do Prisma
 * @returns ProjectDados com valores padrão
 */
export function parseProjectDados(raw: unknown): ProjectDados {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { automationEnabled: false };
  }
  const data = raw as Record<string, unknown>;
  return {
    prefix: typeof data.prefix === 'string' ? data.prefix : undefined,
    description: typeof data.description === 'string' ? data.description : undefined,
    automationEnabled:
      typeof data.automationEnabled === 'boolean' ? data.automationEnabled : false,
    agentId: typeof data.agentId === 'string' ? data.agentId : undefined,
    gitRepo: typeof data.gitRepo === 'string' ? data.gitRepo : undefined,
    webhookSecret: typeof data.webhookSecret === 'string' ? data.webhookSecret : undefined,
    apiKeyId: typeof data.apiKeyId === 'string' ? data.apiKeyId : undefined,
    telegramChatId:
      typeof data.telegramChatId === 'string' ? data.telegramChatId : undefined,
  };
}
