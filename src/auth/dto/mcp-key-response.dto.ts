import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de resposta para geração de MCP Key (POST /auth/me/mcp-key).
 *
 * A `key` em texto plano é retornada APENAS nesta resposta.
 * O backend armazena:
 * - Hash em DTabela(-472) com dEntidadeId = userId
 * - Hash duplicado em DUserGroup.dados.mcpKeyHash (latência mínima — ADR-V2-004 D4)
 *
 * @example
 * ```json
 * {
 *   "key": "mcp_abcd1234...",
 *   "prefix": "mcp_abcd",
 *   "userId": "2",
 *   "createdAt": "2026-05-08T10:00:00Z"
 * }
 * ```
 */
export class McpKeyResponseDto {
  /**
   * MCP Key em texto plano — guardar com segurança, não recuperável.
   * Presente SOMENTE na resposta de geração (POST).
   */
  @ApiPropertyOptional({ description: 'MCP Key em texto plano (apenas na criação)', example: 'mcp_abcd1234...' })
  key?: string;

  /** Prefixo público da MCP Key (primeiros 8 chars). */
  @ApiProperty({ description: 'Prefixo público (8 chars)', example: 'mcp_abcd' })
  prefix!: string;

  /** Chave do registro DTabela da MCP Key. */
  @ApiProperty({ description: 'ID do registro', example: '200' })
  id!: string;

  /** ID da DEntidade do usuário vinculado. */
  @ApiProperty({ description: 'ID do usuário vinculado (DEntidade)', example: '2' })
  userId!: string;

  /** Data de criação. */
  @ApiProperty({ description: 'Data de criação', example: '2026-05-08T10:00:00Z' })
  createdAt!: Date;
}
