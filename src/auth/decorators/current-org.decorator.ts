import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Decorator para extrair o organizationId do usuário autenticado.
 *
 * Equivalente a `@CurrentUser().organizationId` mas com semântica explícita.
 * Útil em controllers que precisam apenas do orgId para queries.
 *
 * @example
 * ```typescript
 * @Get()
 * async list(@CurrentOrg() orgId: string) {
 *   return this.service.listByOrg(BigInt(orgId));
 * }
 * ```
 */
export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return (request.user?.organizationId as string) ?? '';
  },
);
