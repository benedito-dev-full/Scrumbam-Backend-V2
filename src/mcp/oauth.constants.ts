import type { ConfigService } from '@nestjs/config';

import { ALL_MCP_SCOPES } from './constants';

/**
 * Constantes e helpers OAuth 2.1 do MCP (Reforma 2 — Resource Server).
 *
 * O backend atua APENAS como Resource Server (RS): quem emite tokens é o
 * Auth0 (Authorization Server). Estas constantes só nomeiam as env vars de
 * config e resolvem o metadata público de discovery (RFC 9728).
 *
 * @see RFC 9728 (OAuth 2.0 Protected Resource Metadata)
 * @see MCP Authorization spec (2025-06-18)
 * @see ADR-V2-072 (OAuth 2.1 Resource-Server-only, Auth0 como AS)
 */

/**
 * Env var com o canonical resource URI do nosso MCP (o `aud`/`resource`,
 * RFC 8707). Ex.: `https://host/mcp`. É o `resource` anunciado no discovery
 * e o audience que os tokens Bearer terão de carregar (validado na F2).
 */
export const MCP_OAUTH_RESOURCE_URI_ENV = 'MCP_OAUTH_RESOURCE_URI' as const;

/**
 * Env var com o issuer do Authorization Server (tenant Auth0). Ex.:
 * `https://tenant.us.auth0.com/`. Anunciado em `authorization_servers` no
 * discovery para o Claude descobrir onde autorizar.
 */
export const MCP_OAUTH_ISSUER_ENV = 'MCP_OAUTH_ISSUER' as const;

/**
 * Env var (opcional) com a JWKS URI do Authorization Server (Auth0), de onde
 * o Resource Server baixa as chaves públicas RS256 para validar a assinatura
 * dos Bearer tokens.
 *
 * Se ausente, é derivada do issuer como `<issuer>.well-known/jwks.json`
 * (padrão Auth0). Uma env explícita permite apontar para um endpoint
 * customizado sem depender da convenção.
 */
export const MCP_OAUTH_JWKS_URI_ENV = 'MCP_OAUTH_JWKS_URI' as const;

/**
 * Nome do claim do JWT que carrega a identidade do sujeito autenticado.
 * Padrão OIDC/Auth0: `sub` (ex.: `auth0|abc123`). A identidade DEntidade
 * sintética é derivada deste claim (ver `McpBearerService`).
 */
export const MCP_OAUTH_SUBJECT_CLAIM = 'sub' as const;

/**
 * Nome do claim do JWT que carrega os scopes concedidos, como string
 * space-delimited (padrão OAuth2/Auth0: `scope`). Ex.: `"tasks:read tasks:write"`.
 */
export const MCP_OAUTH_SCOPE_CLAIM = 'scope' as const;

/**
 * Env var (booleana `'true'`) que liga o modo OAuth "hard-fail" no POST /mcp.
 *
 * Governa APENAS o caso "nenhuma credencial apresentada" (nem `Authorization:
 * Bearer` nem `X-MCP-Key`):
 *  - `'true'`  → responde 401 real + `WWW-Authenticate` (destrava o Claude Web,
 *    que precisa do 401 para descobrir o Authorization Server).
 *  - ausente/qualquer outro valor (DEFAULT OFF) → comportamento ATUAL: delega
 *    ao `McpKeyGuard` (soft-fail → `mcpAuthError` → JSON-RPC 200). Zero
 *    regressão para o Claude Code enquanto o deploy OAuth não está pronto.
 *
 * A flag NÃO afeta: (a) um Bearer presente é SEMPRE validado (válido → passa;
 * inválido → 401, mesmo com a flag OFF, pois o cliente tentou OAuth
 * explicitamente); (b) um `X-MCP-Key` presente segue o caminho legado
 * inalterado. O Claude Code manda `X-MCP-Key`, nunca `Authorization: Bearer` —
 * logo a semântica "Bearer inválido → 401" jamais o atinge.
 *
 * @see ADR-V2-072 (OAuth 2.1 Resource-Server-only, dual-auth aditivo)
 */
export const MCP_OAUTH_ENABLED_ENV = 'MCP_OAUTH_ENABLED' as const;

