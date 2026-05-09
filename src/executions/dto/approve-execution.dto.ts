import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para aprovação de uma execution em awaiting_approval.
 *
 * O body é opcional — aprovação não requer campos obrigatórios.
 * Apenas notas opcionais do aprovador.
 */
export class ApproveExecutionDto {
  /**
   * Notas da aprovação (opcional).
   * Armazenadas em dados.approval como contexto da decisão.
   */
  @ApiPropertyOptional({
    description: 'Notas da aprovação (opcional)',
    example: 'Revisado e aprovado — mudanças seguras no módulo de testes',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
