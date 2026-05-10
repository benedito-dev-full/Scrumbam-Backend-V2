import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { AccountLinkService } from '../core/account-link.service';

describe('AccountLinkService', () => {
  let service: AccountLinkService;
  let prisma: {
    dVincula: {
      findFirst: jest.Mock;
    };
  };

  const channelName = 'telegram';
  const chatId = BigInt(123456789);
  const userId = BigInt(42);

  beforeEach(async () => {
    prisma = {
      dVincula: {
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountLinkService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AccountLinkService>(AccountLinkService);
  });

  describe('findByChat', () => {
    it('deve retornar userId quando DVincula existe com channelName e chatId corretos', async () => {
      prisma.dVincula.findFirst.mockResolvedValue({
        chave: BigInt(1),
        idLocEscritu: userId,
      });

      const result = await service.findByChat(channelName, chatId);

      expect(result).toBe(userId);
    });

    it('deve retornar null quando DVincula nao existe', async () => {
      prisma.dVincula.findFirst.mockResolvedValue(null);

      const result = await service.findByChat(channelName, chatId);

      expect(result).toBeNull();
    });

    it('deve retornar null quando chatId nao corresponde', async () => {
      prisma.dVincula.findFirst.mockResolvedValue(null);

      const result = await service.findByChat(channelName, chatId);

      expect(result).toBeNull();
    });

    it('deve retornar null quando idLocEscritu e null', async () => {
      prisma.dVincula.findFirst.mockResolvedValue({
        chave: BigInt(1),
        idLocEscritu: null,
      });

      const result = await service.findByChat(channelName, chatId);

      expect(result).toBeNull();
    });

    it('deve fazer uma unica query', async () => {
      prisma.dVincula.findFirst.mockResolvedValue(null);

      await service.findByChat(channelName, chatId);

      expect(prisma.dVincula.findFirst).toHaveBeenCalledTimes(1);
    });

    it('deve chamar findFirst com idClasse=-483 e excluido=false', async () => {
      prisma.dVincula.findFirst.mockResolvedValue(null);

      await service.findByChat(channelName, chatId);

      expect(prisma.dVincula.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            idClasse: BigInt(-483),
            excluido: false,
          }),
        }),
      );
    });

    it('deve filtrar channelName e chatId via path JSON', async () => {
      prisma.dVincula.findFirst.mockResolvedValue(null);

      await service.findByChat('telegram', chatId);

      const callArgs = prisma.dVincula.findFirst.mock.calls[0][0];
      expect(callArgs.where.AND).toEqual([
        { metaDados: { path: ['channelName'], equals: 'telegram' } },
        { metaDados: { path: ['chatId'], equals: chatId.toString() } },
      ]);
    });
  });
});
