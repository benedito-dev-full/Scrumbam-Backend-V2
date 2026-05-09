import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Payload JWT com campos tipados após validação pelo JwtStrategy.
 */
export interface JwtPayload {
  /** Chave BigInt do DUserGroup (serializada como string em `sub`). */
  sub: string;
  /** Chave BigInt da DEntidade (-150 USER). */
  entidadeId: string;
  /** Chave BigInt da DEntidade (-152 ORGANIZATION) padrão do usuário. */
  organizationId: string;
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
