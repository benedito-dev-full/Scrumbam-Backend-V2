import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export interface TelegramRateLimitResult {
  allowed: boolean;
  count: number;
  ttlSeconds: number;
}

/**
 * Rate limit por chatId para o webhook Telegram.
 *
 * Usa Redis com script Lua atomico (`INCR` + `EXPIRE` na mesma operacao).
 * Em modo degradado sem Redis, permite o processamento e registra warning.
 */
@Injectable()
export class TelegramRateLimitService implements OnModuleInit {
  private readonly logger = new Logger(TelegramRateLimitService.name);

  private static readonly WINDOW_SECONDS = 60;
  private static readonly LIMIT = 30;
  private static readonly KEY_PREFIX = 'rate:telegram:';

  private redis: Redis | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const enabled = this.configService.get<string>('CHANNELS_ENABLED');
    if (enabled !== 'true') {
      this.logger.debug('CHANNELS_ENABLED !== "true" - rate limit Redis ignorado');
      return;
    }

    this.initRedis();
  }

  /**
   * Verifica se o chatId pode processar mais uma mensagem na janela atual.
   *
   * @param chatId - chatId Telegram como BigInt
   * @param correlationId - update_id do Telegram como string
   */
  async check(chatId: bigint, correlationId: string): Promise<TelegramRateLimitResult> {
    if (!this.redis) {
      this.logger.warn(
        `telegram_rate_limit_redis_unavailable chatId=${chatId} correlationId=${correlationId}`,
      );
      return { allowed: true, count: 0, ttlSeconds: 0 };
    }

    const key = `${TelegramRateLimitService.KEY_PREFIX}${chatId}`;
    const script = `
      local current = redis.call('INCR', KEYS[1])
      if current == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
      end
      local ttl = redis.call('TTL', KEYS[1])
      return { current, ttl }
    `;

    const result = await this.redis
      .eval(script, 1, key, TelegramRateLimitService.WINDOW_SECONDS)
      .catch((err) => {
        this.logger.warn(
          `telegram_rate_limit_redis_error chatId=${chatId} correlationId=${correlationId} error=${(err as Error).message}`,
        );
        return [0, 0] as [number, number];
      });

    const [countRaw, ttlRaw] = Array.isArray(result) ? result : [0, 0];
    const count = Number(countRaw);
    const ttlSeconds = Number(ttlRaw);
    const allowed = count <= TelegramRateLimitService.LIMIT || count === 0;

    if (!allowed) {
      this.logger.warn(
        `rate_limit_reached chatId=${chatId} correlationId=${correlationId} count=${count}`,
      );
    }

    return { allowed, count, ttlSeconds };
  }

  /**
   * Inicializa o Redis usado exclusivamente para rate limit.
   * Falha nao derruba o modulo; o servico opera em modo degradado.
   */
  private initRedis(): void {
    try {
      const redisUrl = this.configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
      this.redis = new Redis(redisUrl, {
        lazyConnect: true,
        enableReadyCheck: false,
        maxRetriesPerRequest: 1,
      });

      this.redis.on('error', (err) => {
        this.logger.warn(`telegram_rate_limit_redis_error error=${(err as Error).message}`);
      });
    } catch (err) {
      this.logger.warn(
        `telegram_rate_limit_redis_init_failed error=${(err as Error).message}`,
      );
      this.redis = null;
    }
  }
}
