import { ApiProperty } from '@nestjs/swagger';
import { TabelaResponseDto } from './tabela-response.dto';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';

/**
 * DTO de resposta para listagem de tabelas (GET /tabelas).
 *
 * @example
 * ```json
 * {
 *   "items": [{ "chave": "1", "codigo": "INBOX", ... }],
 *   "pagination": { "hasMore": false, "nextCursor": null }
 * }
 * ```
 */
export class ListTabelaResponseDto {
  @ApiProperty({ description: 'Itens', type: [TabelaResponseDto] })
  items!: TabelaResponseDto[];

  @ApiProperty({ description: 'Paginação', type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}
