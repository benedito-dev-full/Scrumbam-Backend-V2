import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { BookmarksService } from './bookmarks.service';
import { PrismaService } from '../prisma.service';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';
import { ListBookmarksQueryDto } from './dto/list-bookmarks-query.dto';

/** Mock minimo da PrismaService para testes unitarios. */
const mockPrisma = {
  dVincula: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  dProject: {
    findFirst: jest.fn(),
  },
  dEntidade: {
    findFirst: jest.fn(),
  },
};

const USER_ID = BigInt(100);
const TARGET_ID = BigInt(350);
const BOOKMARK_ID = BigInt(1001);
const BOOKMARK_CLASSE = BigInt(-187);

/** Factory de DVincula mock reutilizada nos testes. */
function makeVincula(overrides: Partial<{
  chave: bigint;
  idLocEscritu: bigint;
  idEntidade: bigint | null;
  idClasse: bigint;
  excluido: boolean;
  metaDados: Record<string, unknown> | null;
  criadoEm: Date;
}> = {}) {
  return {
    chave: BOOKMARK_ID,
    idClasse: BOOKMARK_CLASSE,
    idLocEscritu: USER_ID,
    idEntidade: TARGET_ID,
    excluido: false,
    metaDados: { targetType: 'space' },
    criadoEm: new Date('2026-05-27T14:00:00Z'),
    ...overrides,
  };
}

