import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de query para `GET /projects`.
 *
 * Suporta cursor pagination + filtro opcional por team (ADR-V2-029).
 *
 * @example
 * ```typescript
 * // Lista padrão (todos os projetos do usuário, primeira página).
 * const q: ListProjectsQueryDto = {};
 *
 * // Filtra por time.
 * const q: ListProjectsQueryDto = { teamId: '200' };
 *
 * // Paginação.
 * const q: ListProjectsQueryDto = { cursor: '15', limit: 50 };
 * ```
 *
 * @see ADR-V2-029 — Project ↔ Team via DVincula -182
 */
export class ListProjectsQueryDto {
  /**
   * Cursor de paginação (chave do último item da página anterior).
   */
  @ApiPropertyOptional({
    description: 'Cursor de paginação (chave do último item da página anterior)',
    example: '15',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  /**
   * Quantidade de itens por página.
   * Mínimo: 1. Máximo: 100. Default: 20.
   */
  @ApiPropertyOptional({
    description: 'Itens por página (1..100)',
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
  limit?: number = 20;

  /**
   * Filtra projetos vinculados ao time (DVincula -182 PROJECT_TEAM_LINK).
   *
   * Quando ausente, retorna todos os projetos do usuário (incluindo órfãos
   * sem vínculo de time). Quando presente, retorna apenas projetos com
   * vínculo ativo ao time informado e dos quais o usuário é membro.
   *
   * @see ADR-V2-029
   */
  @ApiPropertyOptional({
    description:
      'Filtra projetos vinculados ao time (DVincula -182). Quando ausente, lista todos os do usuário.',
    example: '200',
  })
  @IsOptional()
  @IsString()
  teamId?: string;
}
