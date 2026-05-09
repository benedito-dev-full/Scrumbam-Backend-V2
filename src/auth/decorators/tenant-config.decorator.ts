import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key para estratégia de tenant do OrgTenantGuard.
 */
export const TENANT_STRATEGY_KEY = 'tenantStrategy';

/**
 * Estratégias de isolamento multi-tenant para OrgTenantGuard.
 *
 * - PATH_PARAM: extrai orgId do path (`/orgs/:orgId/...`)
 * - BODY_PROPERTY: extrai orgId do body request (`{ orgId: '...' }`)
 * - QUERY_PARAM: extrai orgId do query string (`?orgId=...`)
 * - PROJECT_ESTAB: extrai orgId via DProject.idEstab (decisão Q1 CEO — F3)
 * - JWT_ONLY: usa apenas organizationId do JWT payload (sem path param)
 */
export type TenantStrategy =
  | 'PATH_PARAM'
  | 'BODY_PROPERTY'
  | 'QUERY_PARAM'
  | 'PROJECT_ESTAB'
  | 'JWT_ONLY';

/**
 * Decorator para configurar a estratégia de isolamento multi-tenant.
 *
 * Usado em conjunto com OrgTenantGuard para determinar como extrair
 * o orgId do request e comparar com o organizationId do JWT.
 *
 * @param strategy - Estratégia de extração do orgId
 *
 * @example
 * ```typescript
 * @Get(':projectId/tasks')
 * @UseGuards(AuthCompositeGuard, OrgTenantGuard)
 * @TenantConfig('PROJECT_ESTAB')
 * async listTasks(@Param('projectId') projectId: string) { ... }
 * ```
 */
export const TenantConfig = (strategy: TenantStrategy): ReturnType<typeof SetMetadata> =>
  SetMetadata(TENANT_STRATEGY_KEY, strategy);
