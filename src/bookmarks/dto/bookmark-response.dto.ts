import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO de resposta de um bookmark/favorito.
 *
 * Todos os campos BigInt sao serializados como string para compatibilidade JSON.
 *
 * @example
 * ```json
 * {
 *   "id": "1001",
 *   "targetId": "350",
 *   "targetType": "space",
 *   "criadoEm": "2026-05-27T14:30:00.000Z"
 * }
 * ```
 */
export class BookmarkResponseDto {
  /**
   * Chave do DVincula serializada como string.
   */
  @ApiProperty({ description: 'ID do bookmark (DVincula.chave)', example: '1001' })
  id!: string;

  /**
   * ID da entidade favoritada serializado como string.
   */
  @ApiProperty({ description: 'ID da entidade favoritada', example: '350' })
  targetId!: string;

  /**
   * Tipo da entidade favoritada.
   */
  @ApiProperty({
    description: 'Tipo da entidade favoritada',
    example: 'space',
    enum: ['space', 'folder', 'list', 'doc', 'team'],
  })
  targetType!: string;

  /**
   * Data de criacao do bookmark (ISO 8601).
   */
  @ApiProperty({ description: 'Data de criacao do bookmark (ISO 8601)', example: '2026-05-27T14:30:00.000Z' })
  criadoEm!: string;
}

/**
 * DTO de resposta de listagem de bookmarks com paginacao cursor-based.
 */
export class ListBookmarksResponseDto {
  @ApiProperty({ type: [BookmarkResponseDto] })
  items!: BookmarkResponseDto[];

  @ApiProperty({
    description: 'Metadados de paginacao',
    example: { hasMore: false, nextCursor: null },
  })
  pagination!: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}
