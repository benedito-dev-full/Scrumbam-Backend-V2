import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { McpKeyGuard } from './mcp-key.guard';
import { ApiKeyGuard } from './api-key.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RequireWorkspaceGuard } from './require-workspace.guard';
import { OrgTenantGuard } from './org-tenant.guard';

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
 * Após autenticar, este guard invoca em ordem (defense-in-depth, ADR-V2-042):
 *  1. `RequireWorkspaceGuard` — bloqueia JWT orfao em rota tenant-scoped.
 *  2. `OrgTenantGuard` — valida isolamento multi-tenant (path param / project).
 *
 * Por que invocar internamente em vez de registrar como APP_GUARD?
 * - NestJS executa APP_GUARDs ANTES dos guards de controller — `req.user`
 *   ficaria indefinido. Encadear aqui garante ordem correta.
 *
 * @see McpKeyGuard, ApiKeyGuard, JwtAuthGuard — guards internos (sem lançar)
 * @see IS_PUBLIC_KEY — bypass completo para rotas públicas
 * @see RequireWorkspaceGuard — defesa #1 (orphan workspace)
 * @see OrgTenantGuard — defesa #2 (tenant isolation HTTP layer)
 */
@Injectable()
export class AuthCompositeGuard implements CanActivate {
  private readonly logger = new Logger(AuthCompositeGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly mcpKeyGuard: McpKeyGuard,
    private readonly apiKeyGuard: ApiKeyGuard,
    private readonly jwtAuthGuard: JwtAuthGuard,
    private readonly requireWorkspaceGuard: RequireWorkspaceGuard,
    private readonly orgTenantGuard: OrgTenantGuard,
  ) {}

  /**
   * Tenta autenticar via MCP Key → API Key → JWT (OR logic).
   *
   * Lança UnauthorizedException somente se TODOS falharem.
   *
   * Após autenticar com sucesso, invoca o `RequireWorkspaceGuard` para
   * bloquear rotas tenant-scoped quando o JWT está órfão (sem
   * `organizationId`) e a rota não tem `@AllowOrphan()` — ADR-V2-038.
   *
   * Em seguida invoca `OrgTenantGuard` para validar isolamento multi-tenant
   * em rotas com path param de projeto (`PROJECT_ESTAB`) ou de org
   * (`PATH_PARAM`) — ADR-V2-042.
   *
   * @param context - Contexto de execução NestJS
   * @returns true se qualquer mecanismo autenticou com sucesso
   * @throws {UnauthorizedException} Se nenhum mecanismo passou
   * @throws {ForbiddenException} `{ code: 'NO_WORKSPACE' }` se JWT órfão
   *   acessa rota sem `@AllowOrphan()`.
   * @throws {ForbiddenException} Se tenant mismatch (PROJECT_ESTAB / PATH_PARAM).
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

    let authenticated = false;

    // Tentar MCP Key (1º — mais específico: contexto de ferramenta MCP)
    try {
      const mcpResult = await this.mcpKeyGuard.canActivate(context);
      if (mcpResult) {
        this.logger.debug('Autenticado via MCP Key');
        authenticated = true;
      }
    } catch {
      // Guard interno falhou — tentar próximo
    }

    // Tentar API Key (2º — contexto de automação/integração)
    if (!authenticated) {
      try {
        const apiKeyResult = await this.apiKeyGuard.canActivate(context);
        if (apiKeyResult) {
          this.logger.debug('Autenticado via API Key');
          authenticated = true;
        }
      } catch {
        // Guard interno falhou — tentar próximo
      }
    }

    // Tentar JWT Bearer (3º — sessão de usuário padrão)
    if (!authenticated) {
      try {
        const jwtResult = await this.jwtAuthGuard.canActivate(context);
        const request = context.switchToHttp().getRequest<Record<string, unknown>>();

        // JwtAuthGuard pode retornar true mas com req.user=null (token inválido)
        // Verificar se req.user foi populado
        if (jwtResult && request['user']) {
          this.logger.debug('Autenticado via JWT');
          request['authMethod'] = 'jwt';
          authenticated = true;
        }
      } catch {
        // JWT inválido — cai para o throw abaixo
      }
    }

    if (!authenticated) {
      // Todos os mecanismos falharam — AuthCompositeGuard é o ÚNICO que lança 401
      this.logger.debug('Todos os mecanismos de auth falharam — 401');
      throw new UnauthorizedException(
        'Autenticação necessária: forneça JWT Bearer, X-API-Key ou X-MCP-Key',
      );
    }

    // ADR-V2-038: bloquear rotas tenant-scoped quando JWT está órfão.
    // `RequireWorkspaceGuard` decide com base em `@AllowOrphan()` da rota e
    // lança `ForbiddenException` `{ code: 'NO_WORKSPACE' }` quando aplicável.
    // Fora do try/catch para garantir que a ForbiddenException propague.
    const workspaceOk = this.requireWorkspaceGuard.canActivate(context);
    if (!workspaceOk) {
      return false;
    }

    // ADR-V2-042: defesa #2 — isolamento multi-tenant em rotas com path
    // param de projeto/org. Lança ForbiddenException se cross-tenant.
    return this.orgTenantGuard.canActivate(context);
  }
}
