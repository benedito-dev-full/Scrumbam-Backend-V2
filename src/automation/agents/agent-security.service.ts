import { ConflictException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

interface MemoryEntry {
  count?: number;
  expiresAt: number;
}

const RATE_LIMIT_PER_MINUTE = 30;
const RATE_LIMIT_TTL_SECONDS = 60;
const NONCE_TTL_SECONDS = 600;

@Injectable()
export class AgentSecurityService {
  private readonly logger = new Logger(AgentSecurityService.name);
  private readonly memory = new Map<string, MemoryEntry>();
  private redis: Redis | null = null;

  constructor(private readonly configService: ConfigService) {
    this.initRedis();
  }

  async assertRequestAllowed(agentId: string, nonce: string): Promise<void> {
    await this.assertNonce(agentId, nonce);
    await this.assertRateLimit(agentId);
  }

  setRedisClientForTesting(redis: Redis | null): void {
    this.redis = redis;
  }

  private async assertNonce(agentId: string, nonce: string): Promise<void> {
    const key = `automation:agent:${agentId}:nonce:${nonce}`;

    if (this.redis) {
      const result = await this.redis.set(key, '1', 'EX', NONCE_TTL_SECONDS, 'NX');
      if (result !== 'OK') {
        throw new ConflictException('Agent nonce replay detected');
      }
      return;
    }

    this.cleanupMemory();
    if (this.memory.has(key)) {
      throw new ConflictException('Agent nonce replay detected');
    }
    this.memory.set(key, { expiresAt: Date.now() + NONCE_TTL_SECONDS * 1000 });
  }

  private async assertRateLimit(agentId: string): Promise<void> {
    const key = `automation:agent:${agentId}:rate`;

    if (this.redis) {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, RATE_LIMIT_TTL_SECONDS);
      }
      if (count > RATE_LIMIT_PER_MINUTE) {
        throw new HttpException('Agent rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
      }
      return;
    }

    this.cleanupMemory();
    const now = Date.now();
    const current = this.memory.get(key);
    if (!current || current.expiresAt <= now) {
      this.memory.set(key, {
        count: 1,
        expiresAt: now + RATE_LIMIT_TTL_SECONDS * 1000,
      });
      return;
    }

    const nextCount = (current.count ?? 0) + 1;
    current.count = nextCount;
    if (nextCount > RATE_LIMIT_PER_MINUTE) {
      throw new HttpException('Agent rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private cleanupMemory(): void {
    const now = Date.now();
    for (const [key, entry] of this.memory.entries()) {
      if (entry.expiresAt <= now) {
        this.memory.delete(key);
      }
    }
  }

  private initRedis(): void {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl) {
      return;
    }

    try {
      this.redis = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      this.redis.on('error', (error) => {
        this.logger.warn(`agent_security_redis_error error=${error.message}`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`agent_security_redis_init_failed error=${message}`);
      this.redis = null;
    }
  }
}
