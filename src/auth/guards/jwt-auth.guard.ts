import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Guard de autenticação JWT.
 *
 * Comportamento:
 * - Se rota tem @Public(): retorna true sem validar (bypass)
 * - Se Authorization header tem Bearer token válido: popula req.user e retorna true
 * - Se token ausente/inválido: retorna false (NÃO lança — AuthCompositeGuard decide)
 *
 * REGRA CRÍTICA: Guards internos NÃO lançam UnauthorizedException.
 * Apenas AuthCompositeGuard lança se TODOS os mecanismos falharem.
 *
 * @see AuthCompositeGuard — guard de composição OR
 * @see IS_PUBLIC_KEY — metadata key para bypass
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly reflector: Reflector) {
    super();
  }

  /**
   * Verifica se a rota tem @Public() antes de validar o JWT.
   *
   * @param context - Contexto de execução NestJS
   * @returns true se público ou JWT válido; false se JWT inválido
   */
  canActivate(context: ExecutionContext): boolean | Promise<boolean> | import('rxjs').Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      this.logger.debug('Rota pública — bypass JWT');
      return true;
    }

    return super.canActivate(context);
  }

  /**
   * Sobrescreve handleRequest para retornar null em vez de lançar.
   *
   * Guards internos NUNCA lançam — retornam falsy.
   * AuthCompositeGuard é responsável por lançar UnauthorizedException.
   *
   * @param _err - Erro de validação (ignorado aqui)
   * @param user - Usuário validado ou false/null
   * @returns user se válido, null se inválido (sem lançar)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRequest<TUser = any>(_err: any, user: any): TUser {
    // Retorna null em vez de lançar — AuthCompositeGuard decide
    return user as TUser;
  }
}
