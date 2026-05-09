import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key para rotas públicas (sem autenticação).
 *
 * Usado pelo JwtAuthGuard via Reflector.getAllAndOverride para bypass.
 * Substitui o @SkipGuard() placeholder de F2.
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Decorator para marcar rotas como públicas (sem autenticação obrigatória).
 *
 * O JwtAuthGuard verifica este metadata e retorna true imediatamente,
 * sem validar JWT, API Key ou MCP Key.
 *
 * Aplicar em:
 * - POST /auth/register
 * - POST /auth/login
 * - POST /auth/refresh
 *
 * @example
 * ```typescript
 * @Post('login')
 * @Public()
 * async login(@Body() dto: LoginDto) { ... }
 * ```
 */
export const Public = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(IS_PUBLIC_KEY, true);
