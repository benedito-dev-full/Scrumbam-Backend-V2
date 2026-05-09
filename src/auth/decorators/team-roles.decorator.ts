import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key para roles de time exigidos pelo endpoint.
 * Lido pelo TeamRolesGuard via Reflector.
 */
export const TEAM_ROLES_KEY = 'teamRoles';

/**
 * Roles de time disponíveis (via DVincula idClasse -181 TEAM_MEMBERSHIP).
 *
 * - LEAD: acesso total ao time (criador, pode gerenciar membros)
 * - MEMBER: acesso operacional (pode criar/editar tasks)
 */
export type TeamRole = 'LEAD' | 'MEMBER';

/**
 * Decorator para exigir roles específicos de time em um endpoint.
 *
 * Usado em conjunto com TeamRolesGuard. Verifica o cargo do usuário no time
 * via DVincula idClasse=-181 (TEAM_MEMBERSHIP), campo metaDados.cargo.
 *
 * @param roles - Um ou mais roles exigidos (OR logic — qualquer um aceito)
 *
 * @example
 * ```typescript
 * @Patch(':id')
 * @UseGuards(AuthCompositeGuard, TeamRolesGuard)
 * @TeamRoles('LEAD')
 * async update(@Param('id') id: string, @Body() dto: UpdateTeamDto) { ... }
 *
 * @Post(':id/members')
 * @UseGuards(AuthCompositeGuard, TeamRolesGuard)
 * @TeamRoles('LEAD', 'MEMBER')
 * async addMember(@Param('id') id: string) { ... }
 * ```
 */
export const TeamRoles = (...roles: TeamRole[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(TEAM_ROLES_KEY, roles);
