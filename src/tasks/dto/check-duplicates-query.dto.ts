import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * DTO de query para `GET /tasks/check-duplicates` (task #799 / DEV-128).
 *
 * Usado pelo passo intermediário do modal de criação: dado o título proposto e
 * a lista-alvo, retorna possíveis duplicatas (ver {@link TaskDuplicateDto}).
 * Autorização idêntica ao `POST /tasks` — o controller valida
 * `projectId ∈ accessibleProjectIds` (404 anti-enumeration).
 *
 * @example
 * ```
 * GET /tasks/check-duplicates?nome=Corrigir%20login&projectId=352
 * GET /tasks/check-duplicates?nome=Rename&projectId=352&excludeTaskId=1234&limit=5
 * ```
 */
export class CheckDuplicatesQueryDto {
  /**
   * Título proposto para a nova task (base da busca tokenizada AND-flexível).
   */
  @ApiProperty({ description: 'Título proposto da nova task', example: 'Corrigir login OAuth' })
  @IsString()
  @IsNotEmpty()
  nome!: string;

  /**
   * ID da Lista-alvo (chave DProject). Escopo da checagem (decisão #2 — só a
   * mesma lista) e alvo da validação de acesso.
   */
  @ApiProperty({ description: 'ID da Lista-alvo (chave DProject)', example: '352' })
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  /**
   * ID da própria task a excluir da checagem (fluxo de edição/rename) — evita que
   * a task sugira a si mesma. Ausente no fluxo de criação.
   */
  @ApiPropertyOptional({
    description: 'ID da task a excluir da checagem (edição/rename)',
    example: '1234',
  })
  @IsOptional()
  @IsString()
  excludeTaskId?: string;

  /**
   * Máximo de candidatas a retornar. Default 5 (decisão #3), cap 20.
   */
  @ApiPropertyOptional({
    description: 'Máximo de candidatas (default 5, cap 20)',
    example: 5,
    minimum: 1,
    maximum: 20,
    default: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
