import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AiKeysService } from './ai-keys.service';
import { PrismaService } from '../prisma.service';
import { AiKeyResolverService } from './ai-key-resolver.service';
import { encrypt } from './crypto/ai-key-crypto';

describe('AiKeysService', () => {
  let service: AiKeysService;
  let prisma: {
    dTabela: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let resolver: { invalidateScope: jest.Mock };

  const ORG = BigInt(152);
  const ADMIN = BigInt(900);

  // Chave-mestra (hex 64 chars) p/ a criptografia at-rest (R-2 / ADR-V2-064).
  const MASTER_KEY_ENV = 'AI_KEYS_ENCRYPTION_KEY';
  const ORIGINAL_MASTER = process.env[MASTER_KEY_ENV];

  beforeAll(() => {
    process.env[MASTER_KEY_ENV] = 'b'.repeat(64);
  });

  afterAll(() => {
    if (ORIGINAL_MASTER === undefined) delete process.env[MASTER_KEY_ENV];
    else process.env[MASTER_KEY_ENV] = ORIGINAL_MASTER;
  });

  beforeEach(async () => {
    prisma = {
      dTabela: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ chave: BigInt(1) }),
        update: jest.fn().mockResolvedValue({ chave: BigInt(1) }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    resolver = { invalidateScope: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AiKeysService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiKeyResolverService, useValue: resolver },
      ],
    }).compile();
    service = module.get(AiKeysService);
  });

  describe('upsertKey', () => {
    it('CRIA quando nao ha registro e mapeia claude→idClasse -482', async () => {
      prisma.dTabela.findFirst.mockResolvedValue(null);

      const res = await service.upsertKey(ORG, 'claude', 'sk-ant-abcdef1234', ADMIN);

      expect(prisma.dTabela.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ idClasse: BigInt(-482), dEntidadeId: ORG }),
        }),
      );
      // invalida o cache do resolver no escopo (provider, 'org', orgId).
      expect(resolver.invalidateScope).toHaveBeenCalledWith('claude', 'org', ORG);
      // resposta mascarada — NUNCA plaintext.
      expect(res.provider).toBe('claude');
      expect(res.configured).toBe(true);
      expect((res as unknown as Record<string, unknown>).plaintext).toBeUndefined();
      expect(JSON.stringify(res)).not.toContain('sk-ant-abcdef1234');

      // O `dados.plaintext` PERSISTIDO esta cifrado (nunca o segredo cru).
      const createArg = prisma.dTabela.create.mock.calls[0][0] as {
        data: { dados: { plaintext: string; prefix: string } };
      };
      expect(createArg.data.dados.plaintext.startsWith('enc:v1:')).toBe(true);
      expect(createArg.data.dados.plaintext).not.toContain('sk-ant-abcdef1234');
      // prefix/hash derivam do CRU → mascara/duplicata continuam corretas.
      expect(createArg.data.dados.prefix).toBe('sk-ant-a');
      // A mascara da resposta usa o sufixo do plaintext CRU (…1234).
      expect(res.masked).toContain('1234');
    });

    it('ROTACIONA (update) quando ja existe registro, preservando createdAt', async () => {
      prisma.dTabela.findFirst.mockResolvedValue({
        chave: BigInt(5),
        dados: { createdAt: '2020-01-01T00:00:00.000Z' },
      });

      await service.upsertKey(ORG, 'openai', 'sk-openai-key-xyz', ADMIN);

      expect(prisma.dTabela.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { chave: BigInt(5) } }),
      );
      expect(prisma.dTabela.create).not.toHaveBeenCalled();
      expect(resolver.invalidateScope).toHaveBeenCalledWith('openai', 'org', ORG);

      // Rotacao tambem grava CIFRADO (nunca o segredo cru).
      const updateArg = prisma.dTabela.update.mock.calls[0][0] as {
        data: { dados: { plaintext: string } };
      };
      expect(updateArg.data.dados.plaintext.startsWith('enc:v1:')).toBe(true);
      expect(updateArg.data.dados.plaintext).not.toContain('sk-openai-key-xyz');
    });

    it('mapeia gemini→-481 e openai→-483', async () => {
      prisma.dTabela.findFirst.mockResolvedValue(null);

      await service.upsertKey(ORG, 'gemini', 'AIzaSyExample123', ADMIN);
      expect(prisma.dTabela.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ idClasse: BigInt(-481) }) }),
      );

      await service.upsertKey(ORG, 'openai', 'sk-openai-aaaa', ADMIN);
      expect(prisma.dTabela.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ idClasse: BigInt(-483) }) }),
      );
    });
  });

  describe('listKeys', () => {
    it('retorna chaves MASCARADAS, nunca plaintext', async () => {
      prisma.dTabela.findMany.mockResolvedValue([
        {
          idClasse: BigInt(-482),
          chave: BigInt(10),
          dados: {
            plaintext: 'sk-ant-supersecret9999',
            prefix: 'sk-ant-',
            createdAt: '2026-06-04T00:00:00.000Z',
            lastRotatedAt: '2026-06-04T00:00:00.000Z',
          },
        },
      ]);

      const list = await service.listKeys(ORG);

      expect(list).toHaveLength(1);
      expect(list[0].provider).toBe('claude');
      expect(list[0].masked).toContain('…');
      // O segredo NUNCA aparece.
      expect(JSON.stringify(list)).not.toContain('supersecret9999');
      expect((list[0] as unknown as Record<string, unknown>).plaintext).toBeUndefined();
    });

    it('mascara CORRETAMENTE chave CIFRADA (via tryDecrypt), sem vazar o segredo', async () => {
      const secret = 'sk-ant-cifrada-final7777';
      prisma.dTabela.findMany.mockResolvedValue([
        {
          idClasse: BigInt(-482),
          chave: BigInt(11),
          dados: {
            plaintext: encrypt(secret), // armazenado CIFRADO (enc:v1:...)
            prefix: 'sk-ant-c',
            createdAt: '2026-06-04T00:00:00.000Z',
          },
        },
      ]);

      const list = await service.listKeys(ORG);

      expect(list).toHaveLength(1);
      // Mascara usa o sufixo do plaintext decifrado (…7777).
      expect(list[0].masked).toContain('7777');
      // O segredo (cru OU cifrado) NUNCA aparece na resposta.
      expect(JSON.stringify(list)).not.toContain('cifrada-final7777');
      expect(JSON.stringify(list)).not.toContain('enc:v1:');
    });

    it('deduplica por provider (1 registro por provider)', async () => {
      prisma.dTabela.findMany.mockResolvedValue([
        { idClasse: BigInt(-482), chave: BigInt(20), dados: { plaintext: 'sk-ant-new', prefix: 'sk-ant-' } },
        { idClasse: BigInt(-482), chave: BigInt(10), dados: { plaintext: 'sk-ant-old', prefix: 'sk-ant-' } },
      ]);

      const list = await service.listKeys(ORG);
      expect(list).toHaveLength(1);
    });
  });

  describe('deleteKey', () => {
    it('soft-deleta e invalida cache quando existe', async () => {
      prisma.dTabela.findFirst.mockResolvedValue({ chave: BigInt(7) });

      await service.deleteKey(ORG, 'claude');

      expect(prisma.dTabela.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ idClasse: BigInt(-482), dEntidadeId: ORG, excluido: false }),
          data: { excluido: true },
        }),
      );
      expect(resolver.invalidateScope).toHaveBeenCalledWith('claude', 'org', ORG);
    });

    it('lanca NotFound quando nao existe (idempotencia 404)', async () => {
      prisma.dTabela.findFirst.mockResolvedValue(null);

      await expect(service.deleteKey(ORG, 'openai')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.dTabela.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('getConfiguredMap', () => {
    it('reporta configured por provider sem dado sensivel', async () => {
      prisma.dTabela.findMany.mockResolvedValue([{ idClasse: BigInt(-481) }]);

      const map = await service.getConfiguredMap(ORG);

      expect(map).toEqual({ gemini: true, claude: false, openai: false });
    });
  });
});
