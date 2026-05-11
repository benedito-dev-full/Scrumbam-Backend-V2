import { IsArray, IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * DTO para query de listagem de tasks (GET /tasks).
 *
 * Suporta filtros por projectId, status, assignee e sprint.
 * Cursor pagination decrescente por chave.
 *
 * @example
 * ```typescript
 * const query: ListTasksQueryDto = {
 *   projectId: '1',
 *   status: 'INBOX',
 *   limit: 20,
 * };
 * ```
 */
export class ListTasksQueryDto {
  @ApiPropertyOptional({ description: 'Filtrar por projeto (chave DProject)', example: '1' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por status V3',
    enum: [
      'INBOX',
      'READY',
      'EXECUTING',
      'DONE',
      'FAILED',
      'CANCELLED',
      'DISCARDED',
      'VALIDATING',
      'VALIDATED',
    ],
    example: 'INBOX',
  })
  @IsOptional()
  @IsEnum([
    'INBOX',
    'READY',
    'EXECUTING',
    'DONE',
    'FAILED',
    'CANCELLED',
    'DISCARDED',
    'VALIDATING',
    'VALIDATED',
  ])
  status?: string;

  /**
   * Filtro interno para callers de service que precisam buscar mais de um status.
   * O controller HTTP continua expondo `status` como contrato publico simples.
   *
   * @IsOptional+@IsArray pra evitar 400 do ValidationPipe (forbidNonWhitelisted)
   * quando o TS materializa o campo como `undefined` na instancia do DTO.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  statuses?: string[];

  /**
   * Filtro interno para callers de service que precisam limitar a listagem a
   * varios projetos ja autorizados. O controller HTTP continua expondo apenas
   * `projectId` como contrato publico simples.
   *
   * Mesmo motivo: anotacoes para nao quebrar a whitelist do ValidationPipe.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  projectIds?: string[];

  @ApiPropertyOptional({ description: 'Filtrar por assignee (chave DEntidade)', example: '100' })
  @IsOptional()
  @IsString()
  assigneeId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por sprint (chave DTabela -400)', example: '1' })
  @IsOptional()
  @IsString()
  sprintId?: string;

  @ApiPropertyOptional({
    description: 'Cursor para paginação (chave da última task)',
    example: '100',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Itens por página (1-100, default: 20)',
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
