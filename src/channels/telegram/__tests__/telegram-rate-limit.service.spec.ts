import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TelegramRateLimitService } from '../telegram-rate-limit.service';

describe('TelegramRateLimitService', () => {
  let service: TelegramRateLimitService;
  let redis: { eval: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramRateLimitService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('false') } },
      ],
    }).compile();

    service = module.get(TelegramRateLimitService);
    redis = { eval: jest.fn() };
    (service as unknown as { redis: typeof redis }).redis = redis;
  });

  it('deve permitir as 30 primeiras mensagens da janela', async () => {
    redis.eval.mockResolvedValue([30, 60]);

    const result = await service.check(BigInt(123), 'corr-1');

    expect(result).toEqual({ allowed: true, count: 30, ttlSeconds: 60 });
  });

  it('deve bloquear a 31a mensagem da janela', async () => {
    redis.eval.mockResolvedValue([31, 55]);

    const result = await service.check(BigInt(123), 'corr-1');

    expect(result).toEqual({ allowed: false, count: 31, ttlSeconds: 55 });
  });

  it('deve usar script atomico com INCR e EXPIRE', async () => {
    redis.eval.mockResolvedValue([1, 60]);

    await service.check(BigInt(123), 'corr-1');

    const [script, keyCount, key, windowSeconds] = redis.eval.mock.calls[0];
    expect(script).toContain('INCR');
    expect(script).toContain('EXPIRE');
    expect(keyCount).toBe(1);
    expect(key).toBe('rate:telegram:123');
    expect(windowSeconds).toBe(60);
  });

  it('deve permitir em modo degradado quando Redis nao existe', async () => {
    (service as unknown as { redis: null }).redis = null;

    const result = await service.check(BigInt(123), 'corr-1');

    expect(result.allowed).toBe(true);
  });
});
