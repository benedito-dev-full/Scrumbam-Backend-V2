import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response DTO para lead time de um projeto.
 *
 * Lead time = tempo entre INBOX (criadoEm) e DONE/VALIDATED (em horas).
 * Calculado sobre tasks com `dados.telemetry.leadTime` preenchido.
 *
 * Unidade: horas (não dias) para maior granularidade.
 * `samples` reflete apenas tasks com telemetria disponível.
 *
 * @example
 * ```json
 * {
 *   "p50": 24.0,
 *   "p75": 48.5,
 *   "p90": 96.0,
 *   "avg": 32.4,
 *   "samples": 38,
 *   "unit": "hours"
 * }
 * ```
 */
export class LeadTimeResponseDto {
  /**
   * 50º percentil (mediana) do lead time em horas.
   */
  @ApiPropertyOptional({ description: 'Mediana do lead time (horas)', example: 24.0, nullable: true })
  p50!: number | null;

  /**
   * 75º percentil do lead time em horas.
   */
  @ApiPropertyOptional({ description: '75º percentil do lead time (horas)', example: 48.5, nullable: true })
  p75!: number | null;

  /**
   * 90º percentil do lead time em horas.
   */
  @ApiPropertyOptional({ description: '90º percentil do lead time (horas)', example: 96.0, nullable: true })
  p90!: number | null;

  /**
   * Média aritmética do lead time em horas.
   */
  @ApiPropertyOptional({ description: 'Média do lead time (horas)', example: 32.4, nullable: true })
  avg!: number | null;

  /**
   * Número de tasks com telemetria disponível.
   */
  @ApiProperty({ description: 'Número de amostras com telemetria', example: 38 })
  samples!: number;

  /**
   * Unidade de medida (sempre 'hours').
   */
  @ApiProperty({ description: 'Unidade de medida', example: 'hours', enum: ['hours'] })
  unit!: 'hours';
}
