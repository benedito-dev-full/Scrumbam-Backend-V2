import { ConfigService } from '@nestjs/config';

import { MCP_KEY_CACHE_TTL_SECONDS, MCP_KEY_CLASS_ID } from '../constants';
import { McpKeyService } from '../services/mcp-key.service';

describe('McpKeyService', () => {
  let service: McpKeyService;
  let prisma: {
    dTabela: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      dTabela: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    service = new McpKeyService(
      prisma as never,
      { get: jest.fn().mockReturnValue('false') } as unknown as ConfigService,
    );
  });

  it('gera key scrumban_mcp e persiste apenas hash em DTabela -472', async () => {
    prisma.dTabela.create.mockResolvedValue({
      chave: BigInt(10),
      criadoEm: new Date('2026-05-10T12:00:00.000Z'),
    });

    const result = await service.generate(BigInt('9007199254740993'), ['tools:read']);

    expect(result.plaintext).toMatch(/^scrumban_mcp_/);
    expect(result.id).toBe('10');
    expect(prisma.dTabela.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idClasse: MCP_KEY_CLASS_ID,
          dEntidadeId: BigInt('9007199254740993'),
          dados: expect.objectContaining({
            hash: McpKeyService.sha256Hex(result.plaintext),
            scopes: ['tools:read'],
            disabled: false,
          }),
        }),
      }),
    );

    const persisted = prisma.dTabela.create.mock.calls[0][0].data.dados;
    expect(JSON.stringify(persisted)).not.toContain(result.plaintext);
  });

  it('lista keys sem hash e sem plaintext', async () => {
    prisma.dTabela.findMany.mockResolvedValue([
      {
        chave: BigInt(11),
        codigo: 'scrumban_mcp',
        criadoEm: new Date('2026-05-10T12:00:00.000Z'),
        dados: {
          prefix: 'scrumban_mcp',
          hash: 'secret-hash',
          scopes: ['tools:read'],
          disabled: false,
          createdAt: '2026-05-10T12:00:00.000Z',
          lastUsedAt: null,
        },
      },
    ]);

    const result = await service.list(BigInt(1));

    expect(result).toEqual([
      {
        id: '11',
        prefix: 'scrumban_mcp',
        scopes: ['tools:read'],
        disabled: false,
        createdAt: '2026-05-10T12:00:00.000Z',
        lastUsedAt: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('secret-hash');
    expect(JSON.stringify(result)).not.toContain('plaintext');
  });

  it('valida cache miss com findFirst por filtro JSON de hash e popula cache TTL 30s', async () => {
    const plaintext = 'scrumban_mcp_valid';
    const hash = McpKeyService.sha256Hex(plaintext);
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
    (service as unknown as { redis: typeof redis }).redis = redis;

    prisma.dTabela.findFirst.mockResolvedValue({
      chave: BigInt(12),
      dEntidadeId: BigInt(99),
      criadoEm: new Date(),
      dados: {
        prefix: 'scrumban_mcp',
        hash,
        scopes: ['tools:read'],
        disabled: false,
      },
    });
    prisma.dTabela.update.mockResolvedValue({});

    const result = await service.validatePlaintext(plaintext);

    expect(prisma.dTabela.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          idClasse: MCP_KEY_CLASS_ID,
          dados: { path: ['hash'], equals: hash },
        }),
      }),
    );
    expect(result?.dEntidadeId).toBe('99');
    expect(redis.set).toHaveBeenCalledWith(
      `mcp:key:cache:${hash}`,
      expect.any(String),
      'EX',
      MCP_KEY_CACHE_TTL_SECONDS,
    );
  });

  it('valida cache hit sem consultar banco', async () => {
    const hash = McpKeyService.sha256Hex('scrumban_mcp_cached');
    const redis = {
      get: jest.fn().mockResolvedValue(
        JSON.stringify({
          chave: '15',
          dEntidadeId: '44',
          scopes: ['tools:read'],
          prefix: 'scrumban_mcp',
          hash,
        }),
      ),
    };
    (service as unknown as { redis: typeof redis }).redis = redis;

    const result = await service.validatePlaintext('scrumban_mcp_cached');

    expect(result?.hash).toBe(hash);
    expect(result?.chave).toBe('15');
    expect(prisma.dTabela.findFirst).not.toHaveBeenCalled();
  });

  it('rejeita key disabled e revoga com soft-delete invalidando cache', async () => {
    const plaintext = 'scrumban_mcp_disabled';
    const hash = McpKeyService.sha256Hex(plaintext);
    prisma.dTabela.findFirst.mockResolvedValueOnce({
      chave: BigInt(16),
      dEntidadeId: BigInt(100),
      criadoEm: new Date(),
      dados: { hash, prefix: 'scrumban_mcp', disabled: true, scopes: [] },
    });

    await expect(service.validatePlaintext(plaintext)).resolves.toBeNull();

    const redis = { del: jest.fn().mockResolvedValue(1) };
    (service as unknown as { redis: typeof redis }).redis = redis;
    prisma.dTabela.findFirst.mockResolvedValueOnce({
      chave: BigInt(16),
      dados: { hash, prefix: 'scrumban_mcp', disabled: false },
    });
    prisma.dTabela.update.mockResolvedValue({});

    await service.revoke(BigInt(100), BigInt(16));

    expect(prisma.dTabela.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chave: BigInt(16) },
        data: expect.objectContaining({
          excluido: true,
          inativo: true,
          dados: expect.objectContaining({ disabled: true }),
        }),
      }),
    );
    expect(redis.del).toHaveBeenCalledWith(`mcp:key:cache:${hash}`);
  });
});
