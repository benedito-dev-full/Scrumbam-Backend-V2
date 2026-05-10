import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response DTO para cycle time de um projeto.
 *
 * Cycle time = tempo entre EXECUTING e DONE/VALIDATED (em horas).
 * Calculado sobre tasks com `dados.telemetry.cycleTime` preenchido.
 *
 * Unidade: horas (não dias) para maior granularidade.
 * `samples` reflete apenas tasks com telemetria disponível (não total).
 *
 * @example
 * ```json
 * {
 *   "p50": 4.5,
 *   "p75": 8.0,
 *   "p90": 16.2,
 *   "avg": 6.1,
 *   "samples": 42,
 *   "unit": "hours",
 *   "periodFrom": "2026-01-01",
 *   "periodTo": "2026-01-31"
 * }
 * ```
 */
export class CycleTimeResponseDto {
  /**
   * 50º percentil (mediana) do cycle time em horas.
   * null quando não há dados suficientes.
   */
  @ApiPropertyOptional({ description: 'Mediana do cycle time (horas)', example: 4.5, nullable: true })
  p50!: number | null;

  /**
   * 75º percentil do cycle time em horas.
   */
  @ApiPropertyOptional({ description: '75º percentil do cycle time (horas)', example: 8.0, nullable: true })
  p75!: number | null;

  /**
   * 90º percentil do cycle time em horas.
   */
  @ApiPropertyOptional({ description: '90º percentil do cycle time (horas)', example: 16.2, nullable: true })
  p90!: number | null;

  /**
   * Média aritmética do cycle time em horas.
   */
  @ApiPropertyOptional({ description: 'Média do cycle time (horas)', example: 6.1, nullable: true })
  avg!: number | null;

  /**
   * Número de tasks com telemetria disponível (amostras).
   *
   * NÃO representa total de tasks do projeto — apenas as que possuem
   * `dados.telemetry.cycleTime` preenchido (status DONE/VALIDATED).
   */
  @ApiProperty({ description: 'Número de amostras com telemetria', example: 42 })
  samples!: number;

  /**
   * Unidade de medida (sempre 'hours').
   */
  @ApiProperty({ description: 'Unidade de medida', example: 'hours', enum: ['hours'] })
  unit!: 'hours';
}
