import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Metadados do projeto para o relatório.
 */
export class ReportProjectDto {
  @ApiProperty({ example: '123', description: 'ID do projeto' })
  projectId!: string;

  @ApiProperty({ example: 'Meu Projeto', description: 'Nome do projeto' })
  projectName!: string;

  @ApiProperty({ example: '456', description: 'ID da organização' })
  orgId!: string;
}

/**
 * Período coberto pelo relatório.
 */
export class ReportPeriodDto {
  @ApiProperty({ example: '2026-04-01T00:00:00.000Z', description: 'Data inicial' })
  from!: string;

  @ApiProperty({ example: '2026-04-30T23:59:59.999Z', description: 'Data final' })
  to!: string;

  @ApiProperty({ example: 30, description: 'Quantidade de dias no período' })
  days!: number;
}

/**
 * DTO completo com todos os dados do relatório de projeto.
 *
 * Agregado pelo ReportsService a partir de DashboardsService,
 * AnalyticsService e ForecastService.
 * Todos os campos de métricas são opcionais para suportar projetos
 * com dados insuficientes (os warnings explicam o que está ausente).
 *
 * @example
 * ```json
 * {
 *   "project": { "projectId": "123", "projectName": "Meu Projeto", "orgId": "456" },
 *   "period": { "from": "2026-04-01T...", "to": "2026-04-30T...", "days": 30 },
 *   "generatedAt": "2026-05-10T12:00:00.000Z",
 *   "warnings": []
 * }
 * ```
 */
export class ProjectReportDataDto {
  @ApiProperty({ type: ReportProjectDto })
  project!: ReportProjectDto;

  @ApiProperty({ type: ReportPeriodDto })
  period!: ReportPeriodDto;

  @ApiProperty({ example: '2026-05-10T12:00:00.000Z' })
  generatedAt!: string;

  @ApiPropertyOptional({ description: 'Dashboard de métricas F8' })
  metrics?: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Série de velocity por sprint' })
  velocity?: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Série de burndown' })
  burndown?: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Tasks agrupadas por usuário' })
  tasksByUser?: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Forecast Monte Carlo p50/p75/p85/p95' })
  forecast?: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Resumo executivo stakeholder' })
  stakeholderSummary?: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Lista resumida de tasks (máx 200, quando includeTasks=true)' })
  tasks?: Record<string, unknown>[] | null;

  @ApiPropertyOptional({
    description: 'Avisos de dados insuficientes ou erros não críticos',
    type: [String],
  })
  warnings?: string[];
}
