import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { Request } from 'express';

/**
 * ExecutionThrottlerGuard — limita 30 execuções/min por projeto.
 *
 * Usa SHA-256 do projectId como chave do tracker para:
 * - Não expor o projectId diretamente no storage
 * - Limitar por projeto (não por IP, que pode ser compartilhado)
 *
 * Configuração: ThrottlerModule.forRoot([{ ttl: 60000, limit: 30 }])
 *
 * @see ExecutionsModule para configuração do ThrottlerModule
 */
@Injectable()
export class ExecutionThrottlerGuard extends ThrottlerGuard {
  /**
   * Retorna a chave do tracker baseada no projectId (hash SHA-256).
   * Fallback para req.ip se projectId não disponível.
   *
   * @param req - Request HTTP
   * @returns Promise com hash da chave
   */
  protected async getTracker(req: Request): Promise<string> {
    const projectId =
      (req.params as any)?.id ?? (req.query as any)?.projectId;

    if (!projectId) {
      // Fallback para IP se não houver projectId
      return req.ip ?? 'unknown';
    }

    // Hash SHA-256 para não expor projectId no storage
    return createHash('sha256')
      .update(`proj-${projectId}`)
      .digest('hex');
  }
}
