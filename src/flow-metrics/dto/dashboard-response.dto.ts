import { ApiProperty } from '@nestjs/swagger';
import { CycleTimeResponseDto } from './cycle-time-response.dto';
import { LeadTimeResponseDto } from './lead-time-response.dto';
import { ThroughputResponseDto } from './throughput-response.dto';
import { WipAgeResponseDto } from './wip-age-response.dto';
import { CfdResponseDto } from './cfd-response.dto';
import { AutomationMetricsResponseDto } from '../../automation/metrics/automation-metrics.dto';

/**
 * Response DTO para o dashboard consolidado de flow metrics.
 *
 * Agrega todos os 5 indicadores em uma única chamada via Promise.all.
 * Útil para carregar o dashboard completo em uma request.
 *
 * @example
 * ```json
 * {
 *   "projectId": "123",
 *   "cycleTime": { "p50": 4.5, "samples": 42, "unit": "hours", ... },
 *   "leadTime": { "p50": 24.0, "samples": 38, "unit": "hours", ... },
 *   "throughput": { "series": [...], "total": 42, "granularity": "day" },
 *   "wipAge": { "byStatus": [...], "total": 7, "calculatedAt": "..." },
 *   "cfd": { "series": [...] },
 *   "calculatedAt": "2026-05-10T14:00:00.000Z"
 * }
 * ```
 */
export class DashboardResponseDto {
  /**
   * ID do projeto (string para BigInt serialization segura).
   */
  @ApiProperty({ description: 'ID do projeto', example: '123' })
  projectId!: string;

  /**
   * Métricas de cycle time.
   */
  @ApiProperty({ description: 'Cycle time do projeto', type: CycleTimeResponseDto })
  cycleTime!: CycleTimeResponseDto;

  /**
   * Métricas de lead time.
   */
  @ApiProperty({ description: 'Lead time do projeto', type: LeadTimeResponseDto })
  leadTime!: LeadTimeResponseDto;

  /**
   * Throughput do projeto.
   */
  @ApiProperty({ description: 'Throughput do projeto', type: ThroughputResponseDto })
  throughput!: ThroughputResponseDto;

  /**
   * WIP age por status.
   */
  @ApiProperty({ description: 'WIP age por status', type: WipAgeResponseDto })
  wipAge!: WipAgeResponseDto;

  /**
   * Cumulative Flow Diagram.
   */
  @ApiProperty({ description: 'CFD do projeto', type: CfdResponseDto })
  cfd!: CfdResponseDto;

  @ApiProperty({
    description: 'Resumo operacional da automacao F13',
    type: AutomationMetricsResponseDto,
  })
  automation!: AutomationMetricsResponseDto;

  /**
   * Timestamp do cálculo (ISO 8601).
   */
  @ApiProperty({ description: 'Timestamp do cálculo', example: '2026-05-10T14:00:00.000Z' })
  calculatedAt!: string;
}
