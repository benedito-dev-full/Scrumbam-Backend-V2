import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para atualização parcial de task (PUT /tasks/:id).
 *
 * Não inclui atualização de status (use PUT /tasks/:id/status).
 * Não inclui atualização de sprint (use PUT /tasks/:id/sprint).
 *
 * @example
 * ```typescript
 * const dto: UpdateTaskDto = {
 *   nome: 'Novo título',
 *   descricao: 'Descrição atualizada',
 *   priority: 'HIGH',
 * };
 * ```
 */
export class UpdateTaskDto {
  @ApiPropertyOptional({
    description: 'Novo título da task',
    example: 'Implementar JWT com refresh token',
    minLength: 3,
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(512)
  nome?: string;

  @ApiPropertyOptional({
    description: 'Nova descrição',
    example: 'Detalhes da implementação...',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  descricao?: string;

  @ApiPropertyOptional({
    description: 'Nova prioridade',
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    example: 'HIGH',
  })
  @IsOptional()
  @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  priority?: string;

  @ApiPropertyOptional({
    description: 'ID do assignee (chave DEntidade)',
    example: '100',
  })
  @IsOptional()
  @IsString()
  assigneeId?: string;
}
