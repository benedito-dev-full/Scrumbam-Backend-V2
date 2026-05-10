import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response DTO para forecast Monte Carlo de conclusão do projeto.
 *
 * Forecast = estimativa probabilística de dias até concluir as tasks restantes,
 * baseada em bootstrap resample do throughput histórico (Decisão D3 — plano §5).
 *
 * Decisão D3: bootstrap resample (não Normal N(μ,σ)) — robusto para amostras
 * pequenas (4-6 sprints), preserva caudas reais sem assumir normalidade.
 *
 * @example
 * ```json
 * {
 *   "p50": 12,
 *   "p75": 18,
 *   "p85": 22,
 *   "p95": 35,
 *   "unit": "days",
 *   "tasksRemaining": 30,
 *   "iterations": 10000,
 *   "source": "sprints"
 * }
 * ```
 */
export class ForecastResponseDto {
  /**
   * Estimativa de dias até conclusão no 50º percentil (mediana).
   * 50% de chance de concluir em até este número de dias.
   */
  @ApiProperty({ description: 'Dias até conclusão — 50% de confiança', example: 12 })
  p50!: number;

  /**
   * Estimativa de dias até conclusão no 75º percentil.
   * 75% de chance de concluir em até este número de dias.
   */
  @ApiProperty({ description: 'Dias até conclusão — 75% de confiança', example: 18 })
  p75!: number;

  /**
   * Estimativa de dias até conclusão no 85º percentil.
   * 85% de chance de concluir em até este número de dias.
   */
  @ApiProperty({ description: 'Dias até conclusão — 85% de confiança', example: 22 })
  p85!: number;

  /**
   * Estimativa de dias até conclusão no 95º percentil.
   * 95% de chance de concluir em até este número de dias.
   */
  @ApiProperty({ description: 'Dias até conclusão — 95% de confiança', example: 35 })
  p95!: number;

  /**
   * Unidade de medida (sempre 'days').
   */
  @ApiProperty({ description: 'Unidade de medida', example: 'days', enum: ['days'] })
  unit!: 'days';

  /**
   * Número de tasks restantes (WIP não-DONE + backlog).
   */
  @ApiProperty({ description: 'Tasks restantes no projeto', example: 30 })
  tasksRemaining!: number;

  /**
   * Número de iterações Monte Carlo realizadas.
   */
  @ApiProperty({ description: 'Iterações Monte Carlo', example: 10000 })
  iterations!: number;

  /**
   * Fonte do throughput histórico utilizado.
   * - 'sprints': calculado a partir de sprints cadastrados (≥ 2)
   * - 'rolling-window': calculado a partir de janela móvel de 30 dias
   */
  @ApiProperty({
    description: 'Fonte do throughput histórico',
    enum: ['sprints', 'rolling-window'],
    example: 'sprints',
  })
  source!: 'sprints' | 'rolling-window';

  /**
   * Throughput médio por período (informativo).
   */
  @ApiPropertyOptional({ description: 'Throughput médio histórico por período', example: 5.2 })
  avgThroughput?: number;
}
