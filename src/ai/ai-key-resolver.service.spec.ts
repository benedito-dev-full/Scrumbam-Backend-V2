import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { AiKeyResolverService } from './ai-key-resolver.service';
import { PrismaService } from '../prisma.service';

const makePrismaMock = () => ({
  dTabela: {
    findFirst: jest.fn(),
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
});
