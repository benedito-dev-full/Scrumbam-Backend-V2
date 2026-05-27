import { ApiProperty } from '@nestjs/swagger';
import { CommentResponseDto } from './comment-response.dto';

/**
 * Response DTO da listagem paginada de comentários (cursor pagination DESC).
 *
 * - `items`: até `limit` comentários do alvo, ordem DESC por `chave`.
 * - `nextCursor`: chave do último item retornado (passar em `?cursor=`
 *   para próxima página). `null` quando não há mais páginas.
 *
 * @example
 * ```json
 * {
 *   "items": [
 *     { "id": "12345", "texto": "...", "targetType": "task", ... }
 *   ],
 *   "nextCursor": "12300"
 * }
 * ```
 */
export class ListCommentsResponseDto {
  @ApiProperty({
    description: 'Lista de comentários (ordem DESC por id)',
    type: [CommentResponseDto],
  })
  items!: CommentResponseDto[];

  @ApiProperty({
    description: 'Cursor para próxima página (chave do último item) ou null',
    example: '12300',
    nullable: true,
    type: String,
  })
  nextCursor!: string | null;
}
