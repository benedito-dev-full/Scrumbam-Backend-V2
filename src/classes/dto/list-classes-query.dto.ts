import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsBoolean,
  IsNumberString,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO para query de listagem de classes (GET /classes).
 *
 * Todos os filtros são opcionais — sem `idClasse` obrigatório, pois
 * as DClasses são lidas pelo seed e a listagem completa é válida.
 *
 * @example
 * ```
 * GET /classes                        → todas as classes ativas
 * GET /classes?nome=Sprint            → busca por nome
 * GET /classes?codigo=SPRINT          → busca por código exato
 * GET /classes?idPai=-51             → filhos diretos de Tabelas (-51)
 * GET /classes?all=true               → inclui inativas e excluídas
 * GET /classes?search=true&nome=user  → modo busca com relevância
 * ```
 */
export class ListClassesQueryDto {
  /**
   * Filtro por nome (busca parcial, case-insensitive).
   */
  @ApiPropertyOptional({
    description: 'Filtro por nome (parcial)',
    example: 'Sprint',
  })
  @IsOptional()
  @IsString()
  nome?: string;

  /**
   * Filtro por código exato (case-insensitive).
   */
  @ApiPropertyOptional({
    description: 'Filtro por código (ex: SPRINT, USER)',
    example: 'SPRINT',
  })
  @IsOptional()
  @IsString()
  codigo?: string;

  /**
   * Filtro por DClasse pai (retorna apenas filhos diretos).
   */
  @ApiPropertyOptional({
    description: 'Filtro por ID da DClasse pai (filhos diretos)',
    example: '-51',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'idPai deve ser um número inteiro' })
  idPai?: string;

  /**
   * Incluir DClasses inativas e excluídas (padrão: false).
   * Quando false, retorna apenas ativas (inativo=false, excluido=false).
   */
  @ApiPropertyOptional({
    description: 'Incluir inativas e excluídas (padrão: false)',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  all?: boolean = false;

  /**
   * Modo busca — ordena por relevância (quando nome ou codigo presente).
   */
  @ApiPropertyOptional({
    description: 'Modo busca (ordena por relevância)',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  search?: boolean = false;
}
