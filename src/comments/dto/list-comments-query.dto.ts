import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Query DTO da listagem de comentários.
 *
 * Cursor pagination DESC:
 * - `cursor`: chave do último item da página anterior (DEvento.chave).
 * - `limit`: 1–100 itens por página (default 20 aplicado no service).
 *
 * @example
 * ```typescript
 * // Primeira página
 * GET /comments/task/777
 *
 * // Página seguinte
 * GET /comments/task/777?cursor=12300&limit=50
 * ```
 */
export class ListCommentsQueryDto {
  /**
   * Cursor (chave do último item da página anterior).
   */
  @ApiPropertyOptional({
    description: 'Cursor para próxima página (chave do último item)',
    example: '12300',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  /**
   * Itens por página (default 20, min 1, max 100).
   *
   * `@Type(() => Number)` converte string da query string para number antes
   * do `@IsInt`. Sem isso, o validator reclamaria de "string is not int".
   */
  @ApiPropertyOptional({
    description: 'Quantidade de itens por página',
    example: 20,
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
