import { Test, TestingModule } from '@nestjs/testing';
import { AccountLinkService } from '../core/account-link.service';
import { PrismaService } from '../../prisma.service';

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
        metaDados: {
          channelName: 'telegram',
          chatId: chatId.toString(),
          linkedAt: new Date().toISOString(),
        },
      });

      const result = await service.findByChat(channelName, chatId);

      expect(result).toBe(userId);
    });

    it('deve retornar null quando DVincula não existe', async () => {
      prisma.dVincula.findFirst.mockResolvedValue(null);

      const result = await service.findByChat(channelName, chatId);

      expect(result).toBeNull();
    });

    it('deve retornar null quando chatId não corresponde', async () => {
      prisma.dVincula.findFirst.mockResolvedValue({
        chave: BigInt(1),
        idLocEscritu: userId,
        metaDados: {
          channelName: 'telegram',
          chatId: '999999999', // chatId diferente
          linkedAt: new Date().toISOString(),
        },
      });

      const result = await service.findByChat(channelName, chatId);

      expect(result).toBeNull();
    });

    it('deve retornar null quando idLocEscritu é null', async () => {
      prisma.dVincula.findFirst.mockResolvedValue({
        chave: BigInt(1),
        idLocEscritu: null,
        metaDados: {
          channelName: 'telegram',
          chatId: chatId.toString(),
          linkedAt: new Date().toISOString(),
        },
      });

      const result = await service.findByChat(channelName, chatId);

      expect(result).toBeNull();
    });

    it('deve fazer uma única query (sem N+1)', async () => {
      prisma.dVincula.findFirst.mockResolvedValue(null);

      await service.findByChat(channelName, chatId);

      // Verificar que apenas 1 query foi feita
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

    it('deve filtrar pelo channelName via path JSON', async () => {
      prisma.dVincula.findFirst.mockResolvedValue(null);

      await service.findByChat('telegram', chatId);

      const callArgs = prisma.dVincula.findFirst.mock.calls[0][0];
      expect(callArgs.where.metaDados).toMatchObject({
        path: ['channelName'],
        equals: 'telegram',
      });
    });
  });
});
