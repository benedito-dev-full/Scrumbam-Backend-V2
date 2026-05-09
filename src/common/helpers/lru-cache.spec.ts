import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  it('retorna valor cacheado (hit)', () => {
    const cache = new LRUCache<string, bigint>(10, 60_000);
    cache.set('USER', BigInt(-150));
    expect(cache.get('USER')).toBe(BigInt(-150));
  });

  it('retorna undefined após TTL expirado (miss)', () => {
    const cache = new LRUCache<string, bigint>(10, 1); // TTL 1ms
    cache.set('USER', BigInt(-150));
    // Aguardar TTL expirar
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cache.get('USER')).toBeUndefined();
        resolve();
      }, 10);
    });
  });

  it('realiza eviction do LRU quando maxSize é atingido', () => {
    const cache = new LRUCache<string, number>(2, 60_000);
    cache.set('A', 1);
    cache.set('B', 2);
    cache.set('C', 3); // deve evict A (LRU)
    expect(cache.get('A')).toBeUndefined();
    expect(cache.get('B')).toBe(2);
    expect(cache.get('C')).toBe(3);
  });
});
