import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ClasseService } from './classes.service';
import { PrismaService } from '../prisma.service';

/** DClasses simulando o seed V2 */
const mockClasses = [
  { chave: BigInt(-1), codigo: 'ROOT', nome: 'Root', idPai: null, agrupamento: true, inativo: false, excluido: false, excluivel: false, editavel: false, tableFields: null },
  { chave: BigInt(-51), codigo: 'TABELAS', nome: 'Tabelas', idPai: BigInt(-1), agrupamento: true, inativo: false, excluido: false, excluivel: false, editavel: false, tableFields: null },
  { chave: BigInt(-400), codigo: 'SPRINT', nome: 'Sprint', idPai: BigInt(-51), agrupamento: false, inativo: false, excluido: false, excluivel: true, editavel: true, tableFields: null },
];

describe('ClasseService', () => {
  let service: ClasseService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      dClasse: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClasseService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ClasseService>(ClasseService);
    prisma = module.get(PrismaService);
  });

  describe('getTree', () => {
    it('retorna árvore com 1 query + Map em memória (N+1 ZERO)', async () => {
      const findManySpy = jest.spyOn(prisma.dClasse, 'findMany').mockResolvedValue(mockClasses as never);

      const tree = await service.getTree();

      // Verifica que apenas 1 query foi executada
      expect(findManySpy).toHaveBeenCalledTimes(1);
      expect(tree.chave).toBe('-1');
      expect(tree.nome).toBe('Root');
      expect(tree.filhos).toHaveLength(1);
      expect(tree.filhos[0].chave).toBe('-51');
      expect(tree.filhos[0].filhos[0].chave).toBe('-400');
    });

    it('lança NotFoundException se rootChave não existe', async () => {
      (prisma.dClasse.findMany as jest.Mock).mockResolvedValue(mockClasses);

      await expect(service.getTree(BigInt(-9999))).rejects.toThrow(NotFoundException);
    });
  });

  describe('listarFlat', () => {
    it('retorna DClasse Sprint quando nome=Sprint', async () => {
      (prisma.dClasse.findMany as jest.Mock).mockResolvedValue([mockClasses[2]]);

      const result = await service.listarFlat({ nome: 'Sprint' });

      expect(result).toHaveLength(1);
      expect(result[0].codigo).toBe('SPRINT');
      expect(result[0].chave).toBe('-400');
    });
  });

  describe('buscarPorId', () => {
    it('lança NotFoundException quando ID não existe', async () => {
      (prisma.dClasse.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.buscarPorId('-9999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getFieldsByClasse', () => {
    it('retorna tableFields ou null para DClasse existente', async () => {
      (prisma.dClasse.findFirst as jest.Mock).mockResolvedValue({ tableFields: null, nome: 'Sprint' });

      const result = await service.getFieldsByClasse('-400');

      expect(result).toBeNull();
    });
  });
});
