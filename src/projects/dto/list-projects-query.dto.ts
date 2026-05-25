import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de query para `GET /projects`.
 *
 * Suporta cursor pagination + filtro opcional por team (ADR-V2-029)
 * e filtro por `idClasse` para separar SPACEs (-350), FOLDERs (-351) e
 * LISTs (-352) conforme hierarquia ADR-V2-051.
 *
 * @example
 * ```typescript
 * // Lista apenas SPACEs (-350).
 * const q: ListProjectsQueryDto = { idClasse: '-350' };
 *
 * // Lista FOLDERs filhos de um SPACE específico.
 * const q: ListProjectsQueryDto = { idClasse: '-351', idPai: '100' };
 *
 * // Filtra por time.
 * const q: ListProjectsQueryDto = { teamId: '200' };
 *
 * // Paginação.
 * const q: ListProjectsQueryDto = { cursor: '15', limit: 50 };
 * ```
 *
 * @see ADR-V2-029 — Project ↔ Team via DVincula -182
 * @see ADR-V2-051 — Hierarquia Space/Folder/List
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

  /**
   * Filtra projetos pelo idClasse (ADR-V2-051 hierarquia Space/Folder/List).
   *
   * Valores esperados:
   * - `-350` → SPACE (raiz da hierarquia)
   * - `-351` → FOLDER (filho de SPACE)
   * - `-352` → LIST (filho de FOLDER — contém tasks)
   * - `-353` → DOC (filho de FOLDER)
   *
   * Quando ausente, retorna todos os projetos do usuário independente do tipo.
   */
  @ApiPropertyOptional({
    description:
      'Filtra por idClasse do DProject. Ex: -350=SPACE, -351=FOLDER, -352=LIST, -353=DOC.',
    example: '-350',
  })
  @IsOptional()
  @IsString()
  idClasse?: string;

  /**
   * Filtra projetos filhos de um DProject pai específico (ADR-V2-051).
   *
   * Permite listar FOLDERs de um SPACE ou LISTs de um FOLDER específico.
   * Usualmente combinado com `idClasse` para queries hierárquicas:
   *   - `GET /projects?idClasse=-351&idPai=100` → FOLDERs do SPACE 100
   *   - `GET /projects?idClasse=-352&idPai=200` → LISTs do FOLDER 200
   */
  @ApiPropertyOptional({
    description: 'Filtra projetos cujo DProject.idPai é igual a este valor.',
    example: '100',
  })
  @IsOptional()
  @IsString()
  idPai?: string;

  /**
   * Filtra projetos pelo campo `privado` do DProject (ADR-V2-051 §4).
   *
   * - `true` → apenas projetos marcados como privados
   * - `false` → apenas projetos públicos
   * - ausente → retorna ambos sem filtro de privacidade
   *
   * O controle de acesso via DVincula membership já impede que projetos de
   * outros usuários apareçam; este filtro é adicional para o cliente listar
   * apenas Spaces públicos ou apenas privados.
   *
   * @example `GET /projects?idClasse=-350&privado=false` → SPACEs públicos
   * @example `GET /projects?idClasse=-350&privado=true` → SPACEs privados
   */
  @ApiPropertyOptional({
    description:
      'Filtra DProjects pelo campo privado. true=apenas privados, false=apenas públicos. Ausente=sem filtro.',
    example: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  privado?: boolean;
}
