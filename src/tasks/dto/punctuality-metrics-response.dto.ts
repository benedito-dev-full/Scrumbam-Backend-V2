import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de resposta de `GET /tasks/projects/:projectId/punctuality`.
 *
 * Métrica de "pontualidade" / "margem de atraso" agregada de um projeto:
 * a média (em dias corridos) da diferença entre a data de conclusão
 * (`dados.telemetry.doneAt`) e o prazo combinado (`DTask.dueDate`) das tasks
 * em status terminal (DONE) que possuem AMBOS os campos definidos.
 *
 * Convenção de sinal (informação central da métrica):
 * - `averageDelayDays > 0` → em média o projeto ATRASA (concluiu depois do prazo).
 * - `averageDelayDays < 0` → em média o projeto ADIANTA (concluiu antes do prazo).
 * - `averageDelayDays === null` → não há amostras (nenhuma task concluída com
 *   `dueDate` E `doneAt`). Distinto de `0` (que significaria "pontual em média").
 *
 * Calculado live a cada request via SQL raw (`AVG`), sem cache, sem Engine,
 * sobre DTask (tabela estrutural — leitura pura). Não introduz DClasse nem
 * tabela nova.
 *
 * @example
 * ```json
 * {
 *   "averageDelayDays": 2.35,
 *   "sampleSize": 12,
 *   "computedAt": "2026-07-09T12:00:00.000Z"
 * }
 * ```
 */
export class PunctualityMetricsResponseDto {
  @ApiPropertyOptional({
    description:
      'Média de dias corridos entre conclusão e prazo (completedAt - dueDate). ' +
      'Positivo = atrasou; negativo = adiantou. `null` quando não há amostras ' +
      '(nenhuma task concluída com dueDate e doneAt definidos).',
    example: 2.35,
    nullable: true,
  })
  averageDelayDays!: number | null;

  @ApiProperty({
    description:
      'Quantidade de tasks concluídas (DONE) COM dueDate e doneAt ' +
      'que entraram no cálculo da média. `0` quando não há amostras.',
    example: 12,
    minimum: 0,
  })
  sampleSize!: number;

  @ApiProperty({
    description: 'Timestamp ISO 8601 de quando a métrica foi computada (sem cache — sempre live).',
    example: '2026-07-09T12:00:00.000Z',
  })
  computedAt!: string;
}
