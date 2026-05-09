import { ApiProperty } from '@nestjs/swagger';
import { EntidadeResponseDto } from './entidade-response.dto';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';

// Re-export for backward compatibility
export { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';

/**
 * DTO de resposta para listagem de entidades (GET /entidades).
 *
 * Usa cursor pagination para escalabilidade.
 *
 * @example
 * ```json
 * {
 *   "items": [{ "chave": "150", "nome": "João", "idClasse": "-150" }],
 *   "pagination": { "hasMore": false, "nextCursor": null }
 * }
 * ```
 */
export class ListEntidadeResponseDto {
  /** Lista de entidades da página atual. */
  @ApiProperty({ description: 'Entidades', type: [EntidadeResponseDto] })
  items!: EntidadeResponseDto[];

  /** Metadados de paginação. */
  @ApiProperty({ description: 'Paginação', type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}
