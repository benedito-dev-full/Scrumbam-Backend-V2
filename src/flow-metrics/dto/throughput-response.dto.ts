import { ApiProperty } from '@nestjs/swagger';

/**
 * Ponto da série temporal de throughput.
 */
export class ThroughputDataPointDto {
  /**
   * Data do período no formato ISO 8601 (YYYY-MM-DD).
   * Para granularidade 'week': data da segunda-feira da semana.
   */
  @ApiProperty({ description: 'Data do período (YYYY-MM-DD)', example: '2026-01-15' })
  date!: string;

  /**
   * Quantidade de tasks concluídas (DONE ou VALIDATED) neste período.
   */
  @ApiProperty({ description: 'Tasks concluídas no período', example: 5 })
  count!: number;
}

/**
 * Response DTO para throughput de um projeto.
 *
 * Throughput = quantidade de tasks concluídas (status DONE ou VALIDATED)
 * por intervalo de tempo. Fonte: `dados.telemetry.doneAt`.
 *
 * @example
 * ```json
 * {
 *   "series": [
 *     { "date": "2026-01-15", "count": 3 },
 *     { "date": "2026-01-16", "count": 5 }
 *   ],
 *   "total": 8,
 *   "granularity": "day"
 * }
 * ```
 */
export class ThroughputResponseDto {
  /**
   * Série temporal de throughput.
   * Cada ponto representa um dia (granularity='day') ou semana (granularity='week').
   */
  @ApiProperty({
    description: 'Série temporal de throughput',
    type: [ThroughputDataPointDto],
  })
  series!: ThroughputDataPointDto[];

  /**
   * Total de tasks concluídas no período.
   */
  @ApiProperty({ description: 'Total de tasks concluídas no período', example: 42 })
  total!: number;

  /**
   * Granularidade usada ('day' ou 'week').
   */
  @ApiProperty({
    description: 'Granularidade da série temporal',
    enum: ['day', 'week'],
    example: 'day',
  })
  granularity!: 'day' | 'week';
}
