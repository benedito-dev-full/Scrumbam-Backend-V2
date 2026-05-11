import { IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para criação de task (DTask).
 *
 * Ao criar, o identifier DEV-N é gerado atomicamente via DTabela -475.
 * O estado inicial é sempre INBOX.
 *
 * @example
 * ```typescript
 * const dto: CreateTaskDto = {
 *   nome: 'Implementar autenticação JWT',
 *   projectId: '1',
 *   priority: 'HIGH',
 * };
 * ```
 */
export class CreateTaskDto {
  @ApiProperty({
    description: 'Nome/título da task',
    example: 'Implementar autenticação JWT',
    minLength: 3,
    maxLength: 512,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(512)
  nome!: string;

  @ApiProperty({
    description: 'ID do projeto (chave DProject)',
    example: '1',
  })
  @IsString()
  projectId!: string;

  @ApiPropertyOptional({
    description: 'Descrição detalhada da task',
    example: 'Implementar JWT com refresh token usando DUserGroup',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  descricao?: string;

  @ApiPropertyOptional({
    description: 'Prioridade da task',
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    example: 'MEDIUM',
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

  @ApiPropertyOptional({
    description: 'ID do sprint (chave DTabela -400)',
    example: '1',
  })
  @IsOptional()
  @IsString()
  sprintId?: string;

  @ApiPropertyOptional({
    description: 'Texto bruto da captura (Telegram, etc.)',
    example: 'via telegram',
  })
  @IsOptional()
  @IsString()
  rawText?: string;

  @ApiPropertyOptional({
    description: 'Fonte da captura',
    enum: ['telegram', 'web', 'api', 'mcp'],
    example: 'web',
  })
  @IsOptional()
  @IsEnum(['telegram', 'web', 'api', 'mcp'])
  source?: string;

  @ApiPropertyOptional({
    description: 'Tipo da task (persistido em dados.taskType; exposto no top-level do response)',
    enum: ['FEATURE', 'BUG', 'IMPROVEMENT', 'REVIEW', 'EXPLAIN'],
    example: 'BUG',
  })
  @IsOptional()
  @IsIn(['FEATURE', 'BUG', 'IMPROVEMENT', 'REVIEW', 'EXPLAIN'])
  taskType?: string;
}
