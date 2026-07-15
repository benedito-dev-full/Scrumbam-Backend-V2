import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de resposta de `GET /tasks/:id/metrics`.
 *
 * Métricas agregadas de uma fase (ou task) e seus descendentes — calculadas
 * via CTE recursiva PostgreSQL em `PhaseMetricsService.compute`. Em Fase 4
 * apenas a estrutura está congelada; a computação real entra em Fase 5.
 *
 * @example
 * ```json
 * {
 *   "phaseId": "5",
 *   "total": 50,
 *   "done": 20,
 *   "failed": 2,
 *   "inProgress": 5,
 *   "pending": 23,
 *   "percent": 40,
 *   "recursive": true,
 *   "computedAt": "2026-05-21T10:30:00.000Z"
 * }
 * ```
 */
export class PhaseMetricsResponseDto {
  @ApiProperty({
    description: 'ID da fase consultada (chave DTask)',
    example: '5',
  })
  phaseId!: string;

  @ApiProperty({
    description: 'Total de descendentes não-fase (tasks executáveis)',
    example: 50,
  })
  total!: number;

  @ApiProperty({ description: 'Tasks em estado DONE', example: 20 })
  done!: number;

  @ApiProperty({ description: 'Tasks em estado FAILED', example: 2 })
  failed!: number;

  @ApiProperty({ description: 'Tasks em estado EXECUTING', example: 5 })
  inProgress!: number;

  @ApiProperty({ description: 'Tasks em estados pendentes (INBOX/READY)', example: 23 })
  pending!: number;

  @ApiProperty({
    description: 'Percentual concluído — done / total * 100',
    example: 40,
    minimum: 0,
    maximum: 100,
  })
  percent!: number;

  @ApiProperty({
    description:
      'Indica se a contagem inclui descendentes recursivamente (true) ou ' +
      'somente filhas diretas (false). Default: true.',
    example: true,
  })
  recursive!: boolean;

  @ApiPropertyOptional({
    description: 'Timestamp ISO 8601 do cálculo (útil para cache TTL)',
    example: '2026-05-21T10:30:00.000Z',
  })
  computedAt!: string;
}
