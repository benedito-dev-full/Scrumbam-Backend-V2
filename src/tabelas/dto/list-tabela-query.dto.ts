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
 * DTO para query de listagem de tabelas por classe (GET /tabelas).
 *
 * Implementa a convenção ADR-V2-015 (análogo ao ListEntidadeQueryDto):
 * - `idClasse` (canônico V2)
 * - `classe` (alias deprecated, aceito por 2 sprints)
 *
 * O campo `dEntidadeId` permite filtrar configurações de uma entidade específica.
 * Ex: webhooks de um projeto específico, API keys de uma organização.
 *
 * @example
 * ```
 * GET /tabelas?idClasse=-440              → todos os Statuses V3
 * GET /tabelas?idClasse=-470&dEntidadeId=100  → webhooks do projeto 100
 * GET /tabelas?classe=SPRINT_STATUS       → alias deprecated
 * ```
 */
export class ListTabelaQueryDto {
  /**
   * ID da DClasse para filtrar (canônico V2, ADR-V2-015).
   * Ex: -440 (Status V3), -400 (Sprints), -420 (Priorities), -470 (Webhooks).
   */
  @ApiPropertyOptional({
    description: 'ID da DClasse (canônico V2). Ex: -440 (Status V3), -400 (Sprint)',
    example: '-440',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'idClasse deve ser um número inteiro' })
  idClasse?: string;

  /**
   * Alias deprecated para `idClasse` por código (ADR-V2-015).
   * Use `idClasse` em código novo.
   */
  @ApiPropertyOptional({
    description: '[DEPRECATED] Código da DClasse. Use idClasse. Ex: STATUS_INTENTION_V3',
    example: 'STATUS_INTENTION_V3',
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  classe?: string;

  /**
   * Filtro por nome (busca parcial, case-insensitive).
   */
  @ApiPropertyOptional({
    description: 'Filtro por nome (parcial)',
    example: 'INBOX',
  })
  @IsOptional()
  @IsString()
  nome?: string;

  /**
   * Filtro por código único.
   */
  @ApiPropertyOptional({
    description: 'Filtro por código',
    example: 'INBOX',
  })
  @IsOptional()
  @IsString()
  codigo?: string;

  /**
   * Filtro por entidade dona (ex: configurações de um projeto/org específico).
   * Quando ausente, retorna registros globais (dEntidadeId IS NULL).
   * Quando presente, retorna registros vinculados à entidade.
   */
  @ApiPropertyOptional({
    description: 'Filtro por entidade dona (chave de DEntidade)',
    example: '100',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'dEntidadeId deve ser um número inteiro' })
  dEntidadeId?: string;

  /**
   * Cursor para paginação.
   */
  @ApiPropertyOptional({
    description: 'Cursor para paginação (chave da última tabela retornada)',
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
