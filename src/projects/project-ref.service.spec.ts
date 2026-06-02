import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';
import {
  ProjectRefService,
  ID_CLASSE_PROJECT_REF,
} from './project-ref.service';

/**
 * Specs do ProjectRefService (ADR-V2-058).
 *
 * Cobre os invariantes que sustentam a correção do bug FK
 * (DVincula_idLocEscritu_fkey): idempotência da criação do espelho,
 * recriação de ponteiro órfão, resolução P↔E e cache.
 */
describe('ProjectRefService', () => {
  let service: ProjectRefService;
  let prisma: {
    dEntidade: { findFirst: jest.Mock; create: jest.Mock };
    dProject: { findFirst: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      dEntidade: { findFirst: jest.fn(), create: jest.fn() },
      dProject: { findFirst: jest.fn(), update: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [ProjectRefService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ProjectRefService);
  });

  describe('ensureEntidadeRef', () => {
    it('cria a DEntidade-espelho (-158) e grava o ponteiro forward quando não existe', async () => {
      prisma.dEntidade.create.mockResolvedValue({ chave: BigInt(5000) });
      prisma.dProject.update.mockResolvedValue({});

      const project = { chave: BigInt(42), nome: 'Projeto X', idEstab: BigInt(2), dados: {} };
      const refId = await service.ensureEntidadeRef(prisma as never, project);

      expect(refId).toBe(BigInt(5000));
      // Espelho criado com idClasse -158 e ponteiro reverso projectId=42.
      expect(prisma.dEntidade.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idClasse: ID_CLASSE_PROJECT_REF,
            nome: 'Projeto X',
            idEstab: BigInt(2),
            dados: { projectId: '42' },
          }),
        }),
      );
      // Ponteiro forward gravado em DProject.dados.
      expect(prisma.dProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chave: BigInt(42) },
          data: { dados: { entidadeRefId: '5000' } },
        }),
      );
    });

    it('é idempotente: não recria quando o espelho já existe e está vivo', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue({ chave: BigInt(5000) });

      const project = {
        chave: BigInt(42),
        nome: 'Projeto X',
        idEstab: null,
        dados: { entidadeRefId: '5000' },
      };
      const refId = await service.ensureEntidadeRef(prisma as never, project);

      expect(refId).toBe(BigInt(5000));
      expect(prisma.dEntidade.create).not.toHaveBeenCalled();
      expect(prisma.dProject.update).not.toHaveBeenCalled();
    });

    it('recria o espelho quando o ponteiro forward está órfão (espelho ausente)', async () => {
      // Ponteiro aponta para refId, mas a espelho não existe mais.
      prisma.dEntidade.findFirst.mockResolvedValue(null);
      prisma.dEntidade.create.mockResolvedValue({ chave: BigInt(6000) });
      prisma.dProject.update.mockResolvedValue({});

      const project = {
        chave: BigInt(42),
        nome: 'Projeto X',
        idEstab: null,
        dados: { entidadeRefId: '5000', slug: 'projeto-x' },
      };
      const refId = await service.ensureEntidadeRef(prisma as never, project);

      expect(refId).toBe(BigInt(6000));
      expect(prisma.dEntidade.create).toHaveBeenCalledTimes(1);
      // Merge preserva campos existentes de dados (slug) ao regravar o ponteiro.
      expect(prisma.dProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { dados: { slug: 'projeto-x', entidadeRefId: '6000' } },
        }),
      );
    });

    it('omite idEstab quando o projeto não tem org (idEstab null)', async () => {
      prisma.dEntidade.create.mockResolvedValue({ chave: BigInt(7000) });
      prisma.dProject.update.mockResolvedValue({});

      await service.ensureEntidadeRef(prisma as never, {
        chave: BigInt(9),
        nome: 'Space raiz',
        idEstab: null,
        dados: {},
      });

      const createArg = prisma.dEntidade.create.mock.calls[0][0];
      expect(createArg.data).not.toHaveProperty('idEstab');
    });
  });

  describe('ensureEntidadeRefById', () => {
    it('lança erro quando o projeto não existe', async () => {
      prisma.dProject.findFirst.mockResolvedValue(null);
      await expect(service.ensureEntidadeRefById(BigInt(999))).rejects.toThrow(
        /DProject 999 não encontrado/,
      );
    });

    it('carrega o projeto e garante o espelho real (E) numa transação', async () => {
      prisma.dProject.findFirst.mockResolvedValue({
        chave: BigInt(42),
        nome: 'Projeto X',
        idEstab: BigInt(2),
        dados: {},
      });
      prisma.dEntidade.create.mockResolvedValue({ chave: BigInt(5000) });
      prisma.dProject.update.mockResolvedValue({});

      const refId = await service.ensureEntidadeRefById(BigInt(42));

      expect(refId).toBe(BigInt(5000));
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});
