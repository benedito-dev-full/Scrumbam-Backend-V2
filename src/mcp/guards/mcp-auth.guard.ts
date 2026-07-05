import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import { McpAuthenticatedRequest } from '../interfaces/mcp.types';
import {
  buildWwwAuthenticate,
  deriveResourceMetadataUrl,
  isMcpOAuthEnabled,
  resolveMcpOAuthConfig,
} from '../oauth.constants';
import { McpBearerService } from '../services/mcp-bearer.service';
import { McpKeyGuard } from './mcp-key.guard';

/**
 * Prefixo do esquema Bearer no header `Authorization` (case-insensitive na
 * detecção; o token é o restante após o prefixo).
 */
const BEARER_PREFIX = 'bearer ';

/**
 * Guard **dual-auth** do POST /mcp (Reforma 2 — F4). Substitui o `McpKeyGuard`
 * na cadeia do endpoint e implementa a política de autenticação INTEIRA,
 * escolhendo, por request, entre dois caminhos mutuamente exclusivos:
 *
 *  1. **`Authorization: Bearer <jwt>` presente** → caminho OAuth. Valida via
 *     {@link McpBearerService}. Válido → popula `request.userCtx` e passa.
 *     Inválido/expirado/`aud` errado → **401 real + `WWW-Authenticate`**
 *     (hard-fail, ANTES do fluxo JSON-RPC). Um Bearer NUNCA cai no caminho
 *     X-MCP-Key.
 *
 *  2. **Sem Bearer, com `X-MCP-Key`** → caminho legado. **Delega literalmente**
 *     ao {@link McpKeyGuard} (soft-fail preservado: popula `userCtx` OU
 *     `mcpAuthError`, retorna `true` → JSON-RPC 200). O Claude Code fica
 *     IDÊNTICO ao de hoje — este guard NÃO reimplementa a validação de chave.
 *
 *  3. **Nenhuma credencial** (nem Bearer nem X-MCP-Key):
 *     - flag {@link isMcpOAuthEnabled} = `true` → **401 + `WWW-Authenticate`**
 *       (destrava o Claude Web, que precisa do 401 para descobrir o AS).
 *     - flag OFF (DEFAULT) → **comportamento ATUAL**: delega ao `McpKeyGuard`
 *       (soft-fail → `mcpAuthError` → JSON-RPC 200). SEM 401.
 *
 * **INVARIANTE de back-compat:** com a flag OFF, o comportamento observável é
 * idêntico ao de hoje para QUALQUER input que não seja um `Authorization:
 * Bearer` (o Claude Code manda `X-MCP-Key`, nunca Bearer). Um Bearer inválido
 * resulta em 401 mesmo com a flag OFF — mas isso só atinge clientes que
 * explicitamente tentaram OAuth, jamais o Claude Code.
 *
 * O guard roda DEPOIS do `McpOriginGuard` na cadeia (`McpEnabledGuard,
 * McpOriginGuard, McpAuthGuard`) — a validação de Origin é ortogonal e precede
 * a autenticação.
 *
 * @see ADR-V2-072 (OAuth 2.1 Resource-Server-only, dual-auth aditivo)
 */
@Injectable()
export class McpAuthGuard implements CanActivate {
  private readonly logger = new Logger(McpAuthGuard.name);

