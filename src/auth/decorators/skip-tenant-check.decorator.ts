import { SetMetadata } from '@nestjs/common';

/**
 * Chave de metadata usada pelo `OrgTenantGuard` para detectar rotas
 * marcadas com `@SkipTenantCheck()`.
 */
export const SKIP_TENANT_CHECK_KEY = 'skipTenantCheck';

/**
 * Marca uma rota como cross-organizacao por design — pula validacao
 * de isolamento multi-tenant do `OrgTenantGuard` (global APP_GUARD).
 *
 * Usar APENAS em rotas onde a semantica e legitimamente cross-org. Cada
 * uso DEVE vir acompanhado de comentario explicando o motivo, e cada
 * decorator e revisado caso a caso pelo Reviewer (ADR-V2-042).
 *
 * Exemplos legitimos:
 *  - `/auth/*` (login, refresh, switch-org) — operacao sobre o usuario,
 *    nao sobre uma org especifica.
 *  - `/invites/:token` (publico via token) — antes do user ter org.
 *  - `/orphan/*` — usuario sem workspace (ADR-V2-038).
 *  - `/teams/mine` — visao agregada do usuario em multiplas orgs.
 *  - `/health` — endpoint de monitoramento.
 *  - `/agents/install`, `/agents/:id/heartbeat`,
 *    `/agents/:id/execution-result` — autenticados por install-token / HMAC,
 *    nao por JWT, e o guard de agente faz seu proprio isolamento.
 *
 * Demais rotas (`/projects`, `/tasks`, `/agents`, `/sprints`, etc.) NAO
 * devem ter este decorator — devem manter `OrgTenantGuard` ativo e cruzar
 * `idEstab` com `JWT.organizationId` nos services.
 *
 * Ver ADR-V2-042 (defense-in-depth de tenant isolation).
 *
 * @example
 * ```typescript
 * @Get('me')
 * @UseGuards(AuthCompositeGuard)
 * @SkipTenantCheck() // Motivo: visao do usuario, nao tenant-scoped.
 * @AllowOrphan()
 * async getMe(@CurrentUser() user: JwtPayload) { ... }
 * ```
 */
export const SkipTenantCheck = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_TENANT_CHECK_KEY, true);
