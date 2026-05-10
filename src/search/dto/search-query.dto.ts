import {
  IsString,
  IsOptional,
  IsNumber,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * DTO de query para o endpoint GET /search.
 *
 * Busca cross-entity (DTask + DProject + DEntidade USER) no workspace
 * da organização autenticada. Suporta cursor pagination independente
 * por categoria de resultado.
 *
 * Validações aplicadas via class-validator:
 * - q: string obrigatório, mín 2 chars, máx 100 chars (evita full-table-scan em ILIKE '%a%')
 * - projectId: string opcional — filtra tasks por projeto específico
 * - limit: number 1–50 (default 20) — distribuído: 50% tasks, 30% projects, 20% people
 * - taskCursor: string opcional — cursor para próxima página de tasks
 * - projectCursor: string opcional — cursor para próxima página de projetos
 * - peopleCursor: string opcional — cursor para próxima página de pessoas
 *
 * @example
 * ```typescript
 * // Busca básica
 * const dto: SearchQueryDto = { q: 'login' };
 *
 * // Busca com paginação (segunda página de tasks)
 * const dto: SearchQueryDto = { q: 'auth', taskCursor: '523' };
 *
 * // Busca filtrada por projeto
 * const dto: SearchQueryDto = { q: 'bug', projectId: '42', limit: 10 };
 * ```
 */
export class SearchQueryDto {
  /**
   * Termo de busca (mínimo 2 caracteres).
   *
   * Aplicado via ILIKE cross-field:
   * - DTask: nome + descricao
   * - DProject: nome
   * - DEntidade USER: nome + email
   */
  @ApiProperty({
    description: 'Termo de busca (mín 2 chars, máx 100 chars)',
    example: 'login',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;

  /**
   * Filtrar tasks por projeto específico (opcional).
   *
   * Se informado, restringe resultados de tasks ao projeto indicado.
   * Projetos e pessoas não são filtrados por este campo.
   */
  @ApiPropertyOptional({
    description: 'Filtrar tasks por projeto específico (ID do DProject)',
    example: '42',
  })
  @IsOptional()
  @IsString()
  projectId?: string;

  /**
   * Limite total de resultados por request (default 20, máx 50).
   *
   * Distribuição fixa por categoria (DA-4):
   * - Tasks: ceil(limit * 0.5) — mínimo 1
   * - Projects: ceil(limit * 0.3) — mínimo 1
   * - People: ceil(limit * 0.2) — mínimo 1
   */
  @ApiPropertyOptional({
    description: 'Limite total de resultados (default 20, máx 50)',
    minimum: 1,
    maximum: 50,
    default: 20,
    example: 20,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number = 20;

  /**
   * Cursor de paginação para tasks.
   *
   * Valor: chave (BigInt serializado como string) da última task retornada.
   * Omitir para primeira página.
   */
  @ApiPropertyOptional({
    description: 'Cursor de paginação para tasks (chave da última task retornada)',
    example: '523',
  })
  @IsOptional()
  @IsString()
  taskCursor?: string;

  /**
   * Cursor de paginação para projetos.
   *
   * Valor: chave (BigInt serializado como string) do último projeto retornado.
   */
  @ApiPropertyOptional({
    description: 'Cursor de paginação para projetos (chave do último projeto retornado)',
    example: '41',
  })
  @IsOptional()
  @IsString()
  projectCursor?: string;

  /**
   * Cursor de paginação para pessoas.
   *
   * Valor: chave (BigInt serializado como string) da última pessoa retornada.
   */
  @ApiPropertyOptional({
    description: 'Cursor de paginação para pessoas (chave da última pessoa retornada)',
    example: '15',
  })
  @IsOptional()
  @IsString()
  peopleCursor?: string;
}
