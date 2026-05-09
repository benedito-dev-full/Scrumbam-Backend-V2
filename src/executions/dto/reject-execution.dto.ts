import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para rejeição de uma execution em awaiting_approval.
 *
 * O campo reason é obrigatório — rejeições sem justificativa
 * não são aceitas para garantir rastreabilidade.
 */
export class RejectExecutionDto {
  /**
   * Motivo da rejeição (obrigatório).
   * Mínimo 10 caracteres para garantir justificativa real.
   * Persistido em dados.approval.rejectedReason.
   */
  @ApiProperty({
    description: 'Motivo da rejeição (obrigatório)',
    example: 'Comando envolve operação irreversível no banco de dados de produção',
    minLength: 10,
    maxLength: 1000,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}
