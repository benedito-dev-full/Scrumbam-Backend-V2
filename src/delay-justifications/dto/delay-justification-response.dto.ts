import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DelayKind } from '../overdue.util';

/**
 * Response DTO da justificativa de atraso VIGENTE de uma tarefa.
 *
 * Materializa uma linha de `DEvento` (idClasse=-503, `excluido=false`) já com
 * o autor resolvido em JOIN. É o retorno de `POST` (após criar/editar) e de
 * `GET /tasks/:taskId/delay-justification`.
 *
 * @example
 * ```json
 * {
 *   "id": "9001",
 *   "taskId": "777",
 *   "motivoClasse": "-535",
 *   "texto": "Bug no gateway.",
 *   "autorId": "42",
 *   "autorNome": "Maria",
 *   "projetoId": "10",
 *   "delayDays": 3,
 *   "delayKind": "COMPLETED_LATE",
 *   "version": 2,
 *   "createdAt": "2026-07-09T14:00:00.000Z"
 * }
 * ```
 */
export class DelayJustificationResponseDto {
  /** `DEvento.chave` da linha vigente. */
  @ApiProperty({ description: 'ID do DEvento vigente', example: '9001' })
  id!: string;

  /** Tarefa justificada (`identificadorExterno`). */
  @ApiProperty({ description: 'ID da task (DTask.chave)', example: '777' })
  taskId!: string;

  /** DClasse-motivo (-531..-537). */
  @ApiProperty({ description: 'DClasse-motivo do atraso', example: '-535' })
  motivoClasse!: string;

  /** Detalhe humano (pode ser vazio). */
  @ApiProperty({ description: 'Detalhe livre', example: 'Bug no gateway.' })
  texto!: string;

  /** Autor (DEntidade do responsável ou admin que registrou). */
  @ApiProperty({ description: 'ID do autor (DEntidade.chave)', example: '42' })
  autorId!: string;

  /** Nome do autor (JOIN em DEntidade). */
  @ApiPropertyOptional({ description: 'Nome do autor', example: 'Maria', nullable: true })
  autorNome?: string | null;

  /** Projeto da tarefa no momento do registro (pode ser null). */
  @ApiPropertyOptional({ description: 'ID do projeto', example: '10', nullable: true })
  projetoId?: string | null;

  /** Dias de atraso no momento do registro. */
  @ApiProperty({ description: 'Dias de atraso capturados', example: 3 })
  delayDays!: number;

  /** Natureza do atraso no momento do registro. */
  @ApiProperty({ description: 'OPEN | COMPLETED_LATE', example: 'COMPLETED_LATE', nullable: true })
  delayKind!: DelayKind | null;

  /** Versão da justificativa (1 na criação; +1 a cada edição/supersede). */
  @ApiProperty({ description: 'Versão (incrementa a cada edição)', example: 2 })
  version!: number;

  /** Timestamp de criação desta versão (`DEvento.criadoEm`). */
  @ApiProperty({ description: 'Criado em (ISO 8601)', example: '2026-07-09T14:00:00.000Z' })
  createdAt!: string;
}
