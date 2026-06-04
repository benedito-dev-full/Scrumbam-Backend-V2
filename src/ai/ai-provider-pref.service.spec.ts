import { Test, TestingModule } from '@nestjs/testing';
import { AiProviderPrefService } from './ai-provider-pref.service';
import { PrismaService } from '../prisma.service';

const makePrismaMock = () => {
  const mock: {
    dTabela: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  } = {
    dTabela: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    // setDefaultForOrg agora roda dentro de $transaction (atomicidade M1).
    // O mock executa o callback com o proprio mock como `tx`, preservando
    // as assertions sobre dTabela.create/update.
    $transaction: jest.fn((cb: (tx: typeof mock) => unknown) => cb(mock)),
  };
  return mock;
};

describe('AiProviderPrefService', () => {
  let service: AiProviderPrefService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiProviderPrefService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<AiProviderPrefService>(AiProviderPrefService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getDefaultForOrg', () => {
    it('retorna { provider, model } quando a org tem preferencia', async () => {
      prisma.dTabela.findFirst.mockResolvedValueOnce({
        dados: { provider: 'claude', model: 'claude-3-5-sonnet' },
      });

      const pref = await service.getDefaultForOrg(BigInt(152));

      expect(pref).toEqual({ provider: 'claude', model: 'claude-3-5-sonnet' });
      expect(prisma.dTabela.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            idClasse: BigInt(-484),
            dEntidadeId: BigInt(152),
            excluido: false,
            inativo: false,
          }),
        }),
      );
    });

    it('retorna { provider } sem model quando model ausente', async () => {
      prisma.dTabela.findFirst.mockResolvedValueOnce({ dados: { provider: 'gemini' } });

      const pref = await service.getDefaultForOrg(BigInt(152));

      expect(pref).toEqual({ provider: 'gemini' });
    });

    it('retorna null quando a org nao tem preferencia', async () => {
      prisma.dTabela.findFirst.mockResolvedValueOnce(null);

      const pref = await service.getDefaultForOrg(BigInt(152));

      expect(pref).toBeNull();
    });

    it('retorna null quando dados nao tem provider valido', async () => {
      prisma.dTabela.findFirst.mockResolvedValueOnce({ dados: { model: 'x' } });

      const pref = await service.getDefaultForOrg(BigInt(152));

      expect(pref).toBeNull();
    });

    it('cacheia o resultado (2a chamada nao re-consulta)', async () => {
      prisma.dTabela.findFirst.mockResolvedValueOnce({ dados: { provider: 'openai' } });

      await service.getDefaultForOrg(BigInt(7));
      await service.getDefaultForOrg(BigInt(7));

      expect(prisma.dTabela.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('setDefaultForOrg', () => {
    it('cria nova linha quando a org ainda nao tem preferencia', async () => {
      prisma.dTabela.findFirst.mockResolvedValueOnce(null);
      prisma.dTabela.create.mockResolvedValueOnce({ chave: BigInt(1) });

      const result = await service.setDefaultForOrg(BigInt(152), {
        provider: 'claude',
        model: 'claude-3-5-sonnet',
      });

      expect(result).toEqual({ provider: 'claude', model: 'claude-3-5-sonnet' });
      expect(prisma.dTabela.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idClasse: BigInt(-484),
            dEntidadeId: BigInt(152),
            dados: { provider: 'claude', model: 'claude-3-5-sonnet' },
          }),
        }),
      );
    });

    it('atualiza a linha existente quando a org ja tem preferencia', async () => {
      prisma.dTabela.findFirst.mockResolvedValueOnce({ chave: BigInt(99) });
      prisma.dTabela.update.mockResolvedValueOnce({ chave: BigInt(99) });

      await service.setDefaultForOrg(BigInt(152), { provider: 'gemini' });

      expect(prisma.dTabela.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chave: BigInt(99) },
          data: expect.objectContaining({ dados: { provider: 'gemini' } }),
        }),
      );
      expect(prisma.dTabela.create).not.toHaveBeenCalled();
    });
  });
});
