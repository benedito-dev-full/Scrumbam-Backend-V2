import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de resposta para geração de API Key (POST /auth/me/api-key).
 *
 * A `key` em texto plano é retornada APENAS nesta resposta.
 * O backend armazena somente o hash SHA-256 em DTabela(-471).
 *
 * @example
 * ```json
 * {
 *   "key": "sk_live_abcd1234...",
 *   "prefix": "sk_live_",
 *   "createdAt": "2026-05-08T10:00:00Z",
 *   "projectId": "10"
 * }
 * ```
 */
export class ApiKeyResponseDto {
  /**
   * API Key em texto plano — guardar com segurança, não recuperável.
   * Presente SOMENTE na resposta de geração (POST). Ausente na listagem.
   */
  @ApiPropertyOptional({ description: 'API Key em texto plano (apenas na criação)', example: 'sk_live_abcd1234...' })
  key?: string;

  /** Prefixo público da API Key (primeiros 8 chars). */
  @ApiProperty({ description: 'Prefixo público (8 chars)', example: 'sk_live_' })
  prefix!: string;

  /** Chave do registro DTabela da API Key. */
  @ApiProperty({ description: 'ID do registro da API Key', example: '100' })
  id!: string;

  /** Data de criação. */
  @ApiProperty({ description: 'Data de criação', example: '2026-05-08T10:00:00Z' })
  createdAt!: Date;

  /** ID do projeto vinculado à API Key. */
  @ApiPropertyOptional({ description: 'ID do projeto vinculado', example: '10' })
  projectId?: string;

  /** Última utilização (null se nunca usada). */
  @ApiPropertyOptional({ description: 'Último uso (null se nunca usada)', nullable: true })
  lastUsedAt?: Date | null;
}
