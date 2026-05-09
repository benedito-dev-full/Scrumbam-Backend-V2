import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'crypto';
import { RefreshTokenService } from './refresh-token.service';
import { PrismaService } from '../../prisma.service';

const makePrismaMock = () => ({
  dUserGroup: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
});

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<RefreshTokenService>(RefreshTokenService);
  });

  describe('generate', () => {
    it('deve gerar token e salvar hash no banco', async () => {
      prisma.dUserGroup.findUnique.mockResolvedValue({ dados: {} });
      prisma.dUserGroup.update.mockResolvedValue({});

      const token = await service.generate(BigInt(1));

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(32);
      expect(prisma.dUserGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chave: BigInt(1) },
          data: expect.objectContaining({ dados: expect.objectContaining({ refreshTokenHash: expect.any(String) }) }),
        }),
      );
    });
  });

  describe('validate', () => {
    it('deve retornar true para token válido', async () => {
      const plaintext = 'valid-token-plaintext';
      const hash = createHash('sha256').update(plaintext).digest('hex');

      prisma.dUserGroup.findUnique.mockResolvedValue({ dados: { refreshTokenHash: hash } });

      const result = await service.validate(plaintext, BigInt(1));
      expect(result).toBe(true);
    });

    it('deve retornar false para token inválido', async () => {
      prisma.dUserGroup.findUnique.mockResolvedValue({ dados: { refreshTokenHash: 'otherhash' } });

      const result = await service.validate('wrong-token', BigInt(1));
      expect(result).toBe(false);
    });

    it('deve retornar false se token foi revogado (refreshTokenHash null)', async () => {
      prisma.dUserGroup.findUnique.mockResolvedValue({ dados: {} });

      const result = await service.validate('any-token', BigInt(1));
      expect(result).toBe(false);
    });
  });

  describe('revoke', () => {
    it('deve limpar refreshTokenHash do banco', async () => {
      prisma.dUserGroup.findUnique.mockResolvedValue({
        dados: { refreshTokenHash: 'somehash', mcpKeyHash: 'mcphash' },
      });
      prisma.dUserGroup.update.mockResolvedValue({});

      await service.revoke(BigInt(1));

      const updateCall = prisma.dUserGroup.update.mock.calls[0][0];
      expect(updateCall.data.dados).not.toHaveProperty('refreshTokenHash');
      // mcpKeyHash deve ser preservado
      expect(updateCall.data.dados).toHaveProperty('mcpKeyHash', 'mcphash');
    });
  });
});
