import {
  IsString,
  IsOptional,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * DTO para query de listagem de executions com cursor pagination.
 *
 * Validações:
 * - projectId: string obrigatória (BigInt como string)
 * - status: enum opcional dos status de aprovação
 * - riskLevel: enum opcional LOW|MEDIUM|HIGH
 * - cursor: string opcional (chave do último item da página anterior)
 * - limit: inteiro entre 1 e 100 (default: 20)
 */
export class ListExecutionsQueryDto {
  /**
   * ID do projeto (DProject.chave como string).
   * Obrigatório — listagem sempre filtrada por projeto.
   */
  @ApiProperty({
    description: 'ID do projeto (BigInt como string)',
    example: '123',
  })
  @IsString()
  projectId!: string;

  /**
   * Filtro por status de aprovação.
   */
  @ApiPropertyOptional({
    description: 'Filtro por status de aprovação',
    enum: ['queued', 'awaiting_approval', 'approved', 'rejected', 'expired'],
    example: 'awaiting_approval',
  })
  @IsOptional()
  @IsString()
  @IsIn(['queued', 'awaiting_approval', 'approved', 'rejected', 'expired'])
  status?: string;

  /**
   * Filtro por nível de risco (derivado de idClasse).
   */
  @ApiPropertyOptional({
    description: 'Filtro por nível de risco',
    enum: ['LOW', 'MEDIUM', 'HIGH'],
    example: 'HIGH',
  })
  @IsOptional()
  @IsString()
  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  riskLevel?: string;

  /**
   * Cursor para paginação (chave do último item da página anterior).
   * Se omitido, retorna a primeira página.
   */
  @ApiPropertyOptional({
    description: 'Cursor para paginação (chave do último item)',
    example: '456',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  /**
   * Quantidade de itens por página.
   * Mínimo: 1, Máximo: 100, Default: 20.
   */
  @ApiPropertyOptional({
    description: 'Quantidade de itens por página (default: 20)',
    example: 20,
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}
