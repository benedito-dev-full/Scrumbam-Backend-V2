/**
 * Rate limit defensivo (60 req/min por agentId).
 *
 * Defesa em profundidade: o backend já aplica 30 req/min server-side
 * (`AgentSecurityService.assertRateLimit`). O agente impõe um teto
 * mais permissivo (60) para detectar comportamento anômalo de qualquer
 * cliente que consiga alcançar o socket local (cenário raro — exige
 * bind acidental fora do loopback, túnel SSH comprometido, etc).
 *
 * Implementação: `express-rate-limit` com store em memória. Chave do
 * limite é o header `x-scrumban-agent-id`. Em request com header
 * ausente cai para `unknown-agent` (cobre tentativas pré-HMAC).
 *
 * **Ordenação no pipeline:** este middleware vem APÓS o middleware
 * HMAC porque queremos contabilizar apenas requests autenticados (caso
 * contrário um atacante poderia exaurir o limite só assinando headers
 * inválidos). HMAC inválido = 401 e o request nem entra na conta.
 *
 * @see ADR-V2-033
 */
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request } from 'express';

const WINDOW_MS = 60_000; // 1min
const MAX_PER_WINDOW = 60;

/**
 * Cria o middleware de rate limit. Retorna o handler pronto para
 * `app.use(...)`. Cada chamada da factory cria um store novo —
 * em produção é instanciado uma vez no bootstrap.
 *
 * @param overrides Override opcional de `windowMs` e `max` (úteis em testes).
 *
 * @example
 *   const limiter = createRateLimitMiddleware();
 *   app.post('/v1/execute', hmacMiddleware, limiter, dispatcher);
 */
export function createRateLimitMiddleware(overrides?: {
  windowMs?: number;
  max?: number;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: overrides?.windowMs ?? WINDOW_MS,
    max: overrides?.max ?? MAX_PER_WINDOW,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const id = req.headers['x-scrumban-agent-id'];
      if (typeof id === 'string' && id.length > 0) return id;
      if (Array.isArray(id) && id.length > 0) return id[0];
      return 'unknown-agent';
    },
    message: {
      accepted: false,
      errorCode: 'RATE_LIMIT_EXCEEDED',
      message: 'Rate limit excedido (60 req/min por agentId)',
    },
  });
}