describe('BookmarksService', () => {
  let service: BookmarksService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookmarksService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BookmarksService>(BookmarksService);
  });

  // =========================================================================
  // findMany
  // =========================================================================

  describe('findMany', () => {
    it('deve retornar lista paginada do usuario sem filtro de tipo', async () => {
      const vincula = makeVincula();
      mockPrisma.dVincula.findMany.mockResolvedValueOnce([vincula]);

      const query: ListBookmarksQueryDto = {};
      const result = await service.findMany(USER_ID, query);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(BOOKMARK_ID.toString());
      expect(result.items[0].targetId).toBe(TARGET_ID.toString());
      expect(result.items[0].targetType).toBe('space');
      expect(result.pagination.hasMore).toBe(false);
    });

    it('deve filtrar por targetType via WHERE do Prisma', async () => {
      // O banco ja filtra: mock retorna apenas o registro do tipo solicitado
      const spaceVincula = makeVincula({ chave: BigInt(1001), metaDados: { targetType: 'space' } });
      mockPrisma.dVincula.findMany.mockResolvedValueOnce([spaceVincula]);

      const query: ListBookmarksQueryDto = { targetType: 'space' };
      const result = await service.findMany(USER_ID, query);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].targetType).toBe('space');
      // Verifica que o filtro foi passado no where para o Prisma
      expect(mockPrisma.dVincula.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            metaDados: { path: ['targetType'], equals: 'space' },
          }),
        }),
      );
    });

    it('deve indicar hasMore quando ha mais registros que o limit', async () => {
      // Retornar limit+1 registros para simular hasMore=true
      const rows = Array.from({ length: 21 }, (_, i) =>
        makeVincula({ chave: BigInt(1000 + i) }),
      );
      mockPrisma.dVincula.findMany.mockResolvedValueOnce(rows);

      const query: ListBookmarksQueryDto = { limit: 20 };
      const result = await service.findMany(USER_ID, query);

      expect(result.items).toHaveLength(20);
      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).not.toBeNull();
    });
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('deve criar bookmark novo com sucesso (201)', async () => {
      // assertTargetExists: space existe no banco
      mockPrisma.dProject.findFirst.mockResolvedValueOnce({ chave: TARGET_ID });
      mockPrisma.dVincula.findMany.mockResolvedValueOnce([]); // nenhum existente
      const created = makeVincula();
      mockPrisma.dVincula.create.mockResolvedValueOnce(created);

      const dto: CreateBookmarkDto = { targetId: '350', targetType: 'space' };
      const result = await service.create(USER_ID, dto);

      expect(result.reactivated).toBe(false);
      expect(result.bookmark.id).toBe(BOOKMARK_ID.toString());
      expect(result.bookmark.targetType).toBe('space');
      expect(mockPrisma.dVincula.create).toHaveBeenCalledTimes(1);
    });

    it('deve reativar DVincula soft-deleted (200)', async () => {
      // assertTargetExists: space existe no banco
      mockPrisma.dProject.findFirst.mockResolvedValueOnce({ chave: TARGET_ID });
      const softDeleted = makeVincula({ excluido: true });
      mockPrisma.dVincula.findMany.mockResolvedValueOnce([softDeleted]);
      const reactivated = makeVincula({ excluido: false });
      mockPrisma.dVincula.update.mockResolvedValueOnce(reactivated);

      const dto: CreateBookmarkDto = { targetId: '350', targetType: 'space' };
      const result = await service.create(USER_ID, dto);

      expect(result.reactivated).toBe(true);
      expect(result.bookmark.id).toBe(BOOKMARK_ID.toString());
      expect(mockPrisma.dVincula.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chave: BOOKMARK_ID },
          data: { excluido: false },
        }),
      );
      expect(mockPrisma.dVincula.create).not.toHaveBeenCalled();
    });

    it('deve lancar ConflictException se bookmark ja existe ativo (409)', async () => {
      // assertTargetExists: space existe no banco
      mockPrisma.dProject.findFirst.mockResolvedValueOnce({ chave: TARGET_ID });
      const active = makeVincula({ excluido: false });
      mockPrisma.dVincula.findMany.mockResolvedValueOnce([active]);

      const dto: CreateBookmarkDto = { targetId: '350', targetType: 'space' };

      await expect(service.create(USER_ID, dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.dVincula.create).not.toHaveBeenCalled();
    });

    it('deve lancar BadRequestException se targetId nao e numero valido (400)', async () => {
      const dto: CreateBookmarkDto = { targetId: 'nao-um-numero', targetType: 'space' };

      await expect(service.create(USER_ID, dto)).rejects.toThrow(BadRequestException);
      // assertTargetExists nao e chamado — excecao ocorre antes da conversao BigInt
      expect(mockPrisma.dProject.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.dVincula.findMany).not.toHaveBeenCalled();
    });

    // --- Novos casos D2: validacao de existencia do alvo ---

    it('deve lancar NotFoundException se targetType=space e alvo nao existe (404)', async () => {
      mockPrisma.dProject.findFirst.mockResolvedValueOnce(null);

      const dto: CreateBookmarkDto = { targetId: '350', targetType: 'space' };
      await expect(service.create(USER_ID, dto)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.dVincula.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.dVincula.create).not.toHaveBeenCalled();
    });

    it('deve lancar NotFoundException se targetType=folder e alvo nao existe (404)', async () => {
      mockPrisma.dProject.findFirst.mockResolvedValueOnce(null);

      const dto: CreateBookmarkDto = { targetId: '350', targetType: 'folder' };
      await expect(service.create(USER_ID, dto)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.dVincula.findMany).not.toHaveBeenCalled();
    });

    it('deve lancar NotFoundException se targetType=list e alvo nao existe (404)', async () => {
      mockPrisma.dProject.findFirst.mockResolvedValueOnce(null);

      const dto: CreateBookmarkDto = { targetId: '350', targetType: 'list' };
      await expect(service.create(USER_ID, dto)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.dVincula.findMany).not.toHaveBeenCalled();
    });

    it('deve criar bookmark de team com sucesso quando dEntidade existe (201)', async () => {
      // assertTargetExists: team existe no banco (dEntidade)
      mockPrisma.dEntidade.findFirst.mockResolvedValueOnce({ chave: TARGET_ID });
      mockPrisma.dVincula.findMany.mockResolvedValueOnce([]);
      const created = makeVincula({ metaDados: { targetType: 'team' } });
      mockPrisma.dVincula.create.mockResolvedValueOnce(created);

      const dto: CreateBookmarkDto = { targetId: '350', targetType: 'team' };
      const result = await service.create(USER_ID, dto);

      expect(result.reactivated).toBe(false);
      expect(mockPrisma.dEntidade.findFirst).toHaveBeenCalledTimes(1);
      expect(mockPrisma.dVincula.create).toHaveBeenCalledTimes(1);
    });

    it('deve lancar NotFoundException se targetType=team e alvo nao existe (404)', async () => {
      mockPrisma.dEntidade.findFirst.mockResolvedValueOnce(null);

      const dto: CreateBookmarkDto = { targetId: '350', targetType: 'team' };
      await expect(service.create(USER_ID, dto)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.dVincula.findMany).not.toHaveBeenCalled();
    });

    it('deve lancar HttpException 501 se targetType=doc (nao implementado)', async () => {
      const dto: CreateBookmarkDto = { targetId: '350', targetType: 'doc' };
      const error = await service.create(USER_ID, dto).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
      expect(mockPrisma.dProject.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.dEntidade.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.dVincula.findMany).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // remove
  // =========================================================================

  describe('remove', () => {
    it('deve fazer soft-delete do bookmark com sucesso (204)', async () => {
      const vincula = makeVincula();
      mockPrisma.dVincula.findFirst.mockResolvedValueOnce(vincula);
      mockPrisma.dVincula.update.mockResolvedValueOnce({ ...vincula, excluido: true });

      await expect(service.remove(USER_ID, BOOKMARK_ID)).resolves.toBeUndefined();
      expect(mockPrisma.dVincula.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chave: BOOKMARK_ID },
          data: { excluido: true },
        }),
      );
    });

    it('deve lancar NotFoundException se bookmark nao existe (404)', async () => {
      mockPrisma.dVincula.findFirst.mockResolvedValueOnce(null);

      await expect(service.remove(USER_ID, BOOKMARK_ID)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.dVincula.update).not.toHaveBeenCalled();
    });

    it('deve lancar ForbiddenException se bookmark pertence a outro usuario (403)', async () => {
      const outroUserId = BigInt(999);
      const vinculaOutroUsuario = makeVincula({ idLocEscritu: outroUserId });
      mockPrisma.dVincula.findFirst.mockResolvedValueOnce(vinculaOutroUsuario);

      await expect(service.remove(USER_ID, BOOKMARK_ID)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.dVincula.update).not.toHaveBeenCalled();
    });
  });
});
