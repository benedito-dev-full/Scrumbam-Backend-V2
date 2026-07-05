import { Controller, Get, Header, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ALL_MCP_SCOPES } from './constants';
import { OAuthProtectedResourceDto } from './dto/oauth-protected-resource.dto';
import {
  MCP_OAUTH_BEARER_METHODS,
  MCP_OAUTH_DISCOVERY_CACHE_CONTROL,
  resolveMcpOAuthConfig,
} from './oauth.constants';

/**
 * Discovery público de OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * Serve `GET /.well-known/oauth-protected-resource` — SEM guards de auth ou
 * de MCP-enabled — para que o Claude Web descubra o Authorization Server
 * (Auth0) e os scopes deste Resource Server.
 *
 * Usa `@Controller()` com prefixo vazio de propósito: o path well-known vive
 * na raiz da aplicação (RFC 9728 exige o path exato), NÃO sob `/mcp`.
 *
 * Comportamento condicionado à config OAuth:
 *  - Envs OAuth presentes → 200 + JSON de metadata.
 *  - Envs OAuth ausentes  → 404, para não anunciar um AS inexistente (mantém
 *    o endpoint invisível enquanto a flag OAuth não é ligada em produção).
 *
 * @see RFC 9728 (OAuth 2.0 Protected Resource Metadata)
 * @see MCP Authorization spec (2025-06-18)
 * @see ADR-V2-072 (OAuth 2.1 Resource-Server-only)
 */
@ApiTags('MCP')
@Controller()
export class WellKnownController {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Retorna o OAuth Protected Resource Metadata (RFC 9728).
   *
   * Endpoint público de discovery: não exige nenhum header nem credencial.
   * Os valores são derivados de config (`MCP_OAUTH_RESOURCE_URI`,
   * `MCP_OAUTH_ISSUER`) + `ALL_MCP_SCOPES` (ADR-V2-068).
   *
   * @returns O metadata de discovery quando OAuth está configurado.
   * @throws {NotFoundException} Quando as env vars OAuth estão ausentes
   *   (não anunciar um Authorization Server inexistente).
   *
   * @example
   * ```bash
   * curl -X GET "https://host/.well-known/oauth-protected-resource"
   * ```
   */
  @Get('.well-known/oauth-protected-resource')
  @Header('Cache-Control', MCP_OAUTH_DISCOVERY_CACHE_CONTROL)
  @ApiOperation({
    summary: 'OAuth Protected Resource Metadata (RFC 9728)',
    description:
      'Discovery público que anuncia o Authorization Server (Auth0) e os scopes do MCP. 404 quando OAuth não está configurado.',
  })
  @ApiResponse({
    status: 200,
    description: 'Metadata de discovery',
    type: OAuthProtectedResourceDto,
  })
  @ApiResponse({ status: 404, description: 'OAuth não configurado (envs ausentes)' })
  getProtectedResourceMetadata(): OAuthProtectedResourceDto {
    const oauthConfig = resolveMcpOAuthConfig(this.configService);

    if (!oauthConfig) {
      throw new NotFoundException('OAuth protected resource metadata not available');
    }

    return {
      resource: oauthConfig.resource,
      authorization_servers: [oauthConfig.issuer],
      scopes_supported: [...ALL_MCP_SCOPES],
      bearer_methods_supported: [...MCP_OAUTH_BEARER_METHODS],
    };
  }
}
