import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Metadados de paginação por cursor (compartilhado entre entidades e tabelas).
 *
 * Usado em ListEntidadeResponseDto, ListTabelaResponseDto e futuramente
 * em todos os endpoints com cursor pagination do V2.
 *
 * @example
 * ```json
 * { "hasMore": true, "nextCursor": "999", "total": 150 }
 * ```
 */
export class PaginationMetaDto {
  /** Indica se há mais itens após o cursor atual. */
  @ApiProperty({ description: 'Há mais itens?', example: true })
  hasMore!: boolean;

  /** Cursor para a próxima página (null quando não há mais itens). */
  @ApiProperty({ description: 'Cursor para próxima página (null se fim)', example: '999', nullable: true })
  nextCursor!: string | null;

  /** Total aproximado de itens (opcional). */
  @ApiPropertyOptional({ description: 'Total de itens (aproximado)', example: 150 })
  total?: number;
}
