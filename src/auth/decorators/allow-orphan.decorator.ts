import { SetMetadata } from '@nestjs/common';

/**
 * Chave de metadata usada pelo `RequireWorkspaceGuard` para detectar
 * rotas marcadas com `@AllowOrphan()`.
 */
export const ALLOW_ORPHAN_KEY = 'allowOrphan';

/**
 * Marca uma rota como acessivel por JWT orfao (usuario sem workspace ativa).
 *
 * JWT orfao = payload sem `organizationId`. Sem este decorator, o
 * `RequireWorkspaceGuard` retorna 403 `{ code: 'NO_WORKSPACE', message: ... }`
 * para qualquer requisicao autenticada por JWT que nao contenha `organizationId`.
 *
 * Usar em rotas que precisam ser acessadas pelo usuario antes que ele tenha
 * uma workspace ativa, tipicamente:
 *  - `GET /auth/me` — descobrir estado orfao (`isOrphan: true`).
 *  - `POST /auth/logout`.
 *  - `POST /auth/switch-org` — sair do estado orfao trocando para uma org.
 *  - `GET /auth/pending-invites` — listar convites pendentes para o usuario.
 *  - `POST /organizations` — criar uma workspace nova.
 *
 * Demais rotas tenant-scoped (`/projects`, `/tasks`, `/executions`, …) NAO
 * devem ter este decorator — devem continuar respondendo 403 NO_WORKSPACE
 * para JWT orfao, sinalizando ao frontend que precisa renderizar o empty state.
 *
 * Ver ADR-V2-038 (proposto em `workspace/plans/plan-orphan-workspace.md`).
 *
 * @example
 * ```typescript
 * @Get('me')
 * @UseGuards(AuthCompositeGuard)
 * @AllowOrphan()
 * async getMe(@CurrentUser() user: JwtPayload) { ... }
 * ```
 */
export const AllowOrphan = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_ORPHAN_KEY, true);
