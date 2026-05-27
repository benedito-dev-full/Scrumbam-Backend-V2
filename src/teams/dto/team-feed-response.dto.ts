import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Item de atividade do feed do time.
 *
 * Representa um DEvento (-497 TASK_CREATED ou -498 TASK_STATUS_CHANGED)
 * vinculado ao time via idEntidade=teamId.
 *
 * @example
 * ```json
 * {
 *   "id": "42",
 *   "acao": "TASK_COMPLETED",
 *   "descricao": "task.status.changed",
 *   "taskId": "10",
 *   "taskNome": "Implementar feed",
 *   "userId": "5",
 *   "userName": "João",
 *   "statusAnterior": "EXECUTING",
 *   "statusNovo": "DONE",
 *   "criadoEm": "2026-05-27T12:00:00.000Z"
 * }
 * ```
 */
export class TeamFeedItemDto {
  /** Chave do DEvento (string BigInt). */
  @ApiProperty({ description: 'ID do evento', example: '42' })
  id!: string;

  /**
   * Ação canônica do feed.
   * Valores: TASK_CREATED, TASK_ASSIGNED, TASK_STATUS_CHANGED, TASK_COMPLETED.
   */
  @ApiProperty({
    description: 'Ação do evento',
    example: 'TASK_COMPLETED',
    enum: ['TASK_CREATED', 'TASK_ASSIGNED', 'TASK_STATUS_CHANGED', 'TASK_COMPLETED'],
  })
  acao!: string;

  /** Descrição textual do evento (campo DEvento.descricao). */
  @ApiProperty({ description: 'Descrição textual do evento', example: 'task.status.changed' })
  descricao!: string;

  /** Chave da DTask relacionada (null se não disponível). */
  @ApiPropertyOptional({ nullable: true, description: 'ID da task relacionada', example: '10' })
  taskId!: string | null;

  /** Nome da task relacionada. */
  @ApiPropertyOptional({ nullable: true, description: 'Nome da task', example: 'Implementar feed' })
  taskNome!: string | null;

  /** Chave da DEntidade do usuário que executou a ação. */
  @ApiPropertyOptional({ nullable: true, description: 'ID do usuário', example: '5' })
  userId!: string | null;

  /** Nome do usuário. */
  @ApiPropertyOptional({ nullable: true, description: 'Nome do usuário', example: 'João' })
  userName!: string | null;

  /** Status V3 Intention anterior (só presente em mudanças de status). */
  @ApiPropertyOptional({ nullable: true, description: 'Status anterior', example: 'EXECUTING' })
  statusAnterior!: string | null;

  /** Status V3 Intention novo (só presente em mudanças de status). */
  @ApiPropertyOptional({ nullable: true, description: 'Status novo', example: 'DONE' })
  statusNovo!: string | null;

  /** ISO 8601 da criação do evento. */
  @ApiProperty({ description: 'Data de criação', example: '2026-05-27T12:00:00.000Z' })
  criadoEm!: string;
}

/**
 * Resposta paginada do feed de atividades do time.
 *
 * Usa cursor pagination descendente por `DEvento.chave` (mais recente primeiro).
 *
 * @example
 * ```json
 * {
 *   "items": [{ "id": "42", "acao": "TASK_COMPLETED", ... }],
 *   "nextCursor": "41",
 *   "hasMore": true
 * }
 * ```
 */
export class TeamFeedResponseDto {
  /** Lista de eventos de atividade do time. */
  @ApiProperty({ type: [TeamFeedItemDto], description: 'Eventos de atividade' })
  items!: TeamFeedItemDto[];

  /** Cursor para próxima página (null se não há mais resultados). */
  @ApiPropertyOptional({
    nullable: true,
    description: 'Cursor para próxima página',
    example: '41',
  })
  nextCursor!: string | null;

  /** Indica se há mais resultados. */
  @ApiProperty({ description: 'Há mais resultados', example: true })
  hasMore!: boolean;
}
