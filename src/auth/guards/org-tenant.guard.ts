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
import { JwtPayload } from '../decorators/current-user.decorator';

/**
 * Cache LRU para projectId → orgId (decisão CEO: DProject.idEstab + LRU).
 * TTL 5min, 1000 entradas.
 */
const projectOrgCache = new LRUCache<string, string>(1000, 300_000);

/**
 * Guard de isolamento multi-tenant por organização.
 *
 * Implementa a decisão Q1 do CEO (F3):
 * - Isolamento via DProject.idEstab + LRU cache (5min)
 * - NÃO enriquece JWT com projectIds[]
 * - 1 query ao banco por projectId não cacheado
 *
 * Estratégias (@TenantConfig):
 * - JWT_ONLY (default): compara organizationId do JWT com orgId do recurso
 * - PROJECT_ESTAB: busca DProject.idEstab e compara com JWT.organizationId
 * - PATH_PARAM: extrai orgId do path param :orgId
 *
 * Bypass automático para API Key auth (projeto já valida isolamento).
 *
 * @see TenantConfig — decorator para configurar estratégia
 * @see AuthCompositeGuard — deve ser aplicado antes deste
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
      throw new ForbiddenException('organizationId ausente no token');
    }

    const strategy = this.reflector.getAllAndOverride<TenantStrategy>(TENANT_STRATEGY_KEY, [
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
        this.logger.debug(
          `Tenant mismatch: jwtOrg=${jwtOrgId} projectOrg=${resourceOrgId}`,
        );
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
