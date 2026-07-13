import { ExecutionContext, Injectable, Logger, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { MetricsService } from '../../common/observability/metrics.service';
import { classifyInfraError } from '../../common/observability/infra-error.util';

/**
 * Chave em `req` onde o motivo real da falha de JWT é anotado (F0).
 *
 * Escrita por {@link JwtAuthGuard.handleRequest}, lida pelo `AuthCompositeGuard`
 * para rotular o contador `auth.401`. Puramente informativa — nenhum guard toma
 * decisão com base nela (isso seria mudança de comportamento, e é F1).
 */
export const AUTH_FAILURE_REASON_KEY = '__authFailureReason';

/** Taxonomia de motivo de 401 (plano §5 FASE 0, item 3). */
export type AuthFailureReason =
  | 'token_expired'
  | 'token_invalid'
  | 'no_credential'
  | 'guard_exception';

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
 * **F0 — Observabilidade (comportamento INALTERADO).** `handleRequest` é o único
 * ponto que enxerga o `err`/`info` reais do Passport — e hoje descarta ambos.
 * É por isso que uma exceção de INFRA (pool timeout do Prisma dentro de
 * `JwtStrategy.validate`) é hoje indistinguível de "token inválido": as duas
 * viram o mesmo 401 mudo. Aqui classificamos e CONTAMOS. Responder 503 em vez de
 * 401 para infra é a **F1 (D4)** — não é feito aqui.
 *
 * @see AuthCompositeGuard — guard de composição OR
 * @see classifyInfraError — separa falha de infra de credencial inválida
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    // F0 — `@Optional()`: sem MetricsService o guard opera exatamente igual.
    @Optional() private readonly metrics?: MetricsService,
  ) {
    super();
  }

  /**
   * Verifica se a rota tem @Public() antes de validar o JWT.
   *
   * @param context - Contexto de execução NestJS
   * @returns true se público ou JWT válido; false se JWT inválido
   */
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | import('rxjs').Observable<boolean> {
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
   * **F0:** antes de devolver, classifica a falha e a registra em
   * `req[AUTH_FAILURE_REASON_KEY]` + contadores. O retorno é o MESMO de antes.
   *
   * @param err - Erro lançado pela strategy (inclui erro de infra do Prisma)
   * @param user - Usuário validado ou false/null
   * @param info - Info do Passport (TokenExpiredError, JsonWebTokenError, ...)
   * @param context - Contexto de execução (usado só para anotar o request)
   * @returns user se válido, null se inválido (sem lançar)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRequest<TUser = any>(err: any, user: any, info?: any, context?: ExecutionContext): TUser {
    if (!user) {
      this.recordFailure(err, info, context);
    }

    // Retorna null em vez de lançar — AuthCompositeGuard decide
    return user as TUser;
  }

  /**
   * Classifica a falha de JWT e emite os contadores (F0).
   *
   * Não lança e não altera o fluxo — apenas observa.
   */
  private recordFailure(err: unknown, info: unknown, context?: ExecutionContext): void {
    let reason: AuthFailureReason;
    let detail: string | undefined;

    if (err) {
      // `err` preenchido = a strategy LANÇOU. Pode ser credencial inválida
      // (UnauthorizedException de JwtStrategy.validate) OU infra (Prisma/Redis).
      const classified = classifyInfraError(err);

      if (classified.isInfra) {
        reason = 'guard_exception';
        detail = classified.code ?? classified.kind;

        // PROVA DA HIPÓTESE B3 ("lentidão de banco desloga"). Se este contador
        // for > 0 no baseline de 48 h, o 401 do usuário NÃO era do token.
        this.metrics?.increment(
          'auth.guard.infra_error',
          {
            guard: 'JwtAuthGuard',
            kind: classified.kind,
            code: classified.code,
            errorName: classified.name,
          },
          { level: 'error' },
        );
      } else {
        reason = 'token_invalid';
        detail = classified.name;
      }
    } else {
      // Sem `err`: o Passport reporta o motivo em `info`.
      const infoName = (info as { name?: string } | undefined)?.name;
      const infoMessage = (info as { message?: string } | undefined)?.message ?? '';

      if (infoName === 'TokenExpiredError') {
        reason = 'token_expired';
      } else if (!info || /no auth token/i.test(infoMessage)) {
        reason = 'no_credential';
      } else {
        reason = 'token_invalid';
      }
      detail = infoName;
    }

    this.metrics?.increment(
      'auth.jwt.failure',
      { reason, detail },
      { level: reason === 'guard_exception' ? 'warn' : 'debug' },
    );

    // Anota o request para o AuthCompositeGuard rotular o `auth.401` final.
    const request = context?.switchToHttp().getRequest<Record<string, unknown>>();
    if (request) {
      request[AUTH_FAILURE_REASON_KEY] = reason;
    }
  }
}