  constructor(
    private readonly bearerService: McpBearerService,
    private readonly mcpKeyGuard: McpKeyGuard,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Aplica a política dual-auth descrita na doc da classe.
   *
   * @param context - Contexto de execução do NestJS (HTTP).
   * @returns `true` quando a request pode prosseguir (Bearer válido, ou
   *   delegação ao caminho X-MCP-Key legado).
   * @throws {UnauthorizedException} Bearer inválido, OU nenhuma credencial com
   *   a flag `MCP_OAUTH_ENABLED=true`. Acompanha o header `WWW-Authenticate`
   *   quando o resource metadata é resolvível.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<McpAuthenticatedRequest>();

    const bearerToken = this.extractBearerToken(request);

    // ─── Caminho 1: Bearer presente → SEMPRE valida (independe da flag) ─────
    if (bearerToken !== null) {
      const userCtx = await this.bearerService.validate(bearerToken);
      if (userCtx) {
        request.userCtx = userCtx;
        return true;
      }
      // Bearer inválido/expirado/aud errado: hard-fail 401. NÃO cai no
      // caminho X-MCP-Key (invariante). Atinge só quem tentou OAuth.
      this.logger.debug('Bearer inválido — 401 + WWW-Authenticate');
      this.throwUnauthorized(context);
    }

    // ─── Caminho 2: sem Bearer, com X-MCP-Key → delega ao McpKeyGuard ───────
    if (this.hasMcpKeyHeader(request)) {
      return this.mcpKeyGuard.canActivate(context);
    }

    // ─── Caminho 3: nenhuma credencial ──────────────────────────────────────
    if (isMcpOAuthEnabled(this.configService)) {
      // OAuth ligado → 401 real para o Claude Web descobrir o AS.
      this.logger.debug('Sem credencial + OAuth ON — 401 + WWW-Authenticate');
      this.throwUnauthorized(context);
    }

    // Flag OFF (default): comportamento atual — delega ao McpKeyGuard, que faz
    // soft-fail (stasha mcpAuthError, retorna true → JSON-RPC 200). Zero
    // regressão para o Claude Code.
    return this.mcpKeyGuard.canActivate(context);
  }

  /**
   * Extrai o JWT cru do header `Authorization: Bearer <jwt>` (prefixo
   * case-insensitive). Devolve `null` quando o header está ausente ou não é
   * um Bearer — sinalizando "sem Bearer" ao caller.
   *
   * @param request - Request autenticada do MCP.
   * @returns O token (sem o prefixo), ou `null` se não houver Bearer.
   */
  private extractBearerToken(request: McpAuthenticatedRequest): string | null {
    const raw = request.headers?.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!header || typeof header !== 'string') {
      return null;
    }
    if (header.toLowerCase().startsWith(BEARER_PREFIX)) {
      const token = header.slice(BEARER_PREFIX.length).trim();
      return token.length > 0 ? token : null;
    }
    return null;
  }

  /**
   * Indica se a request traz o header `X-MCP-Key` (independente de validade —
   * a validação fica a cargo do `McpKeyGuard` delegado).
   *
   * @param request - Request autenticada do MCP.
   * @returns `true` se `x-mcp-key` está presente e não-vazio.
   */
  private hasMcpKeyHeader(request: McpAuthenticatedRequest): boolean {
    const raw = request.headers?.['x-mcp-key'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    return typeof header === 'string' && header.length > 0;
  }

  /**
   * Lança `UnauthorizedException` (HTTP 401) anexando o header
   * `WWW-Authenticate: Bearer resource_metadata="<url>"` na resposta quando o
   * resource metadata é resolvível a partir da config OAuth.
   *
   * Se OAuth não estiver configurado (sem `MCP_OAUTH_RESOURCE_URI`), não há
   * `resource_metadata` para anunciar — o header é omitido, mas o 401 ainda é
   * lançado (o caso "sem config + flag ON" é misconfig; tratamos
   * defensivamente sem crashar).
   *
   * @param context - Contexto de execução (para acessar o Response).
   * @throws {UnauthorizedException} Sempre.
   */
  private throwUnauthorized(context: ExecutionContext): never {
    const oauthConfig = resolveMcpOAuthConfig(this.configService);
    if (oauthConfig) {
      const url = deriveResourceMetadataUrl(oauthConfig.resource);
      const response = context.switchToHttp().getResponse<Response>();
      response.setHeader('WWW-Authenticate', buildWwwAuthenticate(url));
    } else {
      this.logger.warn(
        'OAuth não configurado (MCP_OAUTH_RESOURCE_URI ausente) — 401 sem header WWW-Authenticate',
      );
    }
    throw new UnauthorizedException('Unauthorized');
  }
}