/**
 * Path (relativo à raiz da aplicação) do discovery de Protected Resource
 * Metadata (RFC 9728), servido por `WellKnownController`. O parâmetro
 * `resource_metadata` do header `WWW-Authenticate` aponta para a URL absoluta
 * composta por `<host do resource URI>` + este path.
 *
 * @see RFC 9728 (OAuth 2.0 Protected Resource Metadata)
 */
export const MCP_OAUTH_RESOURCE_METADATA_PATH =
  '/.well-known/oauth-protected-resource' as const;

/**
 * Lê a flag {@link MCP_OAUTH_ENABLED_ENV} e devolve `true` SOMENTE quando o
 * valor for exatamente `'true'` (após trim). Espelha o estilo tolerante do
 * `McpOriginGuard`/`McpEnabledGuard`: qualquer outro valor ⇒ desligado.
 *
 * @param configService - ConfigService do NestJS.
 * @returns `true` se o modo OAuth hard-fail estiver ligado.
 */
export function isMcpOAuthEnabled(configService: ConfigService): boolean {
  return configService.get<string>(MCP_OAUTH_ENABLED_ENV)?.trim() === 'true';
}

/**
 * Deriva a URL absoluta do resource metadata (RFC 9728) a partir do canonical
 * resource URI configurado (ex.: `https://host/mcp`). Extrai apenas o
 * `origin` (esquema + host + porta) e anexa
 * {@link MCP_OAUTH_RESOURCE_METADATA_PATH}, produzindo p.ex.
 * `https://host/.well-known/oauth-protected-resource`.
 *
 * Se o `resource` não for uma URL absoluta parseável, cai num fallback por
 * concatenação de string (best-effort) para nunca lançar — o header é
 * informativo e não deve quebrar o fluxo de auth.
 *
 * @param resource - Canonical resource URI (o `aud`/`resource`, RFC 8707).
 * @returns URL absoluta do resource metadata.
 */
export function deriveResourceMetadataUrl(resource: string): string {
  try {
    const origin = new URL(resource).origin;
    return `${origin}${MCP_OAUTH_RESOURCE_METADATA_PATH}`;
  } catch {
    const base = resource.endsWith('/') ? resource.slice(0, -1) : resource;
    return `${base}${MCP_OAUTH_RESOURCE_METADATA_PATH}`;
  }
}

/**
 * Monta o valor do header HTTP `WWW-Authenticate` (RFC 9728 / MCP Authorization
 * spec) que instrui o cliente a descobrir o Authorization Server via o resource
 * metadata. Formato:
 *
 *   `Bearer resource_metadata="<url>", scope="<s1> <s2> ..."`
 *
 * O parâmetro `scope` é OBRIGATÓRIO para o Claude Web: a doc oficial de
 * connectors da Anthropic afirma que o Claude lê os scopes a solicitar ao
 * Authorization Server a partir do parâmetro `scope` deste header no 401 — NÃO
 * do `scopes_supported` do discovery. Sem ele, o Claude registra/autoriza sem
 * os scopes da API (token sai com `scope: null`) e o handshake falha após o
 * login. Os scopes são os do catálogo canônico (ADR-V2-068).
 *
 * @param resourceMetadataUrl - URL absoluta do endpoint de discovery.
 * @param scopes - Scopes a anunciar (default: catálogo canônico completo).
 * @returns O valor pronto para `res.setHeader('WWW-Authenticate', ...)`.
 */
export function buildWwwAuthenticate(
  resourceMetadataUrl: string,
  scopes: readonly string[] = ALL_MCP_SCOPES,
): string {
  const scopeParam = scopes.length > 0 ? `, scope="${scopes.join(' ')}"` : '';
  return `Bearer resource_metadata="${resourceMetadataUrl}"${scopeParam}`;
}

/**
 * Métodos de apresentação do Bearer token suportados pelo RS (RFC 9728).
 * Só aceitamos o token no header `Authorization` — nunca em query string
 * ou corpo (menor superfície de vazamento).
 */
export const MCP_OAUTH_BEARER_METHODS: readonly string[] = ['header'] as const;

