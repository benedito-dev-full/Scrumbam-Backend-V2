/**
 * Cache LRU (Least Recently Used) genérico com TTL.
 *
 * Implementação simples de cache LRU usando Map nativo do JavaScript,
 * que preserva a ordem de inserção. Usado principalmente para o alias
 * de compatibilidade `?classe=NOME` → `idClasse` (ADR-V2-015).
 *
 * Parâmetros padrão:
 * - maxSize: 200 entradas
 * - ttlMs: 300.000ms (5 minutos)
 *
 * @typeParam K - Tipo da chave do cache
 * @typeParam V - Tipo do valor armazenado
 *
 * @example
 * ```typescript
 * const cache = new LRUCache<string, bigint>(200, 300_000);
 *
 * cache.set('USER', BigInt(-150));
 * const id = cache.get('USER'); // BigInt(-150)
 *
 * // Após TTL expirado
 * const expired = cache.get('USER'); // undefined
 * ```
 */
export class LRUCache<K, V> {
  private readonly cache = new Map<K, { value: V; expiresAt: number }>();

  /**
   * Cria instância do cache LRU.
   *
   * @param maxSize - Número máximo de entradas (default: 200)
   * @param ttlMs - Tempo de vida em milissegundos (default: 300.000 = 5min)
   */
  constructor(
    private readonly maxSize: number = 200,
    private readonly ttlMs: number = 300_000,
  ) {}

  /**
   * Busca valor no cache.
   *
   * Retorna undefined se: chave não existe, ou TTL expirado.
   * Em caso de hit, move a entrada para o final (mais recente).
   *
   * @param key - Chave a buscar
   * @returns Valor armazenado ou undefined se ausente/expirado
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Mover para o final (LRU: mais recentemente usado)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Armazena valor no cache.
   *
   * Se o cache atingir maxSize, remove a entrada menos recentemente usada
   * (primeiro elemento do Map) antes de inserir.
   *
   * @param key - Chave
   * @param value - Valor a armazenar
   */
  set(key: K, value: V): void {
    // Evict se já existia (para reposicionar no final)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict LRU se cheio
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Remove entrada do cache.
   *
   * @param key - Chave a remover
   */
  delete(key: K): void {
    this.cache.delete(key);
  }

  /**
   * Remove todas as entradas do cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Retorna o número atual de entradas (incluindo possíveis expiradas).
   */
  get size(): number {
    return this.cache.size;
  }
}
