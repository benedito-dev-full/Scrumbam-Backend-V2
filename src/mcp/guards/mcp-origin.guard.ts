import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { MCP_ALLOWED_ORIGINS_ENV } from '../constants';

/**
 * Guard anti DNS-rebinding para o endpoint POST /mcp (transporte Streamable
 * HTTP, spec MCP `2025-03-26`).
 *
 * Valida o header `Origin` contra uma allow-list configurada via env var
 * {@link MCP_ALLOWED_ORIGINS_ENV} (CSV). Comportamento intencionalmente
 * tolerante ao Claude Code e a ambientes ainda não configurados:
 *
 *  1. `Origin` AUSENTE           → PERMITE (clientes não-browser como o
 *     Claude Code nunca enviam `Origin`; a spec só exige validar quando
 *     o header ESTÁ presente).
 *  2. `Origin` presente + na lista → PERMITE.
 *  3. `Origin` presente + fora     → REJEITA com `ForbiddenException` (HTTP
 *     403). É violação de TRANSPORTE, não erro JSON-RPC — hard fail, ao
 *     contrário do `McpKeyGuard` que faz soft-fail.
 *  4. Allow-list vazia/ausente     → FAIL-OPEN: permite tudo e emite
 *     `logger.warn` avisando que a validação está desativada.
 *
 * O guard é ORTOGONAL à autenticação: NUNCA inspeciona `X-MCP-Key`.
 *
 * @see ADR-V2-071 (transporte Streamable HTTP aditivo)
 */
@Injectable()
export class McpOriginGuard implements CanActivate {
  private readonly logger = new Logger(McpOriginGuard.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Decide se a request pode prosseguir com base no header `Origin`.
   *
   * @param context - Contexto de execução do NestJS (HTTP).
   * @returns `true` quando a request é permitida.
   * @throws {ForbiddenException} Quando `Origin` está presente mas fora da
   *   allow-list configurada (HTTP 403).
   */
  canActivate(context: ExecutionContext): boolean {
    const allowList = this.parseAllowList();

    // Fail-open: allow-list não configurada. Não trava ambientes novos.
    if (allowList.length === 0) {
      this.logger.warn(
        `Validação de Origin do MCP desativada (${MCP_ALLOWED_ORIGINS_ENV} não configurada) — permitindo qualquer Origin`,
      );
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const rawOrigin = request.headers?.origin;
    const origin = typeof rawOrigin === 'string' ? rawOrigin.trim() : undefined;

    // Origin ausente → SEMPRE permite (cenário do Claude Code / não-browser).
    if (!origin) {
      return true;
    }

    if (allowList.includes(origin)) {
      return true;
    }

    this.logger.warn(`Origin não permitida rejeitada pelo MCP: ${origin}`);
    throw new ForbiddenException('Origin not allowed');
  }

  /**
   * Parseia a env var CSV em uma lista de origens normalizadas (trim, sem
   * entradas vazias). Vazia/ausente ⇒ `[]` (sinaliza fail-open ao caller).
   */
  private parseAllowList(): string[] {
    const raw = this.configService.get<string>(MCP_ALLOWED_ORIGINS_ENV);
    if (!raw) {
      return [];
    }

    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
}
