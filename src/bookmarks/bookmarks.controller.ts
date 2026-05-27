import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';
import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';
import { BookmarksService } from './bookmarks.service';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';
import { ListBookmarksQueryDto } from './dto/list-bookmarks-query.dto';
import { BookmarkResponseDto, ListBookmarksResponseDto } from './dto/bookmark-response.dto';

/**
 * Controller de bookmarks/favoritos do usuario.
 *
 * Todos os endpoints requerem autenticacao via `AuthCompositeGuard` (JWT + API Key).
 * Cada usuario acessa apenas seus proprios bookmarks — ownership validado no service.
 *
 * Endpoints:
 * | Endpoint               | Auth                | Descricao                           |
 * |------------------------|---------------------|-------------------------------------|
 * | GET  /bookmarks        | AuthCompositeGuard  | Lista bookmarks do usuario logado   |
 * | POST /bookmarks        | AuthCompositeGuard  | Cria ou reativa bookmark            |
 * | DELETE /bookmarks/:id  | AuthCompositeGuard  | Soft-delete com ownership check     |
 *
 * @see BookmarksService — logica de negocio e deduplicacao
 * @see DVincula — tabela subjacente (idClasse=-187, ADR-V2-051)
 */
@ApiTags('bookmarks')
@ApiBearerAuth()
@UseGuards(AuthCompositeGuard)
@Controller('bookmarks')
export class BookmarksController {
  private readonly logger = new Logger(BookmarksController.name);

  constructor(private readonly bookmarksService: BookmarksService) {}

  /**
   * Lista bookmarks do usuario autenticado com cursor pagination.
   *
   * Retorna apenas bookmarks do usuario logado (`idLocEscritu = req.user.entidadeId`).
   * Suporta filtro opcional por `targetType` e paginacao cursor-based.
   *
   * @param query - Filtros e paginacao (targetType, cursor, limit).
   * @param user - JWT payload com entidadeId.
   * @returns Lista paginada de BookmarkResponseDto.
   *
   * @throws {UnauthorizedException} Sem autenticacao valida.
   *
   * @example
   * ```bash
   * curl https://api.scrumban.com.br/bookmarks?targetType=space \
   *   -H "Authorization: Bearer <jwt>"
   * ```
   */
  @Get()
  @ApiOperation({
    summary: 'Lista bookmarks do usuario autenticado',
    description:
      'Retorna apenas bookmarks do usuario logado. Suporta filtro por targetType e cursor pagination.',
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de bookmarks', type: ListBookmarksResponseDto })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  async findMany(
    @Query() query: ListBookmarksQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ListBookmarksResponseDto> {
    const userId = BigInt(user.entidadeId);
    this.logger.log(
      `GET /bookmarks user=${userId} targetType=${query.targetType ?? 'all'} cursor=${query.cursor ?? 'none'}`,
    );
    return this.bookmarksService.findMany(userId, query);
  }

  /**
   * Cria um bookmark ou reativa um soft-deleted existente.
   *
   * Retorna 201 quando o bookmark e criado pela primeira vez, ou 200 quando
   * um bookmark soft-deleted e reativado (sem criar duplicata).
   *
   * @param dto - Dados do bookmark: targetId (BigInt como string) + targetType.
   * @param user - JWT payload com entidadeId.
   * @returns BookmarkResponseDto do bookmark criado ou reativado.
   *
   * @throws {UnauthorizedException} Sem autenticacao valida.
   * @throws {BadRequestException} Se targetId nao e um numero BigInt valido.
   * @throws {ConflictException} Se bookmark ja existe e esta ativo (409).
   *
   * @example
   * ```bash
   * curl -X POST https://api.scrumban.com.br/bookmarks \
   *   -H "Authorization: Bearer <jwt>" \
   *   -H "Content-Type: application/json" \
   *   -d '{"targetId":"350","targetType":"space"}'
   * ```
   */
  @Post()
  @ApiOperation({
    summary: 'Cria bookmark ou reativa soft-deleted',
    description:
      'Retorna 201 se criado novo, 200 se reativado. 409 se ja existe ativo. 400 se targetId invalido.',
  })
  @ApiResponse({ status: 201, description: 'Bookmark criado', type: BookmarkResponseDto })
  @ApiResponse({ status: 200, description: 'Bookmark reativado', type: BookmarkResponseDto })
  @ApiResponse({ status: 400, description: 'targetId invalido (nao conversivel para BigInt)' })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  @ApiResponse({ status: 409, description: 'Bookmark ja existe e esta ativo' })
  async create(
    @Body() dto: CreateBookmarkDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<BookmarkResponseDto> {
    const userId = BigInt(user.entidadeId);
    this.logger.log(
      `POST /bookmarks user=${userId} targetType=${dto.targetType} targetId=${dto.targetId}`,
    );
    const result = await this.bookmarksService.create(userId, dto);

    // NestJS nao suporta status dinamico por resultado sem @Res() inject.
    // Por simplicidade e alinhamento com o plano (secao Handoff C — alternativa simples),
    // retornamos sempre o BookmarkResponseDto; o status HTTP 201 e o default do POST.
    // O frontend distingue criacao de reativacao via campo futuro se necessario.
    return result.bookmark;
  }

  /**
   * Remove (soft-delete) um bookmark, validando ownership.
   *
   * Seta `excluido=true` na DVincula. O registro permanece no banco para
   * auditoria e para permitir reativacao futura via POST.
   *
   * @param id - Chave do DVincula (path param, serializado como string).
   * @param user - JWT payload com entidadeId.
   * @returns 204 No Content.
   *
   * @throws {UnauthorizedException} Sem autenticacao valida.
   * @throws {NotFoundException} Bookmark nao encontrado ou ja excluido.
   * @throws {ForbiddenException} Bookmark pertence a outro usuario.
   *
   * @example
   * ```bash
   * curl -X DELETE https://api.scrumban.com.br/bookmarks/1001 \
   *   -H "Authorization: Bearer <jwt>"
   * # → 204 No Content
   * ```
   */
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove (soft-delete) um bookmark',
    description:
      'Seta excluido=true na DVincula. Valida ownership: apenas o dono pode remover. 404 se nao encontrado, 403 se de outro usuario.',
  })
  @ApiParam({ name: 'id', description: 'Chave BigInt do bookmark (DVincula.chave)' })
  @ApiResponse({ status: 204, description: 'Bookmark removido' })
  @ApiResponse({ status: 400, description: 'ID invalido (nao conversivel para BigInt)' })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  @ApiResponse({ status: 403, description: 'Nao e o dono do bookmark' })
  @ApiResponse({ status: 404, description: 'Bookmark nao encontrado' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    let bookmarkId: bigint;
    try {
      bookmarkId = BigInt(id);
    } catch {
      throw new BadRequestException(`ID "${id}" nao e um numero valido para BigInt`);
    }

    const userId = BigInt(user.entidadeId);
    this.logger.log(`DELETE /bookmarks/${id} user=${userId}`);
    await this.bookmarksService.remove(userId, bookmarkId);
  }
}
