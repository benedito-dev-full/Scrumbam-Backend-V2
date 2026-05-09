import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

// Services do projeto
import { CorrelationIdService } from '../services/correlation-id.service';

/**
 * Formato canônico do payload de error response V2.
 *
 * Todos os erros HTTP 4xx/5xx retornam este formato.
 */
export interface ErrorResponsePayload {
  statusCode: number;
  message: string | string[];
  error?: string;
  correlationId: string;
  timestamp: string;
  path: string;
}

/**
 * Filtro global que padroniza todos os responses de erro HTTP (4xx/5xx).
 *
 * Intercepta qualquer `HttpException` lançada em controllers ou services e
 * formata o response no padrão canônico V2 com `correlationId` e `timestamp`.
 *
 * Formato do response:
 * ```json
 * {
 *   "statusCode": 404,
 *   "message": "Entidade não encontrada",
 *   "error": "Not Found",
 *   "correlationId": "550e8400-e29b-41d4-a716-446655440000",
 *   "timestamp": "2026-05-09T12:00:00.000Z",
 *   "path": "/api/v1/entidades/999"
 * }
 * ```
 *
 * Registrar globalmente no AppModule:
 * ```typescript
 * { provide: APP_FILTER, useClass: HttpExceptionFilter }
 * ```
 *
 * @example Erros de validação (class-validator retorna array):
 * ```json
 * {
 *   "statusCode": 400,
 *   "message": ["nome must be a string", "idClasse must not be empty"],
 *   "error": "Bad Request",
 *   "correlationId": "abc-123",
 *   "timestamp": "2026-05-09T12:00:00.000Z",
 *   "path": "/api/v1/entidades"
 * }
 * ```
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly correlationIdService: CorrelationIdService) {}

  /**
   * Captura a exceção e formata o response de erro.
   *
   * @param exception - HttpException lançada
   * @param host - ArgumentsHost do NestJS
   */
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const statusCode = exception.getStatus();

    const exceptionResponse = exception.getResponse();
    const correlationId = this.correlationIdService.get() ?? 'no-correlation-id';
    const timestamp = new Date().toISOString();
    const path = request.url;

    let message: string | string[];
    let error: string | undefined;

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const resp = exceptionResponse as Record<string, unknown>;
      message = (resp.message as string | string[]) ?? exception.message;
      error = resp.error as string | undefined;
    } else {
      message = exception.message;
    }

    const payload: ErrorResponsePayload = {
      statusCode,
      message,
      ...(error ? { error } : {}),
      correlationId,
      timestamp,
      path,
    };

    this.logger.warn(`HTTP ${statusCode} — ${path}`, {
      correlationId,
      statusCode,
      path,
      message,
    });

    response.status(statusCode).json(payload);
  }
}
