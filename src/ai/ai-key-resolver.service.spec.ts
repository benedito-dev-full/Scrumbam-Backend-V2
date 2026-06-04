import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { AiKeyResolverService } from './ai-key-resolver.service';
import { PrismaService } from '../prisma.service';
import { encrypt } from './crypto/ai-key-crypto';

const makePrismaMock = () => ({
  dTabela: {
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({ chave: BigInt(1) }),
  },
});

/** Helper: linha de DTabela com chave plaintext. */
const keyRow = (plaintext: string) => ({ dados: { plaintext } });

describe('AiKeyResolverService', () => {
  let service: AiKeyResolverService;
  let prisma: ReturnType<typeof makePrismaMock>;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    prisma = makePrismaMock();
    // Limpa env vars de chave para isolar a cascata.
    delete process.env.GOOGLE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    // Chave-mestra (hex 64) p/ decifrar/auto-migrar (R-2 / ADR-V2-064).
    process.env.AI_KEYS_ENCRYPTION_KEY = 'c'.repeat(64);

    const module: TestingModule = await Test.createTestingModule({
      providers: [AiKeyResolverService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<AiKeyResolverService>(AiKeyResolverService);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.clearAllMocks();
  });

  describe('cascata de resolucao', () => {
    it('resolve no nivel ORG (primeiro hit) sem consultar global/env', async () => {
      // org tem chave → para no primeiro hit.
      prisma.dTabela.findFirst.mockResolvedValueOnce(keyRow('claude-org-key'));

      const key = await service.resolveKey({ provider: 'claude', orgId: BigInt(152) });

      expect(key).toBe('claude-org-key');
      // Apenas 1 query (nivel org); global nao foi consultado.
      expect(prisma.dTabela.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.dTabela.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            idClasse: BigInt(-482),
            dEntidadeId: BigInt(152),
            excluido: false,
            inativo: false,
          }),
        }),
      );
    });

    it('cai no GLOBAL quando org nao tem chave', async () => {
      // org miss → global hit.
      prisma.dTabela.findFirst
        .mockResolvedValueOnce(null) // org
        .mockResolvedValueOnce(keyRow('gemini-global-key')); // global

      const key = await service.resolveKey({ provider: 'gemini', orgId: BigInt(152) });

      expect(key).toBe('gemini-global-key');
      expect(prisma.dTabela.findFirst).toHaveBeenCalledTimes(2);
      // 2a chamada e o nivel global (dEntidadeId=null).
      expect(prisma.dTabela.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ idClasse: BigInt(-481), dEntidadeId: null }),
        }),
      );
    });

    it('cai no ENV quando nem org nem global tem chave', async () => {
      prisma.dTabela.findFirst.mockResolvedValue(null); // org + global miss
      process.env.OPENAI_API_KEY = 'openai-env-key';

      const key = await service.resolveKey({ provider: 'openai', orgId: BigInt(152) });

      expect(key).toBe('openai-env-key');
    });

    it('sem orgId vai direto a GLOBAL (compat retroativa v1 Gemini)', async () => {
      prisma.dTabela.findFirst.mockResolvedValueOnce(keyRow('gemini-global-key'));

      const key = await service.resolveKey({ provider: 'gemini' });

      expect(key).toBe('gemini-global-key');
      // Sem org → 1 unica query, no nivel global.
      expect(prisma.dTabela.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.dTabela.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ idClasse: BigInt(-481), dEntidadeId: null }),
        }),
      );
    });

    it('MISS total (nem DTabela nem env) lanca InternalServerErrorException', async () => {
      prisma.dTabela.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveKey({ provider: 'claude', orgId: BigInt(152) }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('flag ENABLE_USER_LEVEL_KEYS (desligada nesta fase)', () => {
    it('NAO consulta o nivel user mesmo com userEntidadeId presente', async () => {
      // Flag default false → user pulado. org hit confirma que a 1a query e org.
      prisma.dTabela.findFirst.mockResolvedValueOnce(keyRow('claude-org-key'));

      const key = await service.resolveKey({
        provider: 'claude',
        orgId: BigInt(152),
        userEntidadeId: BigInt(900),
      });

      expect(key).toBe('claude-org-key');
      expect(prisma.dTabela.findFirst).toHaveBeenCalledTimes(1);
      // A unica query e a de ORG (dEntidadeId=orgId), nao a de user.
      expect(prisma.dTabela.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ dEntidadeId: BigInt(152) }),
        }),
      );
    });
  });

  describe('cache por escopo', () => {
    it('segunda chamada do mesmo escopo nao re-consulta o banco', async () => {
      prisma.dTabela.findFirst.mockResolvedValueOnce(keyRow('gemini-global-key'));

      const first = await service.resolveKey({ provider: 'gemini' });
      const second = await service.resolveKey({ provider: 'gemini' });

      expect(first).toBe('gemini-global-key');
      expect(second).toBe('gemini-global-key');
      // Cache hit na 2a → apenas 1 query total.
      expect(prisma.dTabela.findFirst).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache forca nova consulta', async () => {
      prisma.dTabela.findFirst
        .mockResolvedValueOnce(keyRow('gemini-global-key'))
        .mockResolvedValueOnce(keyRow('gemini-global-key-2'));

      await service.resolveKey({ provider: 'gemini' });
      service.invalidateCache();
      const after = await service.resolveKey({ provider: 'gemini' });

      expect(after).toBe('gemini-global-key-2');
      expect(prisma.dTabela.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('seguranca', () => {
    it('ignora dados.plaintext vazio/ausente e segue a cascata', async () => {
      // org tem linha mas plaintext vazio → tratado como miss → cai no env.
      prisma.dTabela.findFirst
        .mockResolvedValueOnce({ dados: { plaintext: '' } }) // org invalido
        .mockResolvedValueOnce({ dados: {} }); // global sem plaintext
      process.env.GOOGLE_API_KEY = 'env-fallback';

      const key = await service.resolveKey({ provider: 'gemini', orgId: BigInt(1) });

      expect(key).toBe('env-fallback');
    });
  });

  describe('criptografia at-rest (R-2 / ADR-V2-064)', () => {
    it('DECIFRA a chave cifrada lida da DTabela', async () => {
      const secret = 'claude-org-cifrada';
      prisma.dTabela.findFirst.mockResolvedValueOnce({
        chave: BigInt(5),
        dados: { plaintext: encrypt(secret) },
      });

      const key = await service.resolveKey({ provider: 'claude', orgId: BigInt(152) });

      expect(key).toBe(secret);
      // Ja cifrado → NAO auto-migra.
      expect(prisma.dTabela.update).not.toHaveBeenCalled();
    });

    it('AUTO-MIGRA registro legado (plaintext) regravando cifrado, sem quebrar a leitura', async () => {
      const legacy = 'gemini-legacy-plain';
      prisma.dTabela.findFirst.mockResolvedValueOnce({
        chave: BigInt(9),
        dados: { plaintext: legacy, prefix: 'AIzaSyL' },
      });

      const key = await service.resolveKey({ provider: 'gemini' });

      // Leitura devolve o plaintext (passa-through do legado).
      expect(key).toBe(legacy);
      // Auto-migracao fire-and-forget regrava o registro.
      // Aguarda o microtask do `.then/.catch` resolver.
      await Promise.resolve();
      expect(prisma.dTabela.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { chave: BigInt(9) } }),
      );
      const updateArg = prisma.dTabela.update.mock.calls[0][0] as {
        data: { dados: { plaintext: string; prefix: string } };
      };
      // Agora cifrado, demais campos preservados.
      expect(updateArg.data.dados.plaintext.startsWith('enc:v1:')).toBe(true);
      expect(updateArg.data.dados.plaintext).not.toContain(legacy);
      expect(updateArg.data.dados.prefix).toBe('AIzaSyL');
    });

    it('NAO auto-migra quando o registro nao tem chave (PK ausente)', async () => {
      prisma.dTabela.findFirst.mockResolvedValueOnce({
        dados: { plaintext: 'gemini-sem-chave' },
      });

      const key = await service.resolveKey({ provider: 'gemini' });

      expect(key).toBe('gemini-sem-chave');
      expect(prisma.dTabela.update).not.toHaveBeenCalled();
    });
  });
});
