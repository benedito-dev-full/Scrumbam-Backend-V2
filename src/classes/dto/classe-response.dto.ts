import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de resposta para DClasse (flat — sem filhos).
 *
 * BigInts (chave, idPai) serializados como string.
 *
 * @example
 * ```json
 * {
 *   "chave": "-154",
 *   "codigo": "SCRUMBAN_TASK",
 *   "nome": "Task Scrumban",
 *   "idPai": "-37",
 *   "agrupamento": false
 * }
 * ```
 */
export class ClasseResponseDto {
  @ApiProperty({ description: 'Chave (BigInt como string)', example: '-154' })
  chave!: string;

  @ApiPropertyOptional({ description: 'Código textual', example: 'SCRUMBAN_TASK' })
  codigo!: string | null;

  @ApiProperty({ description: 'Nome descritivo', example: 'Task Scrumban' })
  nome!: string;

  @ApiPropertyOptional({ description: 'ID da DClasse pai (BigInt como string)', example: '-37', nullable: true })
  idPai!: string | null;

  @ApiProperty({ description: 'É agrupador (nó intermediário)?', example: false })
  agrupamento!: boolean;

  @ApiProperty({ description: 'Inativo?', example: false })
  inativo!: boolean;

  @ApiProperty({ description: 'Excluído?', example: false })
  excluido!: boolean;

  @ApiProperty({ description: 'Excluível?', example: true })
  excluivel!: boolean;

  @ApiProperty({ description: 'Editável?', example: true })
  editavel!: boolean;

  @ApiPropertyOptional({ description: 'Campos dinâmicos (tableFields)', example: null })
  tableFields!: unknown;
}

/**
 * DTO de resposta para DClasse em formato de árvore (com filhos aninhados).
 *
 * Usado pelo endpoint GET /classes/tree.
 *
 * @example
 * ```json
 * {
 *   "chave": "-1",
 *   "nome": "Root",
 *   "filhos": [
 *     { "chave": "-2", "nome": "Movimentações", "filhos": [...] }
 *   ]
 * }
 * ```
 */
export class ClasseTreeDto {
  @ApiProperty({ description: 'Chave (BigInt como string)', example: '-1' })
  chave!: string;

  @ApiPropertyOptional({ description: 'Código textual', example: 'ROOT' })
  codigo!: string | null;

  @ApiProperty({ description: 'Nome descritivo', example: 'Root' })
  nome!: string;

  @ApiPropertyOptional({ description: 'ID da DClasse pai', example: null, nullable: true })
  idPai!: string | null;

  @ApiProperty({ description: 'É agrupador?', example: true })
  agrupamento!: boolean;

  @ApiProperty({ description: 'Filhos aninhados', type: () => [ClasseTreeDto] })
  filhos!: ClasseTreeDto[];
}
