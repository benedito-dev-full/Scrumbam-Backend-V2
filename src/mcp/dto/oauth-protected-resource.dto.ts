import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO do discovery `GET /.well-known/oauth-protected-resource`
 * (OAuth 2.0 Protected Resource Metadata — RFC 9728).
 *
 * Metadata público que anuncia, para o Claude Web, qual é o nosso canonical
 * resource URI, qual Authorization Server (Auth0) emite tokens para ele, os
 * scopes suportados (ADR-V2-068) e como o Bearer token deve ser apresentado.
 *
 * Todos os valores são derivados de config (env vars + `ALL_MCP_SCOPES`).
 *
 * @see RFC 9728 (OAuth 2.0 Protected Resource Metadata)
 * @see MCP Authorization spec (2025-06-18)
 * @see ADR-V2-068 (catálogo de scopes MCP)
 *
 * @example
 * ```json
 * {
 *   "resource": "https://host/mcp",
 *   "authorization_servers": ["https://tenant.us.auth0.com/"],
 *   "scopes_supported": ["tasks:read", "tasks:write", "notifications:read",
 *     "notifications:write", "projects:write", "executions:create"],
 *   "bearer_methods_supported": ["header"]
 * }
 * ```
 */
export class OAuthProtectedResourceDto {
  /**
   * Canonical resource URI deste Resource Server (o `aud`/`resource` que os
   * tokens Bearer devem carregar — RFC 8707). Derivado de
   * `MCP_OAUTH_RESOURCE_URI`.
   */
  @ApiProperty({
    description: 'Canonical resource URI deste Resource Server (o aud dos tokens)',
    example: 'https://host/mcp',
  })
  resource!: string;

  /**
   * Lista de issuers dos Authorization Servers que emitem tokens para este
   * recurso. Contém o tenant Auth0 (derivado de `MCP_OAUTH_ISSUER`).
   */
  @ApiProperty({
    description: 'Issuers dos Authorization Servers (tenant Auth0)',
    example: ['https://tenant.us.auth0.com/'],
    type: [String],
  })
  authorization_servers!: string[];

  /**
   * Scopes OAuth suportados por este recurso, espelhando o catálogo canônico
   * do MCP (ADR-V2-068).
   */
  @ApiProperty({
    description: 'Scopes OAuth suportados (catálogo ADR-V2-068)',
    example: [
      'tasks:read',
      'tasks:write',
      'notifications:read',
      'notifications:write',
      'projects:write',
      'executions:create',
    ],
    type: [String],
  })
  scopes_supported!: string[];

  /**
   * Métodos de apresentação do Bearer token aceitos. Sempre `["header"]` —
   * o token só é aceito no header `Authorization`.
   */
  @ApiProperty({
    description: 'Métodos de apresentação do Bearer token (só header)',
    example: ['header'],
    type: [String],
  })
  bearer_methods_supported!: string[];
}
