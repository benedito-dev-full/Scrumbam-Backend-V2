import {
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
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
    description: 'Nova prioridade — alinhada com seed canônico DTabela -421..-424 (V2)',
    enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
    example: 'HIGH',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((o: UpdateTaskDto) => o.priority !== null)
  @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: string | null;

  @ApiPropertyOptional({
    description: 'ID do assignee (chave DEntidade)',
    example: '100',
  })
  @IsOptional()
  @IsString()
  assigneeId?: string;

  @ApiPropertyOptional({
    description: 'Tipo da task (merge superficial em dados.taskType, preservando demais chaves)',
    enum: ['FEATURE', 'BUG', 'IMPROVEMENT', 'REVIEW', 'EXPLAIN'],
    example: 'FEATURE',
  })
  @IsOptional()
  @IsIn(['FEATURE', 'BUG', 'IMPROVEMENT', 'REVIEW', 'EXPLAIN'])
  taskType?: string;

  @ApiPropertyOptional({
    description:
      'Mover task na hierarquia de fases (ADR-V2-047). ' +
      'string=novo pai; null=move para raiz; ausente=nao toca.',
    example: '5',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((o: UpdateTaskDto) => o.idPai !== null)
  @IsString()
  idPai?: string | null;

  @ApiPropertyOptional({
    description:
      'Data limite da task (due date) no formato ISO 8601. ' +
      'string=nova data; null=remove a data; ausente=não toca. ' +
      'Exemplo: "2026-06-30" ou "2026-06-30T23:59:59.000Z".',
    example: '2026-06-30',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((o: UpdateTaskDto) => o.dueDate !== null)
  @IsISO8601()
  dueDate?: string | null;
}
