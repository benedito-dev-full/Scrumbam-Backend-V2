import { ApiProperty } from '@nestjs/swagger';

/**
 * Detalhamento de WIP age por status.
 */
export class WipAgeByStatusDto {
  /**
   * Nome legível do status (ex: 'EXECUTING').
   */
  @ApiProperty({ description: 'Código do status V3', example: 'EXECUTING' })
  statusCode!: string;

  /**
   * Idade média das tasks neste status (em horas).
   */
  @ApiProperty({ description: 'Idade média das tasks no status (horas)', example: 12.5 })
  avgAgeHours!: number;

  /**
   * Idade máxima das tasks neste status (em horas).
   * Útil para detectar tasks paradas há muito tempo (bloqueadas).
   */
  @ApiProperty({ description: 'Idade máxima das tasks no status (horas)', example: 48.0 })
  maxAgeHours!: number;

  /**
   * Número de tasks neste status.
   */
  @ApiProperty({ description: 'Quantidade de tasks neste status', example: 3 })
  count!: number;
}

/**
 * Response DTO para WIP (Work in Progress) age de um projeto.
 *
 * Mostra tasks não-DONE agrupadas por status, com a idade de cada grupo.
 * Útil para identificar gargalos e bloqueios.
 *
 * Timestamp inicial por status:
 * - EXECUTING / VALIDATING → `dados.telemetry.executingAt` (mais relevante)
 * - INBOX / READY / outros → `criadoEm`
 *
 * @example
 * ```json
 * {
 *   "byStatus": [
 *     { "statusCode": "INBOX", "avgAgeHours": 2.5, "maxAgeHours": 10.0, "count": 5 },
 *     { "statusCode": "EXECUTING", "avgAgeHours": 18.0, "maxAgeHours": 72.0, "count": 2 }
 *   ],
 *   "total": 7,
 *   "calculatedAt": "2026-05-10T14:00:00.000Z"
 * }
 * ```
 */
export class WipAgeResponseDto {
  /**
   * WIP age por status.
   */
  @ApiProperty({
    description: 'WIP age agrupado por status',
    type: [WipAgeByStatusDto],
  })
  byStatus!: WipAgeByStatusDto[];

  /**
   * Total de tasks em WIP (não-DONE).
   */
  @ApiProperty({ description: 'Total de tasks em WIP', example: 7 })
  total!: number;

  /**
   * Timestamp do cálculo (ISO 8601).
   */
  @ApiProperty({ description: 'Timestamp do cálculo', example: '2026-05-10T14:00:00.000Z' })
  calculatedAt!: string;
}
