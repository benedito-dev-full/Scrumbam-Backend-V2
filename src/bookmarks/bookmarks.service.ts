import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';
import { ListBookmarksQueryDto } from './dto/list-bookmarks-query.dto';
import { BookmarkResponseDto, ListBookmarksResponseDto } from './dto/bookmark-response.dto';

/** DClasse -187 — BOOKMARK (seedada em ADR-V2-051). */
const BOOKMARK_CLASSE = BigInt(-187);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Resultado interno do create, distinguindo criacao de reativacao. */
interface CreateResult {
  bookmark: BookmarkResponseDto;
  reactivated: boolean;
}

/**
 * Verifica se um valor e um objeto de mapa chave-valor (nao array, nao null).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Converte um registro DVincula para BookmarkResponseDto.
 *
 * @param row - Linha do DVincula com os campos necessarios.
 * @returns DTO de resposta sem BigInt cru.
 */
function toBookmarkResponse(row: {
  chave: bigint;
  idEntidade: bigint | null;
  metaDados: Prisma.JsonValue | null;
  criadoEm: Date;
}): BookmarkResponseDto {
  const meta = isRecord(row.metaDados) ? row.metaDados : {};
  return {
    id: row.chave.toString(),
    targetId: row.idEntidade?.toString() ?? '',
    targetType: typeof meta['targetType'] === 'string' ? meta['targetType'] : '',
    criadoEm: row.criadoEm.toISOString(),
  };
}

/**
 * Service de bookmarks/favoritos persistidos em `DVincula -187`.
 *
 * Logica de deduplicacao: antes de criar, verifica se ja existe DVincula
 * com mesmo `(idLocEscritu, idEntidade, metaDados.targetType)`:
 *  - Se existe e `excluido=false`: lanca ConflictException (409)
 *  - Se existe e `excluido=true`: reativa via update (200)
 *  - Se nao existe: cria novo (201)
 *
 * Ownership: DELETE valida `idLocEscritu === userId` antes do soft-delete.
 */
@Injectable()
export class BookmarksService {
  private readonly logger = new Logger(BookmarksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista bookmarks do usuario autenticado com cursor pagination.
   *
   * Filtro por `targetType` e aplicado diretamente no WHERE do Prisma via
   * JSON path filter (`metaDados.targetType`), garantindo que `hasMore`
   * reflita corretamente o total do banco independente do tipo.
   *
   * @param userId - `DEntidade.chave` do usuario autenticado.
   * @param query - Filtros e paginacao.
   * @returns Lista paginada sem BigInt cru.
   */
  async findMany(userId: bigint, query: ListBookmarksQueryDto): Promise<ListBookmarksResponseDto> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const cursor = query.cursor ? BigInt(query.cursor) : undefined;

    const rows = await this.prisma.dVincula.findMany({
      where: {
        idClasse: BOOKMARK_CLASSE,
        idLocEscritu: userId,
        excluido: false,
        ...(cursor !== undefined ? { chave: { lt: cursor } } : {}),
        ...(query.targetType && {
          metaDados: {
            path: ['targetType'],
            equals: query.targetType,
          },
        }),
      },
      select: {
        chave: true,
        idEntidade: true,
        metaDados: true,
        criadoEm: true,
      },
      orderBy: { chave: 'desc' },
      take: limit + 1,
    });

    const items = rows.slice(0, limit).map(toBookmarkResponse);
    const hasMore = rows.length > limit;

    return {
      items,
      pagination: {
        hasMore,
        nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      },
    };
  }

