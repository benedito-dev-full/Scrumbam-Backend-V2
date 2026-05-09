import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de resposta para DClasse embutida no response de entidade.
 */
export class ClasseEmbeddedDto {
  /** Código textual da DClasse (ex: 'USER', 'ORG', 'TEAM'). */
  @ApiPropertyOptional({ description: 'Código da DClasse', example: 'USER' })
  codigo!: string | null;

  /** Nome legível da DClasse (ex: 'Usuário', 'Organização'). */
  @ApiProperty({ description: 'Nome da DClasse', example: 'Usuário' })
  nome!: string;
}

/**
 * DTO de resposta para DEntidade (GET /entidades, GET /entidades/:id).
 *
 * Todos os campos BigInt são serializados como string para compatibilidade
 * com JSON (JSON.stringify nativo não suporta BigInt).
 *
 * @example
 * ```json
 * {
 *   "chave": "150",
 *   "idClasse": "-150",
 *   "nome": "João Silva",
 *   "email": "joao@empresa.com",
 *   "classe": { "codigo": "USER", "nome": "Usuário" },
 *   "inativo": false,
 *   "excluido": false,
 *   "criadoEm": "2026-05-08T10:00:00.000Z"
 * }
 * ```
 */
export class EntidadeResponseDto {
  /** Chave primária da entidade (BigInt serializado como string). */
  @ApiProperty({ description: 'Chave primária (BigInt como string)', example: '150' })
  chave!: string;

  /** ID da DClasse (BigInt serializado como string). */
  @ApiProperty({ description: 'ID da DClasse (BigInt como string)', example: '-150' })
  idClasse!: string;

  /** Código único da entidade. */
  @ApiPropertyOptional({ description: 'Código único', example: 'USR-001' })
  codigo!: string | null;

  /** Nome da entidade. */
  @ApiProperty({ description: 'Nome', example: 'João Silva' })
  nome!: string;

  /** Nome fantasia (quando aplicável). */
  @ApiPropertyOptional({ description: 'Nome fantasia', example: 'João Dev' })
  nomeFantasia!: string | null;

  /** Email. */
  @ApiPropertyOptional({ description: 'Email', example: 'joao@empresa.com' })
  email!: string | null;

  /** CPF ou CNPJ. */
  @ApiPropertyOptional({ description: 'CPF ou CNPJ', example: '12345678000190' })
  cpfCnpj!: string | null;

  /** Telefone fixo. */
  @ApiPropertyOptional({ description: 'Telefone', example: '(11) 3000-0000' })
  telefone!: string | null;

  /** Celular / WhatsApp. */
  @ApiPropertyOptional({ description: 'Celular', example: '(11) 99000-0000' })
  celular!: string | null;

  /** ID da entidade pai (BigInt como string), se houver. */
  @ApiPropertyOptional({ description: 'ID da entidade pai (BigInt como string)', example: '100' })
  idEstab!: string | null;

  /** ID do local de escrituração (BigInt como string), se houver. */
  @ApiPropertyOptional({ description: 'ID do local de escrituração (BigInt como string)', example: '50' })
  idLocEscritu!: string | null;

  /** Dados polimórficos específicos do tipo. */
  @ApiPropertyOptional({ description: 'Dados adicionais (Json)', example: null })
  dados!: Record<string, unknown> | null;

  /** Flag de inativação. */
  @ApiProperty({ description: 'Entidade inativa?', example: false })
  inativo!: boolean;

  /** Flag de exclusão lógica. */
  @ApiProperty({ description: 'Entidade excluída?', example: false })
  excluido!: boolean;

  /** Data de criação (ISO 8601). */
  @ApiProperty({ description: 'Data de criação', example: '2026-05-08T10:00:00.000Z' })
  criadoEm!: Date;

  /** Data da última atualização (ISO 8601). */
  @ApiProperty({ description: 'Data de atualização', example: '2026-05-08T10:00:00.000Z' })
  atualizadoEm!: Date;

  /** Dados da DClasse embutidos (inclui codigo e nome). */
  @ApiPropertyOptional({ description: 'DClasse embutida', type: ClasseEmbeddedDto })
  classe!: ClasseEmbeddedDto | null;
}
