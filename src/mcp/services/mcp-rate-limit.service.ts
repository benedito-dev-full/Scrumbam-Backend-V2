import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import {
  MCP_RATE_LIMIT_MAX_REQUESTS,
  MCP_RATE_LIMIT_WINDOW_SECONDS,
} from '../constants';

export interface McpRateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds?: number;
}

interface RedisMultiLike {
  incr(key: string): RedisMultiLike;
  expire(key: string, seconds: number): RedisMultiLike;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

interface RedisRateLimitClient {
  multi(): RedisMultiLike;
  on?(event: string, listener: (err: Error) => void): void;
}

@Injectable()
export class McpRateLimitService implements OnModuleInit {
  private readonly logger = new Logger(McpRateLimitService.name);

  private redis: RedisRateLimitClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    if (this.configService.get<string>('MCP_ENABLED') !== 'true') {
      return;
    }

    this.initRedis();
  }

  async check(keyHash: string): Promise<McpRateLimitResult> {
    if (!this.redis) {
      return this.allowWithoutRedis();
    }

    try {
      const key = `mcp:rl:${keyHash}`;
      const result = await this.redis
        .multi()
        .incr(key)
        .expire(key, MCP_RATE_LIMIT_WINDOW_SECONDS)
        .exec();

      const count = this.extractCount(result);
      return {
        allowed: count <= MCP_RATE_LIMIT_MAX_REQUESTS,
        count,
        retryAfterSeconds:
          count > MCP_RATE_LIMIT_MAX_REQUESTS ? MCP_RATE_LIMIT_WINDOW_SECONDS : undefined,
      };
    } catch (err) {
      return this.allowWithoutRedis(err);
    }
  }

  setRedisClientForTesting(redis: RedisRateLimitClient | null): void {
    this.redis = redis;
  }

  private extractCount(result: Array<[Error | null, unknown]> | null): number {
    const count = result?.[0]?.[1];
    return typeof count === 'number' ? count : 0;
  }

  private allowWithoutRedis(err?: unknown): McpRateLimitResult {
    const message = err instanceof Error ? ` error=${err.message}` : '';
    this.logger.warn(`mcp_ratelimit_redis_unavailable${message}`);
    return { allowed: true, count: 0 };
  }

  private initRedis(): void {
    try {
      const redisUrl = this.configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
      this.redis = new Redis(redisUrl, {
        lazyConnect: true,
        enableReadyCheck: false,
        maxRetriesPerRequest: 1,
      });

      this.redis.on?.('error', (err) => {
        this.logger.warn(`mcp_ratelimit_redis_error error=${err.message}`);
      });
    } catch (err) {
      this.allowWithoutRedis(err);
      this.redis = null;
    }
  }
}
