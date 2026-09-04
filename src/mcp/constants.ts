export const MCP_KEY_CLASS_ID = BigInt(-472);

// ─── Catálogo canônico de scopes MCP per-tool (ADR-V2-068) ──────────────────

/**
 * Catálogo canônico de scopes MCP. Cada scope mapeia para um grupo de tools
 * com semântica homogênea (leitura / escrita / execução de IA).
 *
 * Regra de associação tool→scope definida em ADR-V2-068:
 *  - `tasks:read`          → tools de listagem/leitura de tasks e projetos
 *  - `tasks:write`         → tools de mutação de tasks (criar, atualizar, timer)
 *  - `notifications:read`  → tools de leitura de notificações
 *  - `notifications:write` → tools de mutação de notificações
 *  - `projects:write`      → tools de mutação de projetos
 *  - `executions:create`   → tool de disparo de execução Claude Code (IA)
 *
 * @see ADR-V2-068 (scope catalog + privilege escalation prevention)
 * @see ADR-V2-067 (origem de `executions:create`)
 */
export const MCP_SCOPES = {
  TASKS_READ: 'tasks:read',
  TASKS_WRITE: 'tasks:write',
  NOTIFICATIONS_READ: 'notifications:read',
  NOTIFICATIONS_WRITE: 'notifications:write',
  PROJECTS_WRITE: 'projects:write',
  EXECUTIONS_CREATE: 'executions:create',
} as const;

export type McpScope = (typeof MCP_SCOPES)[keyof typeof MCP_SCOPES];

export const ALL_MCP_SCOPES: McpScope[] = Object.values(MCP_SCOPES);

/**
 * Presets de conjuntos de scopes para facilitar a criação de keys MCP.
 * Usados pelo frontend no modal "Gerar chave MCP" (ADR-V2-068 Fase 4).
 *
 * - READ_ONLY: leitura de tasks + notificações (dashboards externos)
 * - READ_WRITE: leitura + escrita de tasks/notificações (bots de produtividade)
 * - FULL_ACCESS: todos os scopes (automação completa — queima tokens de IA)
 */
export const MCP_SCOPE_PRESETS = {
  READ_ONLY: [MCP_SCOPES.TASKS_READ, MCP_SCOPES.NOTIFICATIONS_READ] as McpScope[],
  READ_WRITE: [
    MCP_SCOPES.TASKS_READ,
    MCP_SCOPES.TASKS_WRITE,
    MCP_SCOPES.NOTIFICATIONS_READ,
    MCP_SCOPES.NOTIFICATIONS_WRITE,
  ] as McpScope[],
  FULL_ACCESS: ALL_MCP_SCOPES,
} as const;

export const MCP_CALL_EVENT_CLASS_ID = BigInt(-495);

export const MCP_KEY_CACHE_TTL_SECONDS = 30;

export const MCP_RATE_LIMIT_WINDOW_SECONDS = 60;

export const MCP_RATE_LIMIT_MAX_REQUESTS = 60;

/**
 * Versao default do protocolo MCP (devolvida quando a versao pedida pelo
 * cliente for desconhecida ou ausente). Mantida como `2024-11-05` para
 * preservar o handshake do Claude Code (back-compat).
 */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * Allow-list de versoes de protocolo MCP suportadas pelo servidor.
 *
 * No `initialize`, se o cliente pedir uma versao presente nesta lista,
 * o servidor ecoa exatamente essa string. Caso contrario (ausente ou
 * fora da lista), devolve {@link MCP_PROTOCOL_VERSION} (default).
 *
 * NUNCA se ecoa uma string arbitraria vinda do cliente — apenas valores
 * desta allow-list.
 *
 * @see ADR-V2-071 (transporte Streamable HTTP aditivo)
 */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export type McpSupportedProtocolVersion = (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number];

/**
 * Códigos HTTP usados no envelope do transporte Streamable HTTP do MCP.
 *
 * - `HTTP_STATUS_OK` (200): resposta padrão quando o body contém ≥1 request
 *   (JSON-RPC com `id`), devolvendo `application/json`.
 * - `HTTP_STATUS_ACCEPTED` (202): body composto SÓ por notifications/responses
 *   (nenhum request) — responde sem corpo, conforme spec MCP `2025-03-26`.
 *
 * @see ADR-V2-071 (transporte Streamable HTTP aditivo)
 */
export const HTTP_STATUS_OK = 200;

export const HTTP_STATUS_ACCEPTED = 202;

/**
 * Nome da env var (CSV) com a allow-list de `Origin` aceitas pelo POST /mcp.
 *
 * Anti DNS-rebinding (spec MCP Streamable HTTP 2025-03-26): quando um cliente
 * browser envia o header `Origin`, o servidor SÓ deve processar a request se
 * essa origem estiver explicitamente autorizada. Clientes não-browser (Claude
 * Code) NÃO enviam `Origin` — esses SEMPRE passam.
 *
 * Formato: CSV de origens absolutas, ex.:
 *   `MCP_ALLOWED_ORIGINS=https://app.exemplo.com,http://localhost:3000`
 *
 * Vazia/não-configurada ⇒ fail-open (permite tudo + `logger.warn`), para não
 * travar ambientes ainda não configurados.
 *
 * @see ADR-V2-071 (transporte Streamable HTTP aditivo)
 */
export const MCP_ALLOWED_ORIGINS_ENV = 'MCP_ALLOWED_ORIGINS';

export const MCP_SERVER_NAME = 'scrumban-mcp';

export const MCP_SERVER_VERSION = '1.0.0';

export const MCP_JSON_RPC_VERSION = '2.0';

export const MCP_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  RATE_LIMIT_EXCEEDED: -32000,
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32002,
  REQUEST_TIMEOUT: -32003,
  NOT_FOUND: -32004,
} as const;
