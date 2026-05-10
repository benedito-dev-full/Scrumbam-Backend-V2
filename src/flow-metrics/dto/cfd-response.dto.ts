import { ApiProperty } from '@nestjs/swagger';

/**
 * Ponto da série temporal do CFD.
 */
export class CfdDataPointDto {
  /**
   * Data no formato YYYY-MM-DD.
   */
  @ApiProperty({ description: 'Data do ponto (YYYY-MM-DD)', example: '2026-01-15' })
  date!: string;

  /**
   * Contagem de tasks por status nesta data.
   * Chaves: códigos de status V3 (ex: 'INBOX', 'READY', 'EXECUTING', 'DONE').
   */
  @ApiProperty({
    description: 'Contagem de tasks por status',
    example: { INBOX: 10, READY: 5, EXECUTING: 3, DONE: 8, VALIDATED: 2 },
  })
  counts!: Record<string, number>;
}

/**
 * Response DTO para Cumulative Flow Diagram (CFD) de um projeto.
 *
 * CFD mostra a evolução do número de tasks em cada status ao longo do tempo.
 * Reconstruído por replay de eventos DEvento -498 (TASK_STATUS_CHANGED).
 *
 * Estado inicial assumido para tasks sem transição anterior ao período: INBOX.
 *
 * @example
 * ```json
 * {
 *   "series": [
 *     {
 *       "date": "2026-01-01",
 *       "counts": { "INBOX": 10, "READY": 0, "EXECUTING": 0, "DONE": 0 }
 *     },
 *     {
 *       "date": "2026-01-02",
 *       "counts": { "INBOX": 8, "READY": 2, "EXECUTING": 0, "DONE": 0 }
 *     }
 *   ]
 * }
 * ```
 */
export class CfdResponseDto {
  /**
   * Série temporal do CFD.
   * Cada ponto representa o snapshot de status no fim do dia.
   */
  @ApiProperty({
    description: 'Série temporal do CFD',
    type: [CfdDataPointDto],
  })
  series!: CfdDataPointDto[];
}
