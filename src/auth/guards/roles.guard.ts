import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, OrgRole } from '../decorators/roles.decorator';
import { RoleResolverService } from '../services/role-resolver.service';
import { JwtPayload } from '../decorators/current-user.decorator';

/**
 * Guard de autorização por role de organização.
 *
 * Verifica se o usuário tem o role exigido pelo decorator @Roles()
 * na organização atual (JWT.organizationId).
 *
 * Comportamento:
 * - Sem @Roles(): retorna true (sem verificação)
 * - Com @Roles('ADMIN'): verifica se user é ADMIN da org
 * - Role insuficiente: lança ForbiddenException (403)
 *
 * Performance: 1 query + LRU cache TTL 5min via RoleResolverService.
 *
 * @see Roles — decorator que define os roles exigidos
 * @see RoleResolverService — resolve role via DVincula (N+1 ZERO)
 * @see AuthCompositeGuard — deve ser aplicado antes deste
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly roleResolver: RoleResolverService,
  ) {}

  /**
   * Verifica roles do usuário na organização.
   *
   * @param context - Contexto de execução NestJS
   * @returns true se role suficiente
   * @throws {ForbiddenException} Se role insuficiente
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<OrgRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Sem @Roles() → sem restrição
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;

    if (!user?.sub || !user?.organizationId) {
      throw new ForbiddenException('Contexto de usuário ou organização ausente');
    }

    const userId = BigInt(user.sub);
    const orgId = BigInt(user.organizationId);

    const userRole = await this.roleResolver.getOrgRole(userId, orgId);

    if (!userRole || !requiredRoles.includes(userRole)) {
      this.logger.debug(
        `Acesso negado: userId=${userId} role=${userRole ?? 'null'} required=${requiredRoles.join(',')}`,
      );
      throw new ForbiddenException(
        `Permissão insuficiente. Roles requeridos: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
