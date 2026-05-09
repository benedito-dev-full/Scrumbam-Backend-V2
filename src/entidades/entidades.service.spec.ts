import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { EntidadeService } from './entidades.service';
import { PrismaService } from '../prisma.service';
import { TimezoneService } from '../common/services/timezone.service';

/** Mock de DEntidade retornado pelo Prisma */
const mockEntidade = {
  chave: BigInt(150),
  idClasse: BigInt(-150),
  codigo: 'USR-001',
  nome: 'João Silva',
  nomeFantasia: null,
  email: 'joao@empresa.com',
  cpfCnpj: null,
  telefone: null,
  celular: null,
  idEstab: null,
  idLocEscritu: null,
  dUserGroupId: null,
  dados: null,
  metaDados: null,
  inativo: false,
  excluido: false,
  criadoEm: new Date('2026-05-08'),
  atualizadoEm: new Date('2026-05-08'),
  classe: { codigo: 'USER', nome: 'Usuário' },
};

/** Mock de DClasse válida */
const mockClasse = { chave: BigInt(-150), nome: 'Usuário' };

describe('EntidadeService', () => {
  let service: EntidadeService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      dClasse: {
        findFirst: jest.fn(),
      },
      dEntidade: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      dEvento: {
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntidadeService,
        { provide: PrismaService, useValue: mockPrisma },
        TimezoneService,
      ],
    }).compile();

    service = module.get<EntidadeService>(EntidadeService);
    prisma = module.get(PrismaService);
  });

  describe('listarPorClasse', () => {
    it('retorna lista vazia com DClasse válida', async () => {
      (prisma.dClasse.findFirst as jest.Mock).mockResolvedValue(mockClasse);
      (prisma.dEntidade.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listarPorClasse({ idClasse: '-150' });

      expect(result.items).toHaveLength(0);
      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.nextCursor).toBeNull();
    });

    it('lança NotFoundException com DClasse inválida', async () => {
      (prisma.dClasse.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.listarPorClasse({ idClasse: '-9999' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('resolve alias ?classe=USER via busca no banco (deprecated ADR-V2-015)', async () => {
      // Primeiro: validação de DClasse, depois: busca por código
      (prisma.dClasse.findFirst as jest.Mock)
        .mockResolvedValueOnce({ chave: BigInt(-150) }) // resolveIdClasse (alias lookup)
        .mockResolvedValueOnce(mockClasse); // validarClasse
      (prisma.dEntidade.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listarPorClasse({ classe: 'USER' });

      expect(result.items).toHaveLength(0);
      expect(prisma.dClasse.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ codigo: 'USER' }) }),
      );
    });

    it('lança BadRequestException quando ambos idClasse e classe estão presentes', async () => {
      await expect(
        service.listarPorClasse({ idClasse: '-150', classe: 'USER' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('criar', () => {
    it('cria DEntidade e DEvento em transaction', async () => {
      (prisma.dClasse.findFirst as jest.Mock).mockResolvedValue(mockClasse);
      (prisma.dEntidade.findFirst as jest.Mock).mockResolvedValue(null); // sem duplicata email
      (prisma.$transaction as jest.Mock).mockImplementation((fn) =>
        fn({ dEntidade: { create: jest.fn().mockResolvedValue(mockEntidade) }, dEvento: { create: jest.fn() } }),
      );

      const result = await service.criar({
        idClasse: '-150',
        nome: 'João Silva',
        email: 'joao@empresa.com',
      });

      expect(result.nome).toBe('João Silva');
      expect(result.chave).toBe('150');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('lança NotFoundException se DClasse não existe', async () => {
      (prisma.dClasse.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.criar({ idClasse: '-9999', nome: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lança ConflictException se email já existe', async () => {
      (prisma.dClasse.findFirst as jest.Mock).mockResolvedValue(mockClasse);
      (prisma.dEntidade.findFirst as jest.Mock).mockResolvedValue(mockEntidade); // email duplicado

      await expect(
        service.criar({ idClasse: '-150', nome: 'Test', email: 'joao@empresa.com' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('buscarPorId', () => {
    it('lança NotFoundException quando entidade não existe', async () => {
      (prisma.dEntidade.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.buscarPorId('9999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('marca excluido=true via update', async () => {
      // buscarPorId first
      (prisma.dEntidade.findFirst as jest.Mock).mockResolvedValue(mockEntidade);
      (prisma.dEntidade.update as jest.Mock).mockResolvedValue({ ...mockEntidade, excluido: true });

      await service.softDelete('150');

      expect(prisma.dEntidade.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chave: BigInt(150) },
          data: { excluido: true },
        }),
      );
    });
  });

  describe('getEntidadeIdFromUserGroup', () => {
    it('retorna chave da DEntidade associada ao DUserGroup', async () => {
      (prisma.dEntidade.findFirst as jest.Mock).mockResolvedValue({ chave: BigInt(150) });

      const result = await service.getEntidadeIdFromUserGroup(BigInt(1));

      expect(result).toBe(BigInt(150));
    });

    it('lança NotFoundException quando DEntidade não encontrada para userGroup', async () => {
      (prisma.dEntidade.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getEntidadeIdFromUserGroup(BigInt(9999)),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
