import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean } from 'class-validator';

/**
 * DTO para atualização de tabela lookup/config (PATCH /tabelas/:id).
 *
 * Todos os campos são opcionais. `idClasse` é imutável (ausente do DTO).
 *
 * @example
 * ```json
 * { "nome": "Sprint 1 — Atualizado" }
 * ```
 */
export class UpdateTabelaDto {
  /** Novo nome. */
  @ApiPropertyOptional({ description: 'Nome', example: 'Sprint 1 Atualizado' })
  @IsOptional()
  @IsString()
  nome?: string;

  /** Novo código único. */
  @ApiPropertyOptional({ description: 'Código único', example: 'SPR-001-v2' })
  @IsOptional()
  @IsString()
  codigo?: string;

  /** Nova descrição. */
  @ApiPropertyOptional({ description: 'Descrição', example: 'Sprint atualizado' })
  @IsOptional()
  @IsString()
  descricao?: string;

  /** Inativar/reativar lookup. */
  @ApiPropertyOptional({ description: 'Inativo?', example: false })
  @IsOptional()
  @IsBoolean()
  inativo?: boolean;

  /** Dados polimórficos (Json). */
  @ApiPropertyOptional({ description: 'Dados adicionais (Json)', example: {} })
  @IsOptional()
  dados?: Record<string, unknown>;
}
