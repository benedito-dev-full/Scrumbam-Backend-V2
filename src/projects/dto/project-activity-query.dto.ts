import { IsOptional, IsString, IsNumber, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * DTO para query de atividade do projeto (GET /projects/:id/activity).
 *
 * Cursor pagination por chave de DEvento.
 *
 * @example
 * ```typescript
 * const query: ProjectActivityQueryDto = {
 *   cursor: '500',
 *   limit: 20,
 * };
 * ```
 */
export class ProjectActivityQueryDto {
  @ApiPropertyOptional({
    description: 'Cursor para paginação (chave do último DEvento retornado)',
    example: '500',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Quantidade de itens por página (1-100, default: 20)',
    example: 20,
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}