/**
 * `Cache-Control` do endpoint de discovery. O metadata é estático (derivado
 * de config), então um cache curto reduz round-trips sem arriscar servir
 * config obsoleta por muito tempo.
 */
export const MCP_OAUTH_DISCOVERY_CACHE_CONTROL = 'public, max-age=3600' as const;

/**
 * Configuração OAuth resolvida a partir das env vars. `null` em qualquer
 * campo obrigatório sinaliza "OAuth não configurado" — o discovery então
 * responde 404 (não anunciar um AS inexistente).
 */
export interface McpOAuthConfig {
  /** Canonical resource URI (o nosso `aud`/`resource`). */
  readonly resource: string;
  /** Issuer do Authorization Server (tenant Auth0). */
  readonly issuer: string;
}

/**
 * Lê as env vars OAuth via ConfigService e devolve a config resolvida.
 *
 * Retorna `null` quando `MCP_OAUTH_RESOURCE_URI` OU `MCP_OAUTH_ISSUER`
 * estiverem ausentes/vazias — o caller usa isso para responder 404 no
 * discovery (não anunciar Authorization Server inexistente) e para manter
 * o endpoint invisível enquanto a flag OAuth não é ligada em produção.
 *
 * @param configService - ConfigService do NestJS.
 * @returns A config resolvida, ou `null` se OAuth não estiver configurado.
 */
export function resolveMcpOAuthConfig(configService: ConfigService): McpOAuthConfig | null {
  const resource = configService.get<string>(MCP_OAUTH_RESOURCE_URI_ENV)?.trim();
  const issuer = configService.get<string>(MCP_OAUTH_ISSUER_ENV)?.trim();

  if (!resource || !issuer) {
    return null;
  }

  return { resource, issuer };
}

/**
 * Deriva a JWKS URI a partir do issuer, seguindo a convenção padrão do Auth0
 * (`<issuer>/.well-known/jwks.json`). Normaliza a barra final do issuer para
 * evitar `//` duplicado.
 *
 * @param issuer - Issuer do Authorization Server (ex.: `https://t.us.auth0.com/`).
 * @returns A JWKS URI derivada.
 */
function deriveJwksUri(issuer: string): string {
  const base = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
  return `${base}/.well-known/jwks.json`;
}

/**
 * Configuração completa para validação de Bearer tokens OAuth (Resource
 * Server). Estende {@link McpOAuthConfig} com a JWKS URI usada para baixar
 * as chaves públicas RS256 do Auth0.
 */
export interface McpBearerConfig {
  /** Issuer esperado do token (`iss`), tenant Auth0. */
  readonly issuer: string;
  /** Audience esperado do token (`aud`/`resource`, RFC 8707) = canonical URI. */
  readonly audience: string;
  /** JWKS URI de onde baixar as chaves públicas do AS. */
  readonly jwksUri: string;
}

/**
 * Lê as env vars OAuth e resolve a config de validação de Bearer token.
 *
 * Reutiliza {@link resolveMcpOAuthConfig} para obter `resource` (audience) e
 * `issuer`. A JWKS URI vem de {@link MCP_OAUTH_JWKS_URI_ENV} quando presente,
 * ou é derivada do issuer (padrão Auth0) caso contrário.
 *
 * Retorna `null` quando OAuth não está configurado (resource OU issuer
 * ausentes) — o caller trata isso como "OAuth desativado" (validação
 * devolve `null` sem crashar), preservando o comportamento aditivo.
 *
 * @param configService - ConfigService do NestJS.
 * @returns A config de Bearer resolvida, ou `null` se OAuth não configurado.
 */
export function resolveMcpBearerConfig(configService: ConfigService): McpBearerConfig | null {
  const oauth = resolveMcpOAuthConfig(configService);
  if (!oauth) {
    return null;
  }

  const explicitJwks = configService.get<string>(MCP_OAUTH_JWKS_URI_ENV)?.trim();
  const jwksUri = explicitJwks && explicitJwks.length > 0 ? explicitJwks : deriveJwksUri(oauth.issuer);

  return {
    issuer: oauth.issuer,
    audience: oauth.resource,
    jwksUri,
  };
}
