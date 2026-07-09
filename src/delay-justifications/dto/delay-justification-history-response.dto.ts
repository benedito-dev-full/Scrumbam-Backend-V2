import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DelayJustificationResponseDto } from './delay-justification-response.dto';

/**
 * Item do histórico de justificativas de uma tarefa.
 *
 * Reusa o shape da vigente (`DelayJustificationResponseDto`) e adiciona os dois
 * campos que só fazem sentido no histórico:
 * - `isVigente` — `true` para a linha atual (`excluido=false`); `false` para as
 *   superseded (`excluido=true`).
 * - `supersededBy` — `DEvento.chave` da versão que substituiu esta (ou `null` na
 *   vigente / na última versão).
 *
 * @see DelayJustificationResponseDto — campos herdados (id, taskId, motivoClasse, …).
 */
export class DelayJustificationHistoryItemDto extends DelayJustificationResponseDto {
  /** `true` na versão vigente; `false` nas versões superseded. */
  @ApiProperty({ description: 'É a versão vigente?', example: false })
  isVigente!: boolean;

  /** ID da versão que substituiu esta (null se vigente/última). */
  @ApiPropertyOptional({
    description: 'ID (DEvento.chave) da versão que substituiu esta',
    example: '9002',
    nullable: true,
  })
  supersededBy?: string | null;
}

/**
 * Response de `GET /tasks/:taskId/delay-justification/history` (Fase 2).
 *
 * Lista TODAS as versões da justificativa daquela task (vigente + superseded),
 * ordenadas por `version` desc (mais recente primeiro). Painel de auditoria:
 * mostra como a justificativa evoluiu ao longo das edições.
 *
 * @example
 * ```json
 * {
 *   "taskId": "777",
 *   "total": 2,
 *   "items": [
 *     { "id": "9002", "version": 2, "isVigente": true,  "supersededBy": null,   "motivoClasse": "-535", ... },
 *     { "id": "9001", "version": 1, "isVigente": false, "supersededBy": "9002", "motivoClasse": "-531", ... }
 *   ]
 * }
 * ```
 */
export class DelayJustificationHistoryResponseDto {
  /** Tarefa cujo histórico foi consultado. */
  @ApiProperty({ description: 'ID da task (DTask.chave)', example: '777' })
  taskId!: string;

  /** Nº total de versões (vigente + superseded). */
  @ApiProperty({ description: 'Total de versões', example: 2 })
  total!: number;

  /** Versões ordenadas por `version` desc (mais recente primeiro). */
  @ApiProperty({
    description: 'Versões (mais recente primeiro)',
    type: [DelayJustificationHistoryItemDto],
  })
  items!: DelayJustificationHistoryItemDto[];
}
