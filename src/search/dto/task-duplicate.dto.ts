import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Tipo de correspondência de uma possível duplicata.
 *
 * - `exact`: o título da candidata é igual (case-insensitive, trim) ao título proposto.
 * - `similar`: os tokens do título proposto aparecem no título da candidata (busca
 *   tokenizada AND-flexível — #791), mas não é idêntico.
 */
export type DuplicateMatchType = 'exact' | 'similar';

/**
 * Resultado de detecção de possível duplicata de task (task #799 / DEV-128).
 *
 * Contrato compartilhado pelos dois consumidores da detecção:
 * - HTTP `GET /tasks/check-duplicates` (passo intermediário do modal de criação).
 * - MCP `create_task` (campo `possibleDuplicates[]` anexado ao retorno).
 *
 * Comportamento SEMPRE informativo — nunca bloqueia a criação. `chave`/`idProject`/
 * `idStatus` são BigInt serializados como string (ADR-V2-025).
 *
 * @example
 * ```json
 * {
 *   "chave": "1234",
 *   "identifier": "DEV-87",
 *   "nome": "Corrigir login OAuth",
 *   "idProject": "352",
 *   "projectNome": "Backend Core",
 *   "idStatus": "-443",
 *   "matchType": "exact",
 *   "criadoEm": "2026-07-05T12:00:00.000Z"
 * }
 * ```
 */
export class TaskDuplicateDto {
  /**
   * Chave primária da DTask candidata (BigInt serializado como string).
   */
  @ApiProperty({ description: 'ID da task candidata', example: '1234' })
  chave!: string;

  /**
   * Identifier legível (`dados.identifier`, ex: DEV-87) ou null quando ausente.
   */
  @ApiPropertyOptional({
    description: 'Identifier legível da task (dados.identifier)',
    example: 'DEV-87',
    nullable: true,
  })
  identifier!: string | null;

  /**
   * Nome (título) completo da task candidata.
   */
  @ApiProperty({ description: 'Título da task candidata', example: 'Corrigir login OAuth' })
  nome!: string;

  /**
   * ID do projeto (Lista) da candidata (BigInt serializado como string).
   */
  @ApiPropertyOptional({
    description: 'ID do projeto (Lista) da candidata',
    example: '352',
    nullable: true,
  })
  idProject!: string | null;

  /**
   * Nome do projeto (Lista) da candidata, para exibição.
   */
  @ApiPropertyOptional({
    description: 'Nome do projeto (Lista) da candidata',
    example: 'Backend Core',
    nullable: true,
  })
  projectNome!: string | null;

  /**
   * ID do status atual da candidata (DTabela -44X) ou null. Permite à UI exibir
   * se a task já está concluída/arquivada (decisão #4 — incluir DONE na checagem).
   */
  @ApiPropertyOptional({
    description: 'ID do status atual da candidata (DTabela -44X)',
    example: '-443',
    nullable: true,
  })
  idStatus!: string | null;

  /**
   * Tipo de correspondência: `exact` (título idêntico) ou `similar` (tokens batem).
   * Resultados `exact` vêm sempre primeiro na lista.
   */
  @ApiProperty({
    description: 'Tipo de correspondência (exact vem primeiro)',
    enum: ['exact', 'similar'],
    example: 'exact',
  })
  matchType!: DuplicateMatchType;

  /**
   * Data de criação da candidata (ISO 8601).
   */
  @ApiProperty({ description: 'Data de criação da candidata', example: '2026-07-05T12:00:00.000Z' })
  criadoEm!: string;
}
