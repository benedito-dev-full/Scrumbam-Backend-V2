import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';

/**
 * Guard de roles de time (placeholder — implementado em F5 com DTask/DProject).
 *
 * F5 implementará o contexto completo de times via DVincula -181 TEAM_MEMBERSHIP.
 * Em F3, este guard é um stub que retorna true para não bloquear desenvolvimento.
 *
 * @see DVincula (-181 TEAM_MEMBERSHIP) — F5
 * @see RoleResolverService — getProjectRole para roles de projeto
 */
@Injectable()
export class TeamRolesGuard implements CanActivate {
  private readonly logger = new Logger(TeamRolesGuard.name);

  /**
   * Stub F3 — retorna true até F5 implementar times.
   */
  canActivate(_context: ExecutionContext): boolean {
    this.logger.debug('TeamRolesGuard stub — F5 implementará times');
    return true;
  }
}
