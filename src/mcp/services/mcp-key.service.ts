import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Redis } from 'ioredis';

import { PrismaService } from '../../prisma.service';
import { MCP_KEY_CACHE_TTL_SECONDS, MCP_KEY_CLASS_ID } from '../constants';
import { McpKeyCreatedResponseDto, McpKeyListItemDto } from '../dto/mcp-key-response.dto';
import { McpKeyCachePayload } from '../interfaces/mcp.types';

interface StoredMcpKeyDados {
  prefix?: string;
  hash?: string;
  scopes?: string[];
  disabled?: boolean;
  createdAt?: string;
  lastUsedAt?: string | null;
}

@Injectable()
export class McpKeyService implements OnModuleInit {
  private readonly logger = new Logger(McpKeyService.name);

  private redis: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.configService.get<string>('MCP_ENABLED') !== 'true') {
      this.logger.warn('McpKeyService inicializado com MCP_ENABLED !== "true"');
      return;
    }

    this.initRedis();
  }

  async generate(userId: bigint, scopes: string[] = []): Promise<McpKeyCreatedResponseDto> {
    const plaintext = this.generatePlaintext();
    const hash = McpKeyService.sha256Hex(plaintext);
    const prefix = plaintext.slice(0, 12);
    const createdAt = new Date().toISOString();
    const safeScopes = [...new Set(scopes)];

    this.logger.log(`mcp_key_generate userId=${userId} scopes=${safeScopes.length}`);

    const tabela = await this.prisma.dTabela.create({
      data: {
        idClasse: MCP_KEY_CLASS_ID,
        nome: `MCP Key ${prefix}`,
        codigo: prefix,
        dEntidadeId: userId,
        dados: {
          prefix,
          hash,
          scopes: safeScopes,
          disabled: false,
          createdAt,
          lastUsedAt: null,
        } as Prisma.InputJsonValue,
      },
      select: {
        chave: true,
        criadoEm: true,
      },
    });

    return {
      id: tabela.chave.toString(),
      prefix,
      plaintext,
      scopes: safeScopes,
      createdAt: tabela.criadoEm.toISOString(),
    };
  }

  async list(userId: bigint): Promise<McpKeyListItemDto[]> {
    const keys = await this.prisma.dTabela.findMany({
      where: {
        idClasse: MCP_KEY_CLASS_ID,
        dEntidadeId: userId,
        excluido: false,
      },
      orderBy: { criadoEm: 'desc' },
      select: {
        chave: true,
        codigo: true,
        dados: true,
        criadoEm: true,
      },
    });

    return keys.map((key) => {
      const dados = this.parseDados(key.dados);
      return {
        id: key.chave.toString(),
        prefix: dados.prefix ?? key.codigo ?? '',
        scopes: dados.scopes ?? [],
        disabled: dados.disabled === true,
        createdAt: dados.createdAt ?? key.criadoEm.toISOString(),
        lastUsedAt: dados.lastUsedAt ?? null,
      };
    });
  }

  async revoke(userId: bigint, keyId: bigint): Promise<void> {
    const existing = await this.prisma.dTabela.findFirst({
      where: {
        chave: keyId,
        idClasse: MCP_KEY_CLASS_ID,
        dEntidadeId: userId,
        excluido: false,
      },
      select: {
        chave: true,
        dados: true,
      },
    });

    if (!existing) {
      throw new NotFoundException(`MCP Key ${keyId} não encontrada`);
    }

    const dados = this.parseDados(existing.dados);
    const updatedDados = {
      ...dados,
      disabled: true,
    } as Prisma.InputJsonValue;

    await this.prisma.dTabela.update({
      where: { chave: existing.chave },
      data: {
        excluido: true,
        inativo: true,
        dados: updatedDados,
      },
    });

    if (dados.hash) {
      await this.deleteCache(dados.hash);
    }
  }

  async validatePlaintext(plaintext: string): Promise<McpKeyCachePayload | null> {
    const hash = McpKeyService.sha256Hex(plaintext);
    const cached = await this.getCached(hash);
    if (cached) {
      return cached;
    }

    const matched = await this.prisma.dTabela.findFirst({
      where: {
        idClasse: MCP_KEY_CLASS_ID,
        excluido: false,
        inativo: false,
        dados: {
          path: ['hash'],
          equals: hash,
        },
      },
      select: {
        chave: true,
        dEntidadeId: true,
        dados: true,
        criadoEm: true,
      },
    });

    if (!matched || !matched.dEntidadeId) {
      return null;
    }

    const dados = this.parseDados(matched.dados);
    if (
      dados.disabled === true ||
      !dados.hash ||
      !McpKeyService.hashEquals(hash, dados.hash)
    ) {
      return null;
    }

    const payload: McpKeyCachePayload = {
      chave: matched.chave.toString(),
      dEntidadeId: matched.dEntidadeId.toString(),
      scopes: dados.scopes ?? [],
      prefix: dados.prefix ?? '',
      hash: dados.hash,
    };

    await this.setCached(hash, payload);
    this.touchLastUsedAt(matched.chave, dados);

    return payload;
  }

  static sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  static hashEquals(inputHash: string, storedHash: string): boolean {
    const input = Buffer.from(inputHash, 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    if (input.length !== stored.length) {
      return false;
    }

    return timingSafeEqual(input, stored);
  }

  private generatePlaintext(): string {
    return `scrumban_mcp_${randomBytes(32).toString('base64url')}`;
  }

  private parseDados(dados: Prisma.JsonValue): StoredMcpKeyDados {
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
      return {};
    }

    const raw = dados as Record<string, unknown>;
    return {
      prefix: typeof raw.prefix === 'string' ? raw.prefix : undefined,
      hash: typeof raw.hash === 'string' ? raw.hash : undefined,
      scopes: Array.isArray(raw.scopes)
        ? raw.scopes.filter((scope): scope is string => typeof scope === 'string')
        : [],
      disabled: raw.disabled === true,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
      lastUsedAt: typeof raw.lastUsedAt === 'string' ? raw.lastUsedAt : null,
    };
  }

  private touchLastUsedAt(chave: bigint, dados: StoredMcpKeyDados): void {
    const nextDados = {
      ...dados,
      lastUsedAt: new Date().toISOString(),
    } as Prisma.InputJsonValue;

    setImmediate(() => {
      this.prisma.dTabela
        .update({
          where: { chave },
          data: { dados: nextDados },
        })
        .catch((err) => {
          this.logger.warn(`mcp_key_last_used_update_failed keyId=${chave} error=${(err as Error).message}`);
        });
    });
  }

  private async getCached(hash: string): Promise<McpKeyCachePayload | null> {
    if (!this.redis) {
      return null;
    }

    try {
      const raw = await this.redis.get(this.cacheKey(hash));
      if (!raw) {
        return null;
      }

      return JSON.parse(raw) as McpKeyCachePayload;
    } catch (err) {
      this.logger.warn(`mcp_key_cache_get_failed error=${(err as Error).message}`);
      return null;
    }
  }

  private async setCached(hash: string, payload: McpKeyCachePayload): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.set(
        this.cacheKey(hash),
        JSON.stringify(payload),
        'EX',
        MCP_KEY_CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(`mcp_key_cache_set_failed error=${(err as Error).message}`);
    }
  }

  private async deleteCache(hash: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.del(this.cacheKey(hash));
    } catch (err) {
      this.logger.warn(`mcp_key_cache_del_failed error=${(err as Error).message}`);
    }
  }

  private cacheKey(hash: string): string {
    return `mcp:key:cache:${hash}`;
  }

  private initRedis(): void {
    try {
      const redisUrl = this.configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
      this.redis = new Redis(redisUrl, {
        lazyConnect: true,
        enableReadyCheck: false,
        maxRetriesPerRequest: 1,
      });

      this.redis.on('error', (err) => {
        this.logger.warn(`mcp_key_redis_error error=${(err as Error).message}`);
      });
    } catch (err) {
      this.logger.warn(`mcp_key_redis_init_failed error=${(err as Error).message}`);
      this.redis = null;
    }
  }
}
