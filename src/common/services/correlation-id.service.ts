import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import * as crypto from 'crypto';

/** Armazenamento thread-local para o ID de correlação por request. */
const storage = new AsyncLocalStorage<Map<string, string>>();

/**
 * Serviço de Correlation ID usando AsyncLocalStorage.
 *
 * Garante que cada request tenha um ID único rastreável em todos os logs
 * e responses, sem race conditions entre requests concorrentes.
 *
 * Fluxo típico:
 * 1. `CorrelationIdMiddleware` chama `set()` no início de cada request.
 * 2. `LoggingInterceptor` chama `get()` para incluir nos logs.
 * 3. `HttpExceptionFilter` chama `get()` para incluir no error response.
 * 4. O middleware adiciona `X-Correlation-Id` ao response header.
 *
 * @example
 * ```typescript
 * // No middleware (início do request)
 * correlationIdService.set('my-uuid-v4');
 *
 * // Em qualquer service/interceptor durante o mesmo request
 * const id = correlationIdService.get(); // 'my-uuid-v4'
 * const id2 = correlationIdService.getOrGenerate(); // gera se não existir
 * ```
 */
@Injectable()
export class CorrelationIdService {
  /**
   * Define o ID de correlação para o request atual.
   *
   * Deve ser chamado dentro de um contexto AsyncLocalStorage ativo
   * (tipicamente no middleware antes de `next()`).
   *
   * @param id - ID de correlação (UUID v4 recomendado)
   */
  set(id: string): void {
    const store = storage.getStore();
    if (store) {
      store.set('correlationId', id);
    }
  }

  /**
   * Obtém o ID de correlação do request atual.
   *
   * @returns ID de correlação ou `undefined` se não definido
   *
   * @example
   * ```typescript
   * const correlationId = correlationIdService.get() ?? 'unknown';
   * this.logger.log(`Processando request`, { correlationId });
   * ```
   */
  get(): string | undefined {
    return storage.getStore()?.get('correlationId');
  }

  /**
   * Obtém o ID de correlação ou gera um novo UUID v4 se não existir.
   *
   * Útil em contextos onde o middleware pode não ter sido executado
   * (ex: chamadas internas, testes, jobs assíncronos).
   *
   * @returns ID de correlação existente ou novo UUID v4 gerado
   *
   * @example
   * ```typescript
   * // Sempre terá um ID, mesmo fora de contexto de request
   * const correlationId = correlationIdService.getOrGenerate();
   * ```
   */
  getOrGenerate(): string {
    return this.get() ?? crypto.randomUUID();
  }

  /**
   * Executa um callback dentro de um novo contexto AsyncLocalStorage.
   *
   * Usado internamente pelo middleware para iniciar o contexto por request.
   *
   * @param callback - Função a executar dentro do contexto isolado
   */
  run(callback: () => void): void {
    const store = new Map<string, string>();
    storage.run(store, callback);
  }
}
