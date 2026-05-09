import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsNumberString,
  Min,
  Max,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO para query de listagem de entidades por classe (GET /entidades).
 *
 * Implementa a convenção ADR-V2-015:
 * - `idClasse` (canônico V2): aceito diretamente
 * - `classe` (alias deprecated): aceito por 2 sprints com header Deprecation
 *
 * Regras de validação:
 * - Pelo menos um de `idClasse` ou `classe` deve estar presente
 * - Não é permitido enviar ambos simultaneamente (400)
 * - `pageSize` padrão: 20, máximo: 100
 * - `cursor`: ID (chave) do último item da página anterior para cursor pagination
 *
 * @example
 * ```typescript
 * // Query canônica V2
 * GET /entidades?idClasse=-150&pageSize=20
 *
 * // Query deprecated (ainda aceita, com header Deprecation)
 * GET /entidades?classe=USER&pageSize=20
 *
 * // Com filtros
 * GET /entidades?idClasse=-150&nome=João&idEstab=100&cursor=999
 * ```
 */
export class ListEntidadeQueryDto {
  /**
   * ID da DClasse para filtrar (canônico V2, ADR-V2-015).
   * Exemplo: -150 (USER), -152 (ORGANIZATION), -180 (TEAM), -156 (AGENT).
   */
  @ApiPropertyOptional({
    description: 'ID da DClasse para filtrar (canônico V2). Ex: -150 (USER), -152 (ORG)',
    example: '-150',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'idClasse deve ser um número inteiro (ex: -150)' })
  idClasse?: string;

  /**
   * Alias deprecated para `idClasse` por nome de código (ADR-V2-015).
   * Aceito por 2 sprints — use `idClasse` em código novo.
   * Retorna header `Deprecation: true` e `Sunset: <ISO date>`.
   */
  @ApiPropertyOptional({
    description: '[DEPRECATED] Nome do código da DClasse. Use idClasse=-N. Ex: USER, ORG, TEAM',
    example: 'USER',
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  classe?: string;

  /**
   * Filtro por nome (busca parcial, case-insensitive).
   */
  @ApiPropertyOptional({
    description: 'Filtro por nome (busca parcial, case-insensitive)',
    example: 'João',
  })
  @IsOptional()
  @IsString()
  nome?: string;

  /**
   * Filtro por código único da entidade.
   */
  @ApiPropertyOptional({
    description: 'Filtro por código único',
    example: 'USR-001',
  })
  @IsOptional()
  @IsString()
  codigo?: string;

  /**
   * Filtro por entidade pai (hierarquia idEstab).
   * Permite listar filhos de uma organização ou marketplace.
   */
  @ApiPropertyOptional({
    description: 'Filtro por entidade pai (chave de DEntidade)',
    example: '100',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'idEstab deve ser um número inteiro' })
  idEstab?: string;

  /**
   * Cursor para paginação (chave da última entidade da página anterior).
   * Omitir para obter a primeira página.
   */
  @ApiPropertyOptional({
    description: 'Cursor para paginação (chave da última entidade retornada)',
    example: '999',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'cursor deve ser um número inteiro' })
  cursor?: string;

  /**
   * Número de itens por página (padrão: 20, máximo: 100).
   */
  @ApiPropertyOptional({
    description: 'Itens por página',
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
  pageSize?: number = 20;
}
