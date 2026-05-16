/**
 * Schema para o campo `dados` (Json) de DProject.
 *
 * Armazena metadados polimórficos do projeto:
 * - prefix: prefixo do identifier de tasks (ex: "DEV")
 * - description: descrição estendida do projeto
 * - automationEnabled: se automação Claude Code está ativa
 * - agentId: DEntidade -156 AGENT vinculado
 * - webhookSecret: segredo para webhooks HMAC
 * - apiKeyId: chave da DTabela API key
 * - telegramChatId: chat ID Telegram para notificações
 *
 * NOTA: `gitRepo` foi removido como campo de escrita (ADR-V2-043).
 * A URL do repositório git é armazenada exclusivamente na coluna
 * `DProject.repoUrl`. Registros históricos podem conter `dados.gitRepo`
 * mas ele é ignorado na leitura — `repoUrl` é a fonte de verdade.
 *
 * @example
 * ```typescript
 * const dados: ProjectDados = {
 *   prefix: 'FEAT',
 *   automationEnabled: true,
 * };
 * ```
 */
export interface ProjectDados {
  prefix?: string;
  description?: string;
  automationEnabled?: boolean;
  agentId?: string;
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
  // NOTA: `data.gitRepo` pode existir em registros históricos mas é
  // intencionalmente ignorado aqui — `DProject.repoUrl` é a fonte de verdade.
  return {
    prefix: typeof data.prefix === 'string' ? data.prefix : undefined,
    description: typeof data.description === 'string' ? data.description : undefined,
    automationEnabled:
      typeof data.automationEnabled === 'boolean' ? data.automationEnabled : false,
    agentId: typeof data.agentId === 'string' ? data.agentId : undefined,
    webhookSecret: typeof data.webhookSecret === 'string' ? data.webhookSecret : undefined,
    apiKeyId: typeof data.apiKeyId === 'string' ? data.apiKeyId : undefined,
    telegramChatId:
      typeof data.telegramChatId === 'string' ? data.telegramChatId : undefined,
  };
}
