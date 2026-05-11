import { Injectable, Logger } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

export interface TtlCacheStats {
  size: number;
  maxEntries: number;
}

/**
 * Cache TTL in-memory process-local para agregacoes read-only.
 *
 * O cache nao tem dependencia externa e nao e compartilhado entre replicas.
 * Erros de factory em `getOrSet` nao sao cacheados.
 */
@Injectable()
export class TtlCacheService {
  private readonly logger = new Logger(TtlCacheService.name);
  private readonly store = new Map<string, CacheEntry<unknown>>();

  private readonly maxEntries = 500;

  /**
   * Retorna valor cacheado quando a chave existe e ainda nao expirou.
   *
   * @param key - Chave normalizada do cache
   * @returns Valor cacheado ou undefined em miss/expiracao
   */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.removeKey(key);
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * Grava valor no cache por um TTL em milissegundos.
   *
   * @param key - Chave normalizada do cache
   * @param value - Valor a cachear
   * @param ttlMs - TTL em milissegundos
   */
  set<T>(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) {
      this.logger.warn(`TTL invalido ignorado para key=${key}`);
      return;
    }

    const now = Date.now();
    this.store.set(key, {
      value,
      createdAt: now,
      expiresAt: now + ttlMs,
    });

    this.evictExpired();
    this.evictOldestIfNeeded();
  }

  /**
   * Retorna valor cacheado ou executa factory e grava o resultado.
   *
   * Se a factory falhar, o erro e propagado e nada e gravado.
   *
   * @param key - Chave normalizada do cache
   * @param ttlMs - TTL em milissegundos
   * @param factory - Funcao assíncrona que produz o valor em caso de miss
   * @returns Valor cacheado ou produzido pela factory
   */
  async getOrSet<T>(key: string, ttlMs: number, factory: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Remove uma chave do cache.
   *
   * @param key - Chave a remover
   */
  delete(key: string): void {
    this.removeKey(key);
  }

  /**
   * Limpa todo o cache local.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Retorna estatisticas simples do cache para testes e logs.
   *
   * @returns Tamanho atual e limite de entradas
   */
  stats(): TtlCacheStats {
    this.evictExpired();
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
    };
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.removeKey(key);
      }
    }
  }

  private evictOldestIfNeeded(): void {
    while (this.store.size > this.maxEntries) {
      let oldestKey: string | undefined;
      let oldestCreatedAt = Number.POSITIVE_INFINITY;

      for (const [key, entry] of this.store.entries()) {
        if (entry.createdAt < oldestCreatedAt) {
          oldestCreatedAt = entry.createdAt;
          oldestKey = key;
        }
      }

      if (!oldestKey) {
        return;
      }

      this.removeKey(oldestKey);
    }
  }

  private removeKey(key: string): void {
    const remove = this.store.delete.bind(this.store);
    remove(key);
  }
}
