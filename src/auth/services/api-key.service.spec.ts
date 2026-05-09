import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ApiKeyService } from './api-key.service';
import { PrismaService } from '../../prisma.service';

const makePrismaMock = () => ({
  dTabela: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
});

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ApiKeyService>(ApiKeyService);
  });

  describe('generate', () => {
    it('deve criar DTabela(-471) e retornar key plaintext', async () => {
      prisma.dTabela.create.mockResolvedValue({
        chave: BigInt(100),
        criadoEm: new Date(),
      });

      const result = await service.generate(BigInt(10), BigInt(2));

      expect(result.key).toBeDefined();
      expect(result.key!.startsWith('sk_live_')).toBe(true);
      expect(result.prefix).toBe(result.key!.slice(0, 8));
      expect(result.id).toBe('100');
      expect(prisma.dTabela.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idClasse: BigInt(-471),
            dEntidadeId: BigInt(10),
          }),
        }),
      );
    });
  });

  describe('validate', () => {
    it('deve retornar resultado válido para hash correto', async () => {
      const plaintext = `sk_live_${randomBytes(24).toString('hex')}`;
      const hash = createHash('sha256').update(plaintext).digest('hex');

      prisma.dTabela.findMany.mockResolvedValue([
        {
          chave: BigInt(100),
          dEntidadeId: BigInt(10),
          dados: { hash, prefix: plaintext.slice(0, 8) },
        },
      ]);
      prisma.dTabela.update.mockResolvedValue({});

      const result = await service.validate(plaintext);

      expect(result).not.toBeNull();
      expect(result!.tabelaChave).toBe(BigInt(100));
    });

    it('deve retornar null para key inválida', async () => {
      prisma.dTabela.findMany.mockResolvedValue([
        {
          chave: BigInt(100),
          dEntidadeId: BigInt(10),
          dados: { hash: 'wronghash' },
        },
      ]);

      const result = await service.validate('invalid_key');
      expect(result).toBeNull();
    });

    it('deve retornar null quando nenhuma key existe', async () => {
      prisma.dTabela.findMany.mockResolvedValue([]);
      const result = await service.validate('any_key');
      expect(result).toBeNull();
    });
  });

  describe('revoke', () => {
    it('deve fazer soft-delete da API Key', async () => {
      prisma.dTabela.findFirst.mockResolvedValue({ chave: BigInt(100) });
      prisma.dTabela.update.mockResolvedValue({});

      await service.revoke(BigInt(100));

      expect(prisma.dTabela.update).toHaveBeenCalledWith({
        where: { chave: BigInt(100) },
        data: { excluido: true },
      });
    });

    it('deve lançar NotFoundException se key não encontrada', async () => {
      prisma.dTabela.findFirst.mockResolvedValue(null);

      await expect(service.revoke(BigInt(999))).rejects.toThrow(NotFoundException);
    });
  });
});
