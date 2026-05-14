import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ALLOW_ORPHAN_KEY } from '../decorators/allow-orphan.decorator';
import { JwtPayload } from '../decorators/current-user.decorator';

/**
 * Guard que bloqueia rotas tenant-scoped quando o JWT esta orfao
 * (sem `organizationId` no payload).
 *
 * **Posicionamento na cadeia de guards (importante):** este guard precisa
 * rodar DEPOIS do `AuthCompositeGuard` — depende de `req.user` ja estar
 * populado. Por isso e invocado internamente pelo `AuthCompositeGuard` no
 * final do seu `canActivate`, e nao registrado como `APP_GUARD` global
 * (NestJS executa APP_GUARDs ANTES dos guards de controller, o que tornaria
 * `req.user` indefinido aqui).
 *
 * **Regras de decisao:**
 *
 *  1. Sem `req.user` no request → deixa passar (rota publica, ou ainda nao
 *     autenticada; nao cabe a este guard decidir).
 *  2. `req.authMethod !== 'jwt'` → deixa passar (API Key / MCP Key nao tem
 *     conceito de "orfao"; isolam por dEntidadeId/projectId).
 *  3. `user.organizationId` presente → deixa passar (caso normal — tem org).
 *  4. JWT orfao + rota com `@AllowOrphan()` → deixa passar (rota declarou
 *     suporte explicito a estado orfao).
 *  5. JWT orfao + rota sem `@AllowOrphan()` → 403 `{ code: 'NO_WORKSPACE',
 *     message: ... }` (frontend renderiza empty state).
 *
 * Ver ADR-V2-038.
 *
 * @see AllowOrphan — decorator que libera rotas para JWT orfao.
 * @see AuthCompositeGuard — invoca este guard no final do fluxo.
 */
@Injectable()
export class RequireWorkspaceGuard implements CanActivate {
  private readonly logger = new Logger(RequireWorkspaceGuard.name);

  constructor(private readonly reflector: Reflector) {}

  /**
   * Decide se a requisicao pode prosseguir com base no estado do JWT
   * (orfao ou nao) e no decorator `@AllowOrphan()` da rota.
   *
   * @param context - Contexto de execucao NestJS.
   * @returns true se a rota pode ser invocada.
   * @throws {ForbiddenException} `{ code: 'NO_WORKSPACE' }` se JWT orfao
   *   acessa rota tenant-scoped (sem `@AllowOrphan()`).
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      authMethod?: string;
      url?: string;
    }>();

    const user = request.user;

    // 1. Rota publica ou ainda nao autenticada — nao cabe a este guard
    if (!user) return true;

    // 2. Auth via API Key ou MCP Key — nao se aplica
    if (request.authMethod && request.authMethod !== 'jwt') return true;

    // 3. JWT com organizationId — caso normal, deixa passar
    if (user.organizationId) return true;

    // 4. JWT orfao — verificar @AllowOrphan() na rota
    const allow = this.reflector.getAllAndOverride<boolean>(ALLOW_ORPHAN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (allow) return true;

    // 5. JWT orfao em rota tenant-scoped — 403 estruturado
    this.logger.warn(
      `JWT orfao tentou acessar rota tenant-scoped sub=${user.sub} path=${request.url ?? '?'}`,
    );

    throw new ForbiddenException({
      code: 'NO_WORKSPACE',
      message: 'Voce precisa criar ou aceitar uma workspace antes de acessar esta rota.',
    });
  }
}
