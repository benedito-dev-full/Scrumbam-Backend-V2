import { ConsoleLogger, Logger } from '@nestjs/common';

import { MCP_CALL_EVENT_CLASS_ID } from '../constants';
import { sanitizeMcpLogValue } from '../logging/mcp-log-sanitizer';
import { SanitizingLogger } from '../logging/sanitizing-logger.service';
import { McpController } from '../mcp.controller';
import { McpAuditService } from '../services/mcp-audit.service';
import { McpJsonRpcService } from '../services/mcp-json-rpc.service';
import { McpRateLimitService } from '../services/mcp-rate-limit.service';

interface FakeRedisEntry {
  count: number;
  expiresAt: number | null;
}

class FakeRateLimitRedis {
  readonly entries = new Map<string, FakeRedisEntry>();
  readonly executedCommandSets: string[][] = [];

  multi(): {
    incr: (key: string) => ReturnType<FakeRateLimitRedis['multi']>;
    expire: (key: string, seconds: number) => ReturnType<FakeRateLimitRedis['multi']>;
    exec: () => Promise<Array<[Error | null, unknown]>>;
  } {
    const commands: Array<{ name: string; key: string; seconds?: number }> = [];
    const multi = {
      incr: (key: string) => {
        commands.push({ name: 'incr', key });
        return multi;
      },
      expire: (key: string, seconds: number) => {
        commands.push({ name: 'expire', key, seconds });
        return multi;
      },
      exec: async () => {
        this.executedCommandSets.push(commands.map((command) => command.name));
        const results: Array<[Error | null, unknown]> = [];
        for (const command of commands) {
          const entry = this.getEntry(command.key);
          if (command.name === 'incr') {
            entry.count += 1;
            results.push([null, entry.count]);
          }
          if (command.name === 'expire') {
            entry.expiresAt = Date.now() + (command.seconds ?? 0) * 1000;
            results.push([null, 1]);
          }
        }
        return results;
      },
    };

    return multi;
  }

  private getEntry(key: string): FakeRedisEntry {
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt !== null && existing.expiresAt <= Date.now()) {
      this.entries.delete(key);
    }

    const current = this.entries.get(key);
    if (current) {
      return current;
    }

    const created = { count: 0, expiresAt: null };
    this.entries.set(key, created);
    return created;
  }
}

