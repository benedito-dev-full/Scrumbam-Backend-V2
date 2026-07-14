import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { McpKeyGuard } from './mcp-key.guard';
import { ApiKeyGuard } from './api-key.guard';
import { AUTH_FAILURE_REASON_KEY, AuthFailureReason, JwtAuthGuard } from './jwt-auth.guard';
import { RequireWorkspaceGuard } from './require-workspace.guard';
import { OrgTenantGuard } from './org-tenant.guard';
import { MetricsService } from '../../common/observability/metrics.service';
import { classifyInfraError } from '../../common/observability/infra-error.util';
import { AUTH_ERROR_CODES } from '../../common/errors/error-codes';

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
    // F0 — Observabilidade. `@Optional()`: sem MetricsService o guard opera igual.
    @Optional() private readonly metrics?: MetricsService,
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
    } catch (err) {
      // Credencial inválida → segue a cadeia. INFRA → 503 (F1/D4).
      this.handleGuardFailure('McpKeyGuard', err, context);
    }

    // Tentar API Key (2º — contexto de automação/integração)
    if (!authenticated) {
      try {
        const apiKeyResult = await this.apiKeyGuard.canActivate(context);
        if (apiKeyResult) {
          this.logger.debug('Autenticado via API Key');
          authenticated = true;
        }
      } catch (err) {
        // Credencial inválida → segue a cadeia. INFRA → 503 (F1/D4).
        this.handleGuardFailure('ApiKeyGuard', err, context);
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
      } catch (err) {
        // Token inválido → cai no 401 abaixo. Falha de INFRA (inclusive o 503
        // que o próprio JwtAuthGuard lança em `handleRequest`) → propaga 503.
        this.handleGuardFailure('JwtAuthGuard', err, context);
      }
    }

    if (!authenticated) {
      // Todos os mecanismos falharam — AuthCompositeGuard é o ÚNICO que lança 401
      this.logger.debug('Todos os mecanismos de auth falharam — 401');

      // F0 — CONTADOR `auth.401` POR MOTIVO. O motivo real vem do
      // JwtAuthGuard (que enxerga err/info do Passport) via
      // `req[AUTH_FAILURE_REASON_KEY]`; na ausência dele, assume-se
      // `no_credential` (nenhum header de auth foi apresentado).
      // `reason=guard_exception` > 0 é a PROVA de que infra está deslogando
      // usuário — e o gatilho da F1 (D4: 503 em vez de 401).
      const request = context.switchToHttp().getRequest<Record<string, unknown>>();
      const reason = (request[AUTH_FAILURE_REASON_KEY] as AuthFailureReason) ?? 'no_credential';

      this.metrics?.increment(
        'auth.401',
        {
          reason,
          method: String(request['method'] ?? ''),
          path: String(request['url'] ?? '').split('?')[0],
        },
        { level: reason === 'guard_exception' ? 'warn' : 'log' },
      );

      // F1 (item 1.4) — o 401 passa a carregar `code` (RFC 9457). O frontend
      // distingue "expirou, faça refresh" de "não serve, deslogue" sem heurística
      // sobre a string da mensagem.
      throw new UnauthorizedException({
        code:
          reason === 'token_expired'
            ? AUTH_ERROR_CODES.TOKEN_EXPIRED
            : AUTH_ERROR_CODES.TOKEN_INVALID,
        message: 'Autenticação necessária: forneça JWT Bearer, X-API-Key ou X-MCP-Key',
      });
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

  /**
   * Classifica a exceção de um guard interno e decide: **seguir a cadeia OR** ou
   * **abortar com 503**.
   *
   * **F1 (item 1.5 / D4) — o `catch {}` catch-all deixou de existir.** Antes,
   * qualquer exceção (JWT malformado, pool do Postgres esgotado, DB fora, bug)
   * era engolida e caía no `401` final. Ou seja: **lentidão de banco deslogava
   * usuário.** Agora:
   *
   * - **Credencial ausente/inválida** → continua a cadeia (MCP → API Key → JWT).
   *   É o caso ESPERADO (um request sem `X-MCP-Key` sempre "falha" no McpKeyGuard).
   * - **Falha de INFRA** (`P2024` pool timeout, `P1001` DB inalcançável, Redis
   *   fora, timeout) → aborta com `503 { code: AUTH_BACKEND_UNAVAILABLE }`.
   *   Ancoragem RFC 6750: 401 significa `invalid_token`; um pool esgotado **não
   *   é** token inválido. 503 faz o cliente **retentar**, não deslogar.
   * - **HttpException já lançada** por um guard interno (ex.: o 503 do
   *   `JwtAuthGuard`) → propaga intacta.
   *
   * @param guard - Nome do guard que falhou (dimensão do contador)
   * @param err - Exceção capturada
   * @param context - Contexto (usado para anotar o motivo no request)
   * @throws {ServiceUnavailableException} `{ code: 'AUTH_BACKEND_UNAVAILABLE' }`
   *   quando a falha é de infraestrutura
   */
  private handleGuardFailure(guard: string, err: unknown, context: ExecutionContext): void {
    // Um guard interno que já decidiu o status (ex.: 503 do JwtAuthGuard) tem
    // a palavra final — não reclassificamos nem engolimos.
    if (err instanceof HttpException) {
      throw err;
    }

    const classified = classifyInfraError(err);

    if (!classified.isInfra) {
      // Credencial ausente/inválida: caso ESPERADO na cadeia OR. Não polui o log.
      return;
    }

    this.metrics?.increment(
      'auth.guard.infra_error',
      {
        guard,
        kind: classified.kind,
        code: classified.code,
        errorName: classified.name,
      },
      { level: 'error' },
    );

    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    request[AUTH_FAILURE_REASON_KEY] = 'guard_exception' satisfies AuthFailureReason;

    this.logger.error(
      `Falha de INFRA em ${guard} (${classified.kind}${classified.code ? ` ${classified.code}` : ''}) — 503, não 401`,
    );

    throw new ServiceUnavailableException({
      code: AUTH_ERROR_CODES.AUTH_BACKEND_UNAVAILABLE,
      message: 'Serviço de autenticação temporariamente indisponível. Tente novamente.',
    });
  }
}
