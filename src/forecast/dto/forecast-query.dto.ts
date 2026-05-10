import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * DTO para parâmetros de forecast Monte Carlo.
 *
 * Configura o número de sprints históricos e iterações da simulação.
 *
 * @example
 * ```typescript
 * // Padrão: 4 sprints, 10.000 iterações
 * const dto: ForecastQueryDto = {};
 *
 * // Customizado
 * const dto: ForecastQueryDto = { historicalSprints: 8, iterations: 5000 };
 * ```
 */
export class ForecastQueryDto {
  /**
   * Número de sprints históricos a considerar no cálculo de throughput.
   *
   * Fallback para janela móvel de 30 dias se sprints < 2.
   * Min: 1, Max: 12, Default: 4.
   */
  @ApiPropertyOptional({
    description: 'Número de sprints históricos para throughput (fallback: 30 dias se < 2)',
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
  historicalSprints?: number = 4;

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
