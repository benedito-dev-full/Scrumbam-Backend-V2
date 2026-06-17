import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ALL_MCP_SCOPES, MCP_KEY_CACHE_TTL_SECONDS, MCP_KEY_CLASS_ID, MCP_SCOPES, McpScope } from '../constants';
import { McpKeyService } from '../services/mcp-key.service';
import { RoleResolverService } from '../../auth/services/role-resolver.service';

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
  let roleResolver: { getAllowedMcpScopes: jest.Mock };

  /** Helper: configura o RoleResolver mock para liberar o conjunto informado. */
  const allowScopes = (...scopes: McpScope[]) =>
    roleResolver.getAllowedMcpScopes.mockResolvedValue(new Set<McpScope>(scopes));

  beforeEach(() => {
    prisma = {
      dTabela: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    roleResolver = {
      getAllowedMcpScopes: jest.fn().mockResolvedValue(new Set<McpScope>(ALL_MCP_SCOPES)),
    };

    service = new McpKeyService(
      prisma as never,
      { get: jest.fn().mockReturnValue('false') } as unknown as ConfigService,
      roleResolver as unknown as RoleResolverService,
    );
  });

  it('gera key scrumban_mcp e persiste apenas hash em DTabela -472', async () => {
    prisma.dTabela.create.mockResolvedValue({
      chave: BigInt(10),
      criadoEm: new Date('2026-05-10T12:00:00.000Z'),
    });

    const result = await service.generate(BigInt('9007199254740993'), ['tasks:read']);

    expect(result.plaintext).toMatch(/^scrumban_mcp_/);
    expect(result.id).toBe('10');
    expect(prisma.dTabela.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idClasse: MCP_KEY_CLASS_ID,
          dEntidadeId: BigInt('9007199254740993'),
          dados: expect.objectContaining({
            hash: McpKeyService.sha256Hex(result.plaintext),
            scopes: ['tasks:read'],
            disabled: false,
          }),
        }),
      }),
    );

    const persisted = prisma.dTabela.create.mock.calls[0][0].data.dados;
    expect(JSON.stringify(persisted)).not.toContain(result.plaintext);
  });

  describe('gate de catálogo + escalação de privilégio (ADR-V2-068 Fase 2)', () => {
    it('ORG_ADMIN cria key com FULL_ACCESS (todos os scopes liberados)', async () => {
      allowScopes(...ALL_MCP_SCOPES);
      prisma.dTabela.create.mockResolvedValue({ chave: BigInt(20), criadoEm: new Date() });

      const result = await service.generate(BigInt(1), [...ALL_MCP_SCOPES]);

      expect(result.scopes).toEqual(expect.arrayContaining([...ALL_MCP_SCOPES]));
      expect(prisma.dTabela.create).toHaveBeenCalled();
    });

    it('MEMBER pedindo executions:create → ForbiddenException com deniedScopes', async () => {
      allowScopes(
        MCP_SCOPES.TASKS_READ,
        MCP_SCOPES.TASKS_WRITE,
        MCP_SCOPES.NOTIFICATIONS_READ,
        MCP_SCOPES.NOTIFICATIONS_WRITE,
      );

      await expect(
        service.generate(BigInt(2), [MCP_SCOPES.TASKS_WRITE, MCP_SCOPES.EXECUTIONS_CREATE]),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          deniedScopes: [MCP_SCOPES.EXECUTIONS_CREATE],
          allowedScopes: expect.arrayContaining([MCP_SCOPES.TASKS_WRITE]),
        }),
      });
      await expect(
        service.generate(BigInt(2), [MCP_SCOPES.EXECUTIONS_CREATE]),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.dTabela.create).not.toHaveBeenCalled();
    });

    it('scope fora do catálogo → BadRequestException listando inválidos', async () => {
      await expect(
        service.generate(BigInt(3), ['tasks:read', 'foo:bar']),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.generate(BigInt(3), ['tasks:read', 'foo:bar']),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ invalidScopes: ['foo:bar'] }),
      });
      expect(prisma.dTabela.create).not.toHaveBeenCalled();
    });

    it('lista vazia → BadRequestException (pelo menos 1 scope)', async () => {
      await expect(service.generate(BigInt(4), [])).rejects.toBeInstanceOf(BadRequestException);
      expect(roleResolver.getAllowedMcpScopes).not.toHaveBeenCalled();
      expect(prisma.dTabela.create).not.toHaveBeenCalled();
    });
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
          scopes: ['tasks:read'],
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
        scopes: ['tasks:read'],
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
        scopes: ['tasks:read'],
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
          scopes: ['tasks:read'],
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
