import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key para roles exigidos pelo endpoint.
 * Lido pelo RolesGuard via Reflector.
 */
export const ROLES_KEY = 'roles';

/**
 * Roles de organização disponíveis (via DVincula idClasse -161/-162/-163).
 *
 * - ADMIN: acesso total à org (idClasse -161)
 * - MEMBER: acesso operacional (idClasse -162)
 * - VIEWER: leitura apenas (idClasse -163)
 */
export type OrgRole = 'ADMIN' | 'MEMBER' | 'VIEWER';

/**
 * Decorator para exigir roles específicos em um endpoint.
 *
 * Usado em conjunto com RolesGuard. Verifica o role do usuário na
 * organização via DVincula (N+1 ZERO + LRU cache).
 *
 * @param roles - Um ou mais roles exigidos (OR logic — qualquer um aceito)
 *
 * @example
 * ```typescript
 * @Post()
 * @UseGuards(AuthCompositeGuard, RolesGuard)
 * @Roles('ADMIN')
 * async create(@Body() dto: CreateDto) { ... }
 *
 * @Get()
 * @UseGuards(AuthCompositeGuard, RolesGuard)
 * @Roles('ADMIN', 'MEMBER')
 * async list() { ... }
 * ```
 */
export const Roles = (...roles: OrgRole[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);
