import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumberString, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TARGET_TYPES, TargetType } from './create-bookmark.dto';

/**
 * Query params para listagem de bookmarks do usuario autenticado.
 *
 * Suporta cursor pagination e filtro opcional por tipo de entidade.
 *
 * @example
 * ```typescript
 * // GET /bookmarks?targetType=space&cursor=1000&limit=20
 * const query: ListBookmarksQueryDto = {
 *   targetType: 'space',
 *   cursor: '1000',
 *   limit: 20,
 * };
 * ```
 */
export class ListBookmarksQueryDto {
  /**
   * Filtrar por tipo de entidade favoritada.
   *
   * Quando ausente, retorna bookmarks de todos os tipos.
   */
  @ApiPropertyOptional({
    description: 'Filtrar por tipo de entidade favoritada',
    enum: TARGET_TYPES,
    example: 'space',
  })
  @IsOptional()
  @IsIn(TARGET_TYPES)
  targetType?: TargetType;

  /**
   * Cursor BigInt serializado como string para paginacao.
   *
   * A listagem retorna registros com `DVincula.chave` menor que este valor.
   */
  @ApiPropertyOptional({
    description: 'Cursor BigInt; retorna chave menor que o cursor',
    example: '1001',
  })
  @IsOptional()
  @IsNumberString()
  cursor?: string;

  /**
   * Quantidade maxima de itens retornados por pagina.
   *
   * Minimo 1, maximo 100, default 20 aplicado no service.
   */
  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
