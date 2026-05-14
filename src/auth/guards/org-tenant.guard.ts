import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma.service';
import { LRUCache } from '../../common/helpers/lru-cache';
import { TENANT_STRATEGY_KEY, TenantStrategy } from '../decorators/tenant-config.decorator';
import { SKIP_TENANT_CHECK_KEY } from '../decorators/skip-tenant-check.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtPayload } from '../decorators/current-user.decorator';

/**
 * Cache LRU para projectId → orgId (decisão CEO: DProject.idEstab + LRU).
 * TTL 5min, 1000 entradas.
 */
const projectOrgCache = new LRUCache<string, string>(1000, 300_000);

/**
 * Guard de isolamento multi-tenant por organização.
 *
 * Invocado internamente pelo `AuthCompositeGuard` em F14 (ADR-V2-042 —
 * defense-in-depth), validando que o JWT.organizationId corresponde ao
 * organizationId do recurso acessado. Rotas cross-org legitimas opt-out
 * via `@SkipTenantCheck()` (sempre com comentário do motivo). Rotas
 * públicas (`@Public()`) também são puladas.
 *
 * Nota: Não registrado como `APP_GUARD` global (incompatibilidade com
 * ordem de execução Nest — `req.user` ficaria indefinido). Invocado
 * explicitamente pelo `AuthCompositeGuard` após `JwtAuthGuard` garantir
 * que `req.user` está populado.
 *
 * Estratégias (@TenantConfig):
 * - JWT_ONLY (default): compara organizationId do JWT com orgId do recurso
 * - PROJECT_ESTAB: busca DProject.idEstab e compara com JWT.organizationId
 * - PATH_PARAM: extrai orgId do path param :orgId
 *
 * Bypass automático para:
 *  - API Key auth (projeto já valida isolamento via dEntidadeId).
 *  - MCP Key auth (MCP keys nao tem organizationId — sao cross-org by design).
 *  - JWT orfao (`organizationId` ausente) — quem decide e o `RequireWorkspaceGuard`.
 *  - Rotas `@Public()` e `@SkipTenantCheck()`.
 *
 * @see TenantConfig — decorator para configurar estratégia.
 * @see SkipTenantCheck — opt-out explicito para rotas cross-org.
 * @see TenantScopeService — helper para isolamento em services (defesa #2).
 * @see AuthCompositeGuard — deve ser aplicado antes deste.
 */
@Injectable()
export class OrgTenantGuard implements CanActivate {
  private readonly logger = new Logger(OrgTenantGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Valida isolamento multi-tenant.
   *
   * @param context - Contexto de execução NestJS
   * @returns true se usuário pertence à organização do recurso
   * @throws {ForbiddenException} Se tenant mismatch
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Bypass rotas publicas — `@Public()` desabilita autenticacao por
    // completo, entao nao faz sentido validar tenant aqui.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // Bypass explicito por decorator `@SkipTenantCheck()` — rotas cross-org
    // por design (auth, invites publicos, orphan, teams/mine, health,
    // callbacks de agente HMAC-autenticados, etc.). Cada uso revisado pelo
    // Reviewer (ADR-V2-042).
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_CHECK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      authMethod?: string;
      params?: Record<string, string>;
      body?: Record<string, unknown>;
      query?: Record<string, string>;
    }>();

    // Bypass para API Key — projeto já valida isolamento via dEntidadeId
    if (request.authMethod === 'apikey') {
      this.logger.debug('API Key auth — bypass OrgTenantGuard');
      return true;
    }

    const user = request.user;
    if (!user?.organizationId) {
      // MCP Key pode não ter organizationId — bypass para contexto MCP
      if (request.authMethod === 'mcpkey') {
        return true;
      }
      // ADR-V2-038: JWT órfão (sem organizationId) é estado válido.
      // Não bloqueamos aqui — quem decide é o RequireWorkspaceGuard
      // (invocado pelo AuthCompositeGuard), que consulta o decorator
      // @AllowOrphan() da rota e responde 403 NO_WORKSPACE quando aplicável.
      return true;
    }

    const strategy =
      this.reflector.getAllAndOverride<TenantStrategy>(TENANT_STRATEGY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'JWT_ONLY';

    const jwtOrgId = user.organizationId;

    if (strategy === 'JWT_ONLY') {
      // Sem verificação de recurso externo — confia no JWT
      return true;
    }

    if (strategy === 'PROJECT_ESTAB') {
      const projectId = request.params?.projectId ?? request.params?.id;
      if (!projectId) {
        return true; // sem projectId no path — pass through
      }

      const resourceOrgId = await this.resolveProjectOrg(projectId);
      if (!resourceOrgId) {
        return true; // projeto não encontrado — 404 será lançado pelo controller
      }

      if (resourceOrgId !== jwtOrgId) {
        this.logger.debug(`Tenant mismatch: jwtOrg=${jwtOrgId} projectOrg=${resourceOrgId}`);
        throw new ForbiddenException('Acesso negado: projeto pertence a outra organização');
      }

      return true;
    }

    if (strategy === 'PATH_PARAM') {
      const pathOrgId = request.params?.orgId;
      if (pathOrgId && pathOrgId !== jwtOrgId) {
        throw new ForbiddenException('Acesso negado: organização não corresponde ao token');
      }
      return true;
    }

    // Para outras estratégias (BODY_PROPERTY, QUERY_PARAM): pass through em F3
    // Implementação completa em F5 quando DProject controller existir
    return true;
  }

  /**
   * Resolve orgId de um projeto via DProject.idEstab com LRU cache.
   *
   * Cache key: `project:${projectId}:orgId`
   * Cache TTL: 5 minutos (1000 entradas máx.)
   *
   * @param projectId - Chave do DProject como string
   * @returns orgId como string ou null se projeto não encontrado
   */
  private async resolveProjectOrg(projectId: string): Promise<string | null> {
    const cacheKey = `project:${projectId}:orgId`;
    const cached = projectOrgCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    this.logger.debug(`Resolvendo orgId para projeto=${projectId}`);

    // Validar formato BigInt antes de consultar — strings invalidas (ex:
    // 'pending-invites') causariam SyntaxError. Tratamos como nao-encontrado.
    if (!/^-?\d+$/.test(projectId)) {
      return null;
    }

    const project = await this.prisma.dProject.findFirst({
      where: { chave: BigInt(projectId), excluido: false },
      select: { idEstab: true },
    });

    const orgId = project?.idEstab?.toString() ?? null;
    if (orgId !== null) {
      projectOrgCache.set(cacheKey, orgId);
    }

    return orgId;
  }
}