describe('MCP Bloco C - rate limit, auditoria e sanitizacao', () => {
  const userCtx = {
    dEntidadeId: BigInt(123),
    scopes: ['tools:read'],
    keyChave: BigInt(456),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hashabc',
  };

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('rate limit permite 60 chamadas, bloqueia a 61a e reseta apos 60s', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));

    const redis = new FakeRateLimitRedis();
    const service = new McpRateLimitService({ get: jest.fn() } as never);
    service.setRedisClientForTesting(redis as never);

    for (let index = 0; index < 60; index += 1) {
      await expect(service.check('key-hash')).resolves.toMatchObject({
        allowed: true,
        count: index + 1,
      });
    }

    await expect(service.check('key-hash')).resolves.toEqual({
      allowed: false,
      count: 61,
      retryAfterSeconds: 60,
    });

    jest.setSystemTime(new Date('2026-05-10T12:01:00.000Z'));
    await expect(service.check('key-hash')).resolves.toMatchObject({
      allowed: true,
      count: 1,
    });
  });

  it('controller retorna -32000 com HTTP logico 200 e nao executa dispatch quando rate limit bloqueia', async () => {
    const rateLimit = { check: jest.fn().mockResolvedValue({ allowed: false, count: 61, retryAfterSeconds: 60 }) };
    const router = { dispatch: jest.fn() };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const controller = new McpController(
      new McpJsonRpcService(),
      router as never,
      rateLimit as never,
      audit as never,
    );

    const result = await controller.handle(
      { jsonrpc: '2.0', method: 'tools/list', id: 'rl' },
      { userCtx } as never,
    );

    expect(result).toEqual({
      jsonrpc: '2.0',
      id: 'rl',
      error: {
        code: -32000,
        message: 'Rate limit exceeded',
        data: { retryAfterSeconds: 60 },
      },
    });
    expect(router.dispatch).not.toHaveBeenCalled();
  });

  it('rate limiter usa INCR + EXPIRE no mesmo multi para evitar TTL orfa', async () => {
    const redis = new FakeRateLimitRedis();
    const service = new McpRateLimitService({ get: jest.fn() } as never);
    service.setRedisClientForTesting(redis as never);

    await service.check('atomic-hash');

    expect(redis.executedCommandSets).toEqual([['incr', 'expire']]);
    expect(redis.entries.get('mcp:rl:atomic-hash')?.expiresAt).toEqual(expect.any(Number));
  });

  it('fallback Redis indisponivel permite chamada e loga warning', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const service = new McpRateLimitService({ get: jest.fn() } as never);
    service.setRedisClientForTesting(null);

    await expect(service.check('hash')).resolves.toEqual({ allowed: true, count: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mcp_ratelimit_redis_unavailable'));
  });

  it('auditoria cria DEvento -495 com paramsHash sem plaintext e durationMs positivo', async () => {
    const prisma = {
      dEvento: {
        create: jest.fn().mockResolvedValue({ chave: BigInt(1) }),
      },
    };
    const service = new McpAuditService(prisma as never);

    await service.record({
      method: 'tools/call',
      params: { token: 'plaintext-secret', nested: { email: 'user@example.com' } },
      userCtx,
      httpCode: 200,
      durationMs: 12,
      correlationId: 'corr-1',
    });

    expect(prisma.dEvento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idClasse: MCP_CALL_EVENT_CLASS_ID,
        idEntidade: BigInt(123),
        identificadorExterno: 'corr-1',
        metaDados: expect.objectContaining({
          method: 'tools/call',
          paramsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          httpCode: 200,
          durationMs: 12,
          keyPrefix: 'scrumban_mcp',
          correlationId: 'corr-1',
        }),
      }),
    });

    const persisted = JSON.stringify(prisma.dEvento.create.mock.calls[0][0].data.metaDados);
    expect(persisted).not.toContain('plaintext-secret');
    expect(persisted).not.toContain('user@example.com');
  });

  it('sanitizer remove valor de x-mcp-key do output logado', () => {
    const secret = 'scrumban_mcp_secret_value';
    const sanitized = sanitizeMcpLogValue({
      headers: {
        'x-mcp-key': secret,
        nested: { 'X-MCP-Key': secret },
      },
      message: `header x-mcp-key=${secret}`,
    });

    expect(JSON.stringify(sanitized)).not.toContain(secret);
    expect(JSON.stringify(sanitized)).toContain('[REDACTED]');

    const logSpy = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation();
    const logger = new SanitizingLogger('Test');
    logger.log({ 'x-mcp-key': secret });

    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(secret);
  });

  it('controller agenda auditoria em setImmediate e nao de forma sincrona', async () => {
    let scheduled: (() => void) | undefined;
    jest.spyOn(global, 'setImmediate').mockImplementation(((callback: () => void) => {
      scheduled = callback;
      return {} as NodeJS.Immediate;
    }) as typeof setImmediate);

    const router = { dispatch: jest.fn().mockResolvedValue({ result: { ok: true } }) };
    const rateLimit = { check: jest.fn().mockResolvedValue({ allowed: true, count: 1 }) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const controller = new McpController(
      new McpJsonRpcService(),
      router as never,
      rateLimit as never,
      audit as never,
    );

    const result = await controller.handle(
      { jsonrpc: '2.0', method: 'initialize', params: { secret: 'plaintext' }, id: 'corr-2' },
      { userCtx } as never,
    );

    expect(result).toEqual(expect.objectContaining({ id: 'corr-2' }));
    expect(audit.record).not.toHaveBeenCalled();
    expect(scheduled).toBeDefined();

    scheduled?.();

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'initialize',
        params: { secret: 'plaintext' },
        userCtx,
        httpCode: 200,
        durationMs: expect.any(Number),
        correlationId: 'corr-2',
      }),
    );
    expect(audit.record.mock.calls[0][0].durationMs).toBeGreaterThan(0);
  });
});
