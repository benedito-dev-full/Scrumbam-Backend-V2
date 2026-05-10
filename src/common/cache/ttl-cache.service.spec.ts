import { TtlCacheService } from './ttl-cache.service';

describe('TtlCacheService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('retorna miss quando vazio', () => {
    const service = new TtlCacheService();

    expect(service.get('missing')).toBeUndefined();
  });

  it('retorna hit antes do TTL', () => {
    const service = new TtlCacheService();

    service.set('key', { value: 1 }, 1000);

    expect(service.get('key')).toEqual({ value: 1 });
  });

  it('expira depois do TTL', () => {
    jest.useFakeTimers();
    const service = new TtlCacheService();

    service.set('key', 'value', 1000);
    jest.advanceTimersByTime(1001);

    expect(service.get('key')).toBeUndefined();
  });

  it('getOrSet cacheia resultado e respeita isolamento por chave', async () => {
    const service = new TtlCacheService();
    const factoryA = jest.fn().mockResolvedValue('A');
    const factoryB = jest.fn().mockResolvedValue('B');

    await expect(service.getOrSet('org:1:project:1', 1000, factoryA)).resolves.toBe('A');
    await expect(service.getOrSet('org:1:project:1', 1000, factoryA)).resolves.toBe('A');
    await expect(service.getOrSet('org:1:project:2', 1000, factoryB)).resolves.toBe('B');

    expect(factoryA).toHaveBeenCalledTimes(1);
    expect(factoryB).toHaveBeenCalledTimes(1);
  });

  it('nao cacheia erro de factory', async () => {
    const service = new TtlCacheService();
    const factory = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');

    await expect(service.getOrSet('key', 1000, factory)).rejects.toThrow('boom');
    await expect(service.getOrSet('key', 1000, factory)).resolves.toBe('ok');

    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('remove entradas mais antigas quando ultrapassa maxEntries', () => {
    const service = new TtlCacheService(2);

    service.set('a', 1, 1000);
    service.set('b', 2, 1000);
    service.set('c', 3, 1000);

    expect(service.get('a')).toBeUndefined();
    expect(service.get('b')).toBe(2);
    expect(service.get('c')).toBe(3);
    expect(service.stats()).toEqual({ size: 2, maxEntries: 2 });
  });
});
