import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * DTO para parâmetros de forecast Monte Carlo.
 *
 * Configura o número de períodos históricos e iterações da simulação.
 *
 * @example
 * ```typescript
 * // Padrão: 4 períodos, 10.000 iterações
 * const dto: ForecastQueryDto = {};
 *
 * // Customizado
 * const dto: ForecastQueryDto = { historicalPeriods: 8, iterations: 5000 };
 * ```
 */
export class ForecastQueryDto {
  /**
   * Número de períodos históricos a considerar no cálculo de throughput.
   *
   * O throughput é calculado a partir de uma janela móvel de 30 dias por semana.
   * Min: 1, Max: 12, Default: 4.
   */
  @ApiPropertyOptional({
    description: 'Número de períodos históricos para throughput',
    example: 4,
    default: 4,
    minimum: 1,
    maximum: 12,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  historicalPeriods?: number = 4;

  /**
   * Número de iterações do Monte Carlo.
   *
   * Mais iterações = resultado mais estável, mas mais lento.
   * Min: 100, Max: 50.000, Default: 10.000.
   */
  @ApiPropertyOptional({
    description: 'Número de iterações Monte Carlo',
    example: 10000,
    default: 10000,
    minimum: 100,
    maximum: 50000,
  })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(50000)
  @Type(() => Number)
  iterations?: number = 10000;
}