  /**
   * Cria um bookmark ou reativa um soft-deleted existente.
   *
   * Deduplicacao logica por `(userId, targetId, targetType)`:
   *  - DVincula existente com `excluido=false` → ConflictException (409)
   *  - DVincula existente com `excluido=true` → reativa e retorna `reactivated=true`
   *  - Nao existe → cria novo e retorna `reactivated=false`
   *
   * @param userId - `DEntidade.chave` do usuario autenticado.
   * @param dto - Dados do bookmark a criar.
   * @returns Bookmark criado/reativado e flag de reativacao.
   * @throws {BadRequestException} Se `targetId` nao e um numero valido.
   * @throws {ConflictException} Se bookmark ja existe e esta ativo.
   */
  async create(userId: bigint, dto: CreateBookmarkDto): Promise<CreateResult> {
    let targetId: bigint;
    try {
      targetId = BigInt(dto.targetId);
    } catch {
      throw new BadRequestException(
        `targetId "${dto.targetId}" nao e um numero valido para BigInt`,
      );
    }

    // Busca DVinculas existentes com mesmo (idLocEscritu, idEntidade, idClasse)
    const existingRows = await this.prisma.dVincula.findMany({
      where: {
        idClasse: BOOKMARK_CLASSE,
        idLocEscritu: userId,
        idEntidade: targetId,
      },
      select: {
        chave: true,
        excluido: true,
        metaDados: true,
        idEntidade: true,
        criadoEm: true,
      },
    });

    // Filtrar por targetType em memoria
    const existing = existingRows.find((row) => {
      const meta = isRecord(row.metaDados) ? row.metaDados : {};
      return meta['targetType'] === dto.targetType;
    });

    if (existing) {
      if (!existing.excluido) {
        throw new ConflictException(
          `Bookmark para ${dto.targetType}/${dto.targetId} ja existe`,
        );
      }

      // Reativar soft-deleted
      const reactivated = await this.prisma.dVincula.update({
        where: { chave: existing.chave },
        data: { excluido: false },
        select: {
          chave: true,
          idEntidade: true,
          metaDados: true,
          criadoEm: true,
        },
      });

      this.logger.log(
        `bookmark reativado: id=${reactivated.chave} user=${userId} targetType=${dto.targetType} targetId=${targetId}`,
      );

      return {
        bookmark: toBookmarkResponse(reactivated),
        reactivated: true,
      };
    }

    // Criar novo DVincula
    const created = await this.prisma.dVincula.create({
      data: {
        idClasse: BOOKMARK_CLASSE,
        idLocEscritu: userId,
        idEntidade: targetId,
        metaDados: { targetType: dto.targetType } as Prisma.InputJsonValue,
        excluido: false,
      },
      select: {
        chave: true,
        idEntidade: true,
        metaDados: true,
        criadoEm: true,
      },
    });

    this.logger.log(
      `bookmark criado: id=${created.chave} user=${userId} targetType=${dto.targetType} targetId=${targetId}`,
    );

    return {
      bookmark: toBookmarkResponse(created),
      reactivated: false,
    };
  }

  /**
   * Remove (soft-delete) um bookmark do usuario, validando ownership.
   *
   * @param userId - `DEntidade.chave` do usuario autenticado.
   * @param bookmarkId - `DVincula.chave` do bookmark a remover.
   * @throws {NotFoundException} Se o bookmark nao existe ou ja esta excluido.
   * @throws {ForbiddenException} Se o bookmark nao pertence ao usuario.
   */
  async remove(userId: bigint, bookmarkId: bigint): Promise<void> {
    const bookmark = await this.prisma.dVincula.findFirst({
      where: {
        chave: bookmarkId,
        idClasse: BOOKMARK_CLASSE,
        excluido: false,
      },
      select: {
        chave: true,
        idLocEscritu: true,
      },
    });

    if (!bookmark) {
      throw new NotFoundException(`Bookmark ${bookmarkId} nao encontrado`);
    }

    if (bookmark.idLocEscritu !== userId) {
      throw new ForbiddenException('Voce nao tem permissao para remover este bookmark');
    }

    await this.prisma.dVincula.update({
      where: { chave: bookmark.chave },
      data: { excluido: true },
    });

    this.logger.log(`bookmark removido: id=${bookmarkId} user=${userId}`);
  }
}
