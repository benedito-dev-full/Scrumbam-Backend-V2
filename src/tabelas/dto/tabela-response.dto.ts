import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de resposta para DTabela (GET /tabelas, GET /tabelas/:id).
 *
 * BigInts serializados como string.
 *
 * @example
 * ```json
 * {
 *   "chave": "1",
 *   "idClasse": "-440",
 *   "codigo": "INBOX",
 *   "nome": "Inbox",
 *   "classe": { "codigo": "STATUS_INTENTION_V3", "nome": "Status Intention V3" }
 * }
 * ```
 */
export class TabelaResponseDto {
  @ApiProperty({ description: 'Chave primária (BigInt como string)', example: '1' })
  chave!: string;

  @ApiProperty({ description: 'ID da DClasse (BigInt como string)', example: '-440' })
  idClasse!: string;

  @ApiPropertyOptional({ description: 'Código único', example: 'INBOX' })
  codigo!: string | null;

  @ApiProperty({ description: 'Nome', example: 'Inbox' })
  nome!: string;

  @ApiPropertyOptional({ description: 'Descrição', example: 'Caixa de entrada' })
  descricao!: string | null;

  @ApiPropertyOptional({ description: 'ID da DEntidade dona (BigInt como string)', example: null, nullable: true })
  dEntidadeId!: string | null;

  @ApiPropertyOptional({ description: 'Dados adicionais (Json)', example: null })
  dados!: Record<string, unknown> | null;

  @ApiProperty({ description: 'Inativo?', example: false })
  inativo!: boolean;

  @ApiProperty({ description: 'Excluído?', example: false })
  excluido!: boolean;

  @ApiProperty({ description: 'Criado em', example: '2026-05-08T10:00:00.000Z' })
  criadoEm!: Date;

  @ApiProperty({ description: 'Atualizado em', example: '2026-05-08T10:00:00.000Z' })
  atualizadoEm!: Date;

  @ApiPropertyOptional({ description: 'DClasse embutida' })
  classe!: { codigo: string | null; nome: string } | null;
}
