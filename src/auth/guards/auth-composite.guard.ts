import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { McpKeyGuard } from './mcp-key.guard';
import { ApiKeyGuard } from './api-key.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Guard de composição OR: tenta 3 mecanismos de autenticação em ordem.
 *
 * Ordem de avaliação (Decisão D1 — ADR-V2-003):
 *   1. MCP Key (X-MCP-Key header) — mais específico (contexto de ferramenta MCP)
 *   2. API Key (X-API-Key header) — contexto de automação/integração
 *   3. JWT Bearer (Authorization header) — sessão de usuário padrão
 *
 * Comportamento:
 * - Se rota tem @Public(): retorna true sem tentar nenhum mecanismo
 * - Se qualquer mecanismo passar: retorna true (OR logic)
 * - Se TODOS falharem: lança UnauthorizedException (ÚNICA exceção do módulo auth)
 *
 * REGRA CRÍTICA: Os guards internos (McpKeyGuard, ApiKeyGuard, JwtAuthGuard)
 * NÃO lançam exceções — retornam apenas boolean. Apenas ESTE guard lança.
 *
 * @see McpKeyGuard, ApiKeyGuard, JwtAuthGuard — guards internos (sem lançar)
 * @see IS_PUBLIC_KEY — bypass completo para rotas públicas
 */
@Injectable()
export class AuthCompositeGuard implements CanActivate {
  private readonly logger = new Logger(AuthCompositeGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly mcpKeyGuard: McpKeyGuard,
    private readonly apiKeyGuard: ApiKeyGuard,
    private readonly jwtAuthGuard: JwtAuthGuard,
  ) {}

  /**
   * Tenta autenticar via MCP Key → API Key → JWT (OR logic).
   *
   * Lança UnauthorizedException somente se TODOS falharem.
   *
   * @param context - Contexto de execução NestJS
   * @returns true se qualquer mecanismo autenticou com sucesso
   * @throws {UnauthorizedException} Se nenhum mecanismo passou
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Verificar @Public() — bypass completo
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      this.logger.debug('Rota pública — bypass AuthCompositeGuard');
      return true;
    }

    // Tentar MCP Key (1º — mais específico: contexto de ferramenta MCP)
    try {
      const mcpResult = await this.mcpKeyGuard.canActivate(context);
      if (mcpResult) {
        this.logger.debug('Autenticado via MCP Key');
        return true;
      }
    } catch {
      // Guard interno falhou — tentar próximo
    }

    // Tentar API Key (2º — contexto de automação/integração)
    try {
      const apiKeyResult = await this.apiKeyGuard.canActivate(context);
      if (apiKeyResult) {
        this.logger.debug('Autenticado via API Key');
        return true;
      }
    } catch {
      // Guard interno falhou — tentar próximo
    }

    // Tentar JWT Bearer (3º — sessão de usuário padrão)
    try {
      const jwtResult = await this.jwtAuthGuard.canActivate(context);
      const request = context.switchToHttp().getRequest<Record<string, unknown>>();

      // JwtAuthGuard pode retornar true mas com req.user=null (token inválido)
      // Verificar se req.user foi populado
      if (jwtResult && request['user']) {
        this.logger.debug('Autenticado via JWT');
        request['authMethod'] = 'jwt';
        return true;
      }
    } catch {
      // JWT inválido — cai para o throw abaixo
    }

    // Todos os mecanismos falharam — AuthCompositeGuard é o ÚNICO que lança
    this.logger.debug('Todos os mecanismos de auth falharam — 401');
    throw new UnauthorizedException('Autenticação necessária: forneça JWT Bearer, X-API-Key ou X-MCP-Key');
  }
}
