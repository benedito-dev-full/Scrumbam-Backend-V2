import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

// NestJS — já importado acima
import { CorrelationIdService } from '../services/correlation-id.service';

/** Nome do header HTTP de Correlation ID (padrão de mercado). */
const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Middleware que injeta e propaga o Correlation ID em cada request.
 *
 * Comportamento:
 * 1. Lê o header `X-Correlation-Id` do request (se enviado pelo cliente/gateway).
 * 2. Se ausente, gera um novo UUID v4 via `crypto.randomUUID()`.
 * 3. Salva o ID no `CorrelationIdService` (AsyncLocalStorage — seguro para concorrência).
 * 4. Adiciona o ID ao response header `X-Correlation-Id` (para rastreamento do cliente).
 *
 * Registrar no AppModule:
 * ```typescript
 * configure(consumer: MiddlewareConsumer): void {
 *   consumer.apply(CorrelationIdMiddleware).forRoutes('*');
 * }
 * ```
 *
 * @example
 * ```bash
 * # Request com Correlation ID do cliente
 * curl -H "X-Correlation-Id: my-trace-123" http://localhost:3000/api/v1/health -i
 * # Response inclui: X-Correlation-Id: my-trace-123
 *
 * # Request sem Correlation ID
 * curl http://localhost:3000/api/v1/health -i
 * # Response inclui: X-Correlation-Id: <UUID gerado>
 * ```
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly correlationIdService: CorrelationIdService) {}

  /**
   * Processa o request injetando o Correlation ID.
   *
   * @param req - Request Express
   * @param res - Response Express
   * @param next - Próximo middleware
   */
  use(req: Request, res: Response, next: NextFunction): void {
    const existingId = req.headers[CORRELATION_HEADER] as string | undefined;
    const correlationId = existingId ?? crypto.randomUUID();

    // Executa o restante do pipeline dentro do contexto AsyncLocalStorage
    this.correlationIdService.run(() => {
      this.correlationIdService.set(correlationId);
      res.setHeader('X-Correlation-Id', correlationId);
      next();
    });
  }
}
