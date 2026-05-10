import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { PairingService } from '../core/pairing.service';
import { PrismaService } from '../../prisma.service';

describe('PairingService', () => {
  let service: PairingService;
  let prisma: {
    dTabela: {
      create: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    dVincula: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let configService: { get: jest.Mock };

  const userId = BigInt(100);

  beforeEach(async () => {
    prisma = {
      dTabela: {
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      dVincula: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    configService = {
      get: jest.fn().mockImplementation((key: string, defaultVal?: unknown) => {
        if (key === 'PAIRING_TOKEN_TTL_MIN') return 15;
        return defaultVal;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PairingService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<PairingService>(PairingService);
  });

  describe('generate', () => {
    it('deve retornar code de 12 chars e expiresAt no futuro', async () => {
      prisma.dTabela.create.mockResolvedValue({ chave: BigInt(1) });

      const result = await service.generate(userId);

      expect(result.code).toHaveLength(12);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('deve gravar o HASH do código (não o plaintext) no DTabela e setar codigo=hash', async () => {
      prisma.dTabela.create.mockResolvedValue({ chave: BigInt(1) });

      const { code } = await service.generate(userId);

      expect(prisma.dTabela.create).toHaveBeenCalledTimes(1);
      const callArgs = prisma.dTabela.create.mock.calls[0][0];
      const dados = callArgs.data.dados as { codeHash: string; used: boolean };

      // O hash deve ter sido armazenado em dados.codeHash (64 chars SHA-256 hex)
      expect(dados.codeHash).toHaveLength(64);
      // O plaintext NÃO deve estar no dados armazenado
      expect(dados.codeHash).not.toBe(code);
      // O campo used deve ser false
      expect(dados.used).toBe(false);
      // O campo codigo deve ser o hash (para filtro direto no consume)
      expect(callArgs.data.codigo).toBe(dados.codeHash);
      expect(callArgs.data.codigo).toHaveLength(64);
    });

    it('deve usar dEntidadeId = userId no DTabela criado', async () => {
      prisma.dTabela.create.mockResolvedValue({ chave: BigInt(1) });

      await service.generate(userId);

      const callArgs = prisma.dTabela.create.mock.calls[0][0];
      expect(callArgs.data.dEntidadeId).toBe(userId);
    });

    it('deve usar TTL configurado via PAIRING_TOKEN_TTL_MIN', async () => {
      configService.get.mockImplementation((key: string, defaultVal?: unknown) => {
        if (key === 'PAIRING_TOKEN_TTL_MIN') return 30;
        return defaultVal;
      });
      prisma.dTabela.create.mockResolvedValue({ chave: BigInt(1) });

      const before = Date.now();
      const { expiresAt } = await service.generate(userId);
      const after = Date.now();

      const minMs = 30 * 60 * 1000;
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + minMs);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(after + minMs);
    });
  });

  describe('consume', () => {
    const channelMeta = { channelName: 'telegram', chatId: BigInt(999888777) };

    /** Cria uma entry de token válida para usar nos testes. */
    function makeValidToken(overrides: Partial<{ used: boolean; expiresAt: string; codeHash: string }> = {}) {
      const crypto = require('crypto') as typeof import('crypto');
      const plainCode = 'aabbccddeeff';
      const codeHash = crypto.createHash('sha256').update(plainCode).digest('hex');
      return {
        plainCode,
        token: {
          chave: BigInt(1),
          dEntidadeId: userId,
          dados: {
            codeHash: overrides.codeHash ?? codeHash,
            expiresAt: overrides.expiresAt ?? new Date(Date.now() + 900_000).toISOString(),
            used: overrides.used ?? false,
          },
        },
      };
    }

    it('deve retornar userId e marcar token como used em $transaction', async () => {
      const { plainCode, token } = makeValidToken();

      let capturedFindManyWhere: Record<string, unknown> | undefined;

      // $transaction executa o callback com o tx mock
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<bigint>) => {
        const tx = {
          dTabela: {
            findMany: jest.fn().mockImplementation((args: { where?: Record<string, unknown> }) => {
              capturedFindManyWhere = args?.where;
              return Promise.resolve([token]);
            }),
            update: jest.fn().mockResolvedValue({}),
          },
          dVincula: {
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({ chave: BigInt(10) }),
            update: jest.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      });

      const result = await service.consume(plainCode, channelMeta);

      expect(result).toBe(userId);
      // Verificar que $transaction foi chamado
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Verificar que consume filtra por codigo (hash) no WHERE — não scan completo
      const crypto = require('crypto') as typeof import('crypto');
      const expectedHash = crypto.createHash('sha256').update(plainCode).digest('hex');
      expect(capturedFindManyWhere?.codigo).toBe(expectedHash);
    });

    it('deve executar UPDATE do token E CREATE do vínculo dentro da mesma $transaction', async () => {
      const { plainCode, token } = makeValidToken();

      let txUpdateCalled = false;
      let txCreateCalled = false;

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<bigint>) => {
        const tx = {
          dTabela: {
            findMany: jest.fn().mockResolvedValue([token]),
            update: jest.fn().mockImplementation(() => {
              txUpdateCalled = true;
              return Promise.resolve({});
            }),
          },
          dVincula: {
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockImplementation(() => {
              txCreateCalled = true;
              return Promise.resolve({ chave: BigInt(10) });
            }),
            update: jest.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      });

      await service.consume(plainCode, channelMeta);

      expect(txUpdateCalled).toBe(true);
      expect(txCreateCalled).toBe(true);
    });

    it('deve lançar UnauthorizedException com código expirado', async () => {
      const { plainCode, token } = makeValidToken({
        expiresAt: new Date(Date.now() - 1000).toISOString(), // expirado
      });

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<bigint>) => {
        const tx = {
          dTabela: {
            findMany: jest.fn().mockResolvedValue([token]),
            update: jest.fn(),
          },
          dVincula: {
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
          },
        };
        return fn(tx);
      });

      await expect(service.consume(plainCode, channelMeta)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('deve lançar UnauthorizedException com código já usado', async () => {
      const { plainCode, token } = makeValidToken({ used: true });

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<bigint>) => {
        const tx = {
          dTabela: {
            findMany: jest.fn().mockResolvedValue([token]),
            update: jest.fn(),
          },
          dVincula: {
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
          },
        };
        return fn(tx);
      });

      await expect(service.consume(plainCode, channelMeta)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('deve lançar UnauthorizedException com código incorreto (hash não bate)', async () => {
      const { token } = makeValidToken();
      // hash do token válido gerado pelo makeValidToken
      const validHash = (token.dados as { codeHash: string }).codeHash;

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<bigint>) => {
        const tx = {
          dTabela: {
            // Simula o banco: só retorna o token se o WHERE.codigo bate com o hash correto
            findMany: jest.fn().mockImplementation((args: { where?: { codigo?: string } }) => {
              const queriedHash = args?.where?.codigo;
              return Promise.resolve(queriedHash === validHash ? [token] : []);
            }),
            update: jest.fn(),
          },
          dVincula: {
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
          },
        };
        return fn(tx);
      });

      // 'wrongcodewrong' produz um hash diferente — banco retorna [] — UnauthorizedException
      await expect(service.consume('wrongcodewrong', channelMeta)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('deve lançar UnauthorizedException se $transaction lançar erro interno', async () => {
      prisma.$transaction.mockRejectedValue(new Error('DB connection refused'));

      await expect(service.consume('aabbccddeeff', channelMeta)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
