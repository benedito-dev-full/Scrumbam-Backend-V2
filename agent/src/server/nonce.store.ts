/**
 * Nonce store anti-replay (in-memory, single-process).
 *
 * Cada request HMAC inbound traz um nonce (UUID v4) no header
 * `x-scrumban-nonce`. Esse store rejeita o mesmo nonce dentro de uma janela
 * de 10min — sincronizada com o skew window do timestamp (±5min): qualquer
 * nonce mais velho que isso seria rejeitado pelo middleware de timestamp
 * antes mesmo de chegar aqui, então não precisa de TTL maior.
 *
 * **Por que LRU local e não Redis:** o agente é single-process,
 * single-tenant (uma VPS = um agente). Não há fan-out entre instâncias
 * (diferente do backend, que tem múltiplos workers e usa Redis). Map
 * em memória com cleanup TTL é simples e suficiente.
 *
 * Capacidade máxima: 10_000 entries. Se o atacante tentar inundar com
 * nonces únicos para causar OOM, o LRU descarta os mais antigos —
 * comportamento aceitável porque já passariam pelo skew window de 5min
 * se quisessem ser reutilizados.
 *
 * @see ADR-V2-033 (contrato HTTP+HMAC)
 */
import { LRUCache } from 'lru-cache';

const NONCE_TTL_MS = 10 * 60 * 1000; // 10min — alinhado com timestamp skew
const NONCE_MAX_ENTRIES = 10_000;

/**
 * Store anti-replay. `has(nonce)` retorna true se o nonce já foi visto e
 * ainda está dentro do TTL. `add(nonce)` registra o nonce. Operações são
 * idempotentes do ponto de vista do caller — `add` em nonce já existente
 * apenas atualiza o LRU recency (não duplica).
 */
export interface NonceStore {
  /** Retorna true se o nonce já foi visto e está dentro do TTL. */
  has(nonce: string): boolean;

  /** Registra o nonce no store. */
  add(nonce: string): void;

  /**
   * Quantidade de entries ativos (útil para métricas e testes).
   */
  size(): number;

  /**
   * Limpa todos os nonces (utilitário de teste).
   */
  clear(): void;
}

/**
 * Factory de `NonceStore` backed por `lru-cache`. Cria um store fresh
 * em cada chamada — em produção é instanciado uma vez no bootstrap do
 * `http.server.ts` e compartilhado entre requests.
 *
 * @param options Override de TTL e capacity (default 10min / 10k entries).
 *
 * @example
 *   const store = createNonceStore();
 *   if (store.has(nonce)) throw new Error('replay');
 *   store.add(nonce);
 */
export function createNonceStore(options?: { ttlMs?: number; maxEntries?: number }): NonceStore {
  const cache = new LRUCache<string, true>({
    max: options?.maxEntries ?? NONCE_MAX_ENTRIES,
    ttl: options?.ttlMs ?? NONCE_TTL_MS,
    ttlAutopurge: true,
  });

  return {
    has(nonce: string): boolean {
      return cache.has(nonce);
    },
    add(nonce: string): void {
      cache.set(nonce, true);
    },
    size(): number {
      return cache.size;
    },
    clear(): void {
      cache.clear();
    },
  };
}
