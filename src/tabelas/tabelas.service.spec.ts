import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TabelaService } from './tabelas.service';
import { PrismaService } from '../prisma.service';

/** Mock de DTabela retornado pelo Prisma */
const mockTabela = {
  chave: BigInt(1),
  idClasse: BigInt(-440),
  codigo: 'INBOX',
  nome: 'Inbox',
  descricao: null,
  percentual: null,
  recurso: null,
  uf: null,
  dEntidadeId: null,
  idLocEscrituracao: null,
  dados: null,
  metaDados: null,
  inativo: false,
  excluido: false,
  criadoEm: new Date('2026-05-08'),
  atualizadoEm: new Date('2026-05-08'),
  classe: { codigo: 'STATUS_INTENTION_V3', nome: 'Status Intention V3' },
};

const mockClasse = { chave: BigInt(-440) };

describe('TabelaService', () => {
  let service: TabelaService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      dClasse: { findFirst: jest.fn() },
      dTabela: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TabelaService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TabelaService>(TabelaService);
    prisma = module.get(PrismaService);
  });

  describe('listarPorClasse', () => {
    it('retorna statuses quando idClasse=-440', async () => {
      (prisma.dClasse.findFirst as jest.Mock).mockResolvedValue(mockClasse);
      (prisma.dTabela.findMany as jest.Mock).mockResolvedValue([mockTabela]);

      const result = await service.listarPorClasse({ idClasse: '-440' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].codigo).toBe('INBOX');
      expect(result.pagination.hasMore).toBe(false);
    });

    it('filtra por dEntidadeId quando fornecido', async () => {
      (prisma.dClasse.findFirst as jest.Mock).mockResolvedValue(mockClasse);
      (prisma.dTabela.findMany as jest.Mock).mockResolvedValue([]);

      await service.listarPorClasse({ idClasse: '-470', dEntidadeId: '100' });

      expect(prisma.dTabela.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ dEntidadeId: BigInt(100) }),
        }),
      );
    });

    it('lança NotFoundException com DClasse inválida', async () => {
      (prisma.dClasse.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.listarPorClasse({ idClasse: '-9999' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lança BadRequestException sem idClasse ou classe', async () => {
      await expect(service.listarPorClasse({})).rejects.toThrow(BadRequestException);
    });
  });

  describe('criar', () => {
    it('insere e retorna tabela criada', async () => {
      (prisma.dClasse.findFirst as jest.Mock).mockResolvedValue(mockClasse);
      (prisma.dTabela.create as jest.Mock).mockResolvedValue(mockTabela);

      const result = await service.criar({ idClasse: '-440', nome: 'Inbox' });

      expect(result.nome).toBe('Inbox');
      expect(result.chave).toBe('1');
    });
  });

  describe('atualizar', () => {
    it('atualiza campos da tabela', async () => {
      (prisma.dTabela.findFirst as jest.Mock).mockResolvedValue(mockTabela);
      const updated = { ...mockTabela, nome: 'Inbox Atualizado' };
      (prisma.dTabela.update as jest.Mock).mockResolvedValue(updated);

      const result = await service.atualizar('1', { nome: 'Inbox Atualizado' });

      expect(result.nome).toBe('Inbox Atualizado');
    });
  });

  describe('softDelete', () => {
    it('marca excluido=true', async () => {
      (prisma.dTabela.findFirst as jest.Mock).mockResolvedValue(mockTabela);
      (prisma.dTabela.update as jest.Mock).mockResolvedValue({ ...mockTabela, excluido: true });

      await service.softDelete('1');

      expect(prisma.dTabela.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chave: BigInt(1) },
          data: { excluido: true },
        }),
      );
    });
  });
});
