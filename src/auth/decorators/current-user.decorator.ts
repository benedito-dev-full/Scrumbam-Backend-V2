import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Payload JWT com campos tipados após validação pelo JwtStrategy.
 */
export interface JwtPayload {
  /** Chave BigInt do DUserGroup (serializada como string em `sub`). */
  sub: string;
  /** Chave BigInt da DEntidade (-150 USER). */
  entidadeId: string;
  /**
   * Chave BigInt da DEntidade (-152 ORGANIZATION) padrão do usuário.
   *
   * **OPCIONAL** — quando ausente, o usuário está em **estado órfão**
   * (sem nenhuma workspace ativa). Rotas tenant-scoped DEVEM rejeitar
   * JWTs órfãos via `RequireWorkspaceGuard` (a ser introduzido na Etapa 2
   * do plano de orphan-workspace). Rotas marcadas com `@AllowOrphan()`
   * aceitam JWT órfão (ex.: `/auth/me`, `POST /organizations`).
   *
   * NOTA: até a Etapa 3, o `AuthService.login` ainda bloqueia user órfão
   * com 401 — então na prática o backend não emite JWT sem `organizationId`
   * ainda. O campo é opcional no tipo para preparar o terreno.
   */
  organizationId?: string;
  /** Email do usuário. */
  email: string;
  /** Tempo de expiração (Unix timestamp). */
  exp?: number;
  /** Tempo de emissão (Unix timestamp). */
  iat?: number;
}

/**
 * Decorator para extrair o usuário autenticado da request.
 *
 * Funciona com JWT, API Key e MCP Key — desde que o guard correspondente
 * popule `req.user` antes de chegar no handler.
 *
 * @example
 * ```typescript
 * @Get('me')
 * async getMe(@CurrentUser() user: JwtPayload) {
 *   return this.authService.getMe(BigInt(user.sub));
 * }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as JwtPayload;
  },
);
