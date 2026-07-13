import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

// Services do projeto
import { CorrelationIdService } from '../services/correlation-id.service';
import { AUTH_ERROR_CODES } from '../errors/error-codes';

/**
 * Formato canônico do payload de error response V2.
 *
 * Todos os erros HTTP 4xx/5xx retornam este formato.
 */
export interface ErrorResponsePayload {
  statusCode: number;
  /**
   * Discriminador machine-readable (RFC 9457 — Problem Details).
   *
   * Presente sempre que a exceção o declarou (ex.: `NO_WORKSPACE`,
   * `TOKEN_INVALID`, `AUTH_BACKEND_UNAVAILABLE`). Até a F1 este campo era
   * **descartado** pelo filter — o frontend recebia só `message`, não
   * conseguia distinguir "sessão morta" de "banco fora do ar" e deslogava o
   * usuário nos dois casos.
   */
  code?: string;
  message: string | string[];
  error?: string;
  correlationId: string;
  timestamp: string;
  path: string;
}

/**
 * Filtro global que padroniza TODOS os responses de erro (4xx/5xx).
 *
 * **`@Catch()` sem argumento (F1, item 1.4):** captura qualquer exceção, não
 * apenas `HttpException`. Antes, um `throw new Error(...)` cru (como o do
 * `findUserGroupByRefreshToken`) escapava do filter e virava um 500 sem
 * `correlationId` — comportamento indefinido no caminho de auth. Agora toda
 * exceção não-HTTP vira **500 com `code: INTERNAL_ERROR`**, logada com stack no
 * servidor e **sem vazar stack** para o cliente.
 *
 * Formato do response:
 * ```json
 * {
 *   "statusCode": 401,
 *   "code": "TOKEN_INVALID",
 *   "message": "Refresh token não encontrado",
 *   "error": "Unauthorized",
 *   "correlationId": "550e8400-e29b-41d4-a716-446655440000",
 *   "timestamp": "2026-07-13T12:00:00.000Z",
 *   "path": "/api/v1/auth/refresh"
 * }
 * ```
 *
 * Registrado globalmente no AppModule:
 * ```typescript
 * { provide: APP_FILTER, useClass: HttpExceptionFilter }
 * ```
 *
 * @see AUTH_ERROR_CODES — catálogo dos códigos e da ação esperada do cliente
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly correlationIdService: CorrelationIdService) {}

  /**
   * Captura a exceção e formata o response de erro.
   *
   * @param exception - Exceção lançada (HttpException ou qualquer outra)
   * @param host - ArgumentsHost do NestJS
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const correlationId = this.correlationIdService.get() ?? 'no-correlation-id';
    const timestamp = new Date().toISOString();
    const path = request.url;

    const payload = this.buildPayload(exception, correlationId, timestamp, path);

    if (payload.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // 5xx sempre com stack no log do servidor (nunca no corpo da resposta).
      this.logger.error(
        `HTTP ${payload.statusCode} — ${path} — ${JSON.stringify(payload.message)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`HTTP ${payload.statusCode} — ${path}`, {
        correlationId,
        statusCode: payload.statusCode,
        code: payload.code,
        path,
        message: payload.message,
      });
    }

    response.status(payload.statusCode).json(payload);
  }

  /**
   * Monta o payload canônico, preservando `code` quando a exceção o declara.
   */
  private buildPayload(
    exception: unknown,
    correlationId: string,
    timestamp: string,
    path: string,
  ): ErrorResponsePayload {
    if (!(exception instanceof HttpException)) {
      // Exceção CRUA (bug, erro de infra não tratado): 500 padronizado.
      // Nunca expõe `exception.message` — pode conter detalhe interno.
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: AUTH_ERROR_CODES.INTERNAL_ERROR,
        message: 'Erro interno do servidor',
        error: 'Internal Server Error',
        correlationId,
        timestamp,
        path,
      };
    }

    const statusCode = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    let message: string | string[];
    let error: string | undefined;
    let code: string | undefined;

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const resp = exceptionResponse as Record<string, unknown>;
      message = (resp.message as string | string[]) ?? exception.message;
      error = resp.error as string | undefined;
      // O CAMPO QUE ERA JOGADO FORA (RFC 9457).
      code = typeof resp.code === 'string' ? resp.code : undefined;
    } else {
      message = exception.message;
    }

    return {
      statusCode,
      ...(code ? { code } : {}),
      message,
      ...(error ? { error } : {}),
      correlationId,
      timestamp,
      path,
    };
  }
}
