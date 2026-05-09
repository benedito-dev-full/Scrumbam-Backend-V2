import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { RoleResolverService } from '../services/role-resolver.service';
import { JwtPayload } from '../decorators/current-user.decorator';

/**
 * Guard de escopo de projeto.
 *
 * Verifica que o usuário tem acesso ao projeto do path param.
 * - Via API Key: projeto já está em req['project'] — valida coerência
 * - Via JWT: verifica DVincula project role via RoleResolverService
 *
 * @see RoleResolverService — resolve project role (N+1 ZERO)
 * @see OrgTenantGuard — deve ser aplicado antes para validar tenant
 */
@Injectable()
export class ProjectScopeGuard implements CanActivate {
  private readonly logger = new Logger(ProjectScopeGuard.name);

  constructor(private readonly roleResolver: RoleResolverService) {}

  /**
   * Verifica acesso do usuário ao projeto.
   *
   * @param context - Contexto de execução NestJS
   * @returns true se acesso permitido
   * @throws {ForbiddenException} Se sem acesso ao projeto
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      authMethod?: string;
      project?: { id: string };
      params?: Record<string, string>;
    }>();

    const projectId = request.params?.projectId ?? request.params?.id;

    // Via API Key: projeto já foi validado no ApiKeyGuard
    if (request.authMethod === 'apikey') {
      return true;
    }

    if (!projectId) {
      return true; // sem projectId — pass through (handler trata 404)
    }

    const user = request.user;
    if (!user?.sub) {
      throw new ForbiddenException('Usuário não autenticado');
    }

    const userId = BigInt(user.sub);
    const projectBigInt = BigInt(projectId);

    const projectRole = await this.roleResolver.getProjectRole(userId, projectBigInt);

    if (!projectRole) {
      this.logger.debug(`Acesso negado: userId=${userId} sem role no projeto=${projectBigInt}`);
      throw new ForbiddenException('Acesso negado: sem permissão neste projeto');
    }

    return true;
  }
}
