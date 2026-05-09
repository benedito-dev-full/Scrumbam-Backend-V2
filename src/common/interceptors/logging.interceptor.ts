import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

// Services do projeto
import { CorrelationIdService } from '../services/correlation-id.service';

/**
 * Interceptor que loga informações estruturadas de cada request HTTP.
 *
 * Emite um log JSON ao final de cada request com os campos:
 * - `method` — verbo HTTP (GET, POST, etc.)
 * - `path` — rota do endpoint
 * - `statusCode` — código HTTP da resposta
 * - `durationMs` — tempo total de processamento em ms
 * - `correlationId` — ID de rastreamento do request
 * - `userId` — ID do usuário autenticado (se disponível em `req.user`)
 *
 * Registrar globalmente no AppModule:
 * ```typescript
 * { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }
 * ```
 *
 * @example Log gerado (formato estruturado):
 * ```json
 * {
 *   "level": "log",
 *   "message": "GET /api/v1/health → 200 (12ms)",
 *   "context": "LoggingInterceptor",
 *   "method": "GET",
 *   "path": "/api/v1/health",
 *   "statusCode": 200,
 *   "durationMs": 12,
 *   "correlationId": "550e8400-e29b-41d4-a716-446655440000",
 *   "userId": "42"
 * }
 * ```
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  constructor(private readonly correlationIdService: CorrelationIdService) {}

  /**
   * Intercepta o request e registra timing e metadados.
   *
   * @param context - Contexto de execução NestJS
   * @param next - Handler do próximo passo no pipeline
   * @returns Observable do resultado
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    const { method, url } = req;
    const correlationId = this.correlationIdService.get() ?? 'no-correlation-id';
    const userId = (req as Request & { user?: { sub?: string } }).user?.sub;

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - startTime;
          const statusCode = res.statusCode;

          this.logger.log(`${method} ${url} → ${statusCode} (${durationMs}ms)`, {
            method,
            path: url,
            statusCode,
            durationMs,
            correlationId,
            userId,
          });
        },
        error: (error: Error) => {
          const durationMs = Date.now() - startTime;
          // Status code do error pode ser extraído se for HttpException
          const statusCode = (error as { status?: number }).status ?? 500;

          this.logger.warn(`${method} ${url} → ${statusCode} (${durationMs}ms) [ERRO]`, {
            method,
            path: url,
            statusCode,
            durationMs,
            correlationId,
            userId,
            error: error.message,
          });
        },
      }),
    );
  }
}
