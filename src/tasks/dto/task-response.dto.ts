import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de resposta de task.
 *
 * Retornado em create, findOne, update e updateStatus.
 * O campo `dados` expõe identifier, estado V3 e telemetria.
 *
 * @example
 * ```json
 * {
 *   "id": "7",
 *   "nome": "Implementar JWT",
 *   "projectId": "1",
 *   "identifier": "DEV-7",
 *   "status": "INBOX",
 *   "priority": null,
 *   "assigneeId": null,
 *   "sprintId": null,
 *   "dados": { "identifier": "DEV-7", "v3": { "state": "INBOX" } },
 *   "criadoEm": "2026-05-09T00:00:00.000Z",
 *   "atualizadoEm": "2026-05-09T00:00:00.000Z"
 * }
 * ```
 */
export class TaskResponseDto {
  @ApiProperty({ description: 'ID da task (chave DTask)', example: '7' })
  id!: string;

  @ApiProperty({ description: 'Nome/título da task', example: 'Implementar JWT' })
  nome!: string;

  @ApiPropertyOptional({ description: 'Descrição da task', nullable: true })
  descricao!: string | null;

  @ApiProperty({ description: 'ID do projeto', example: '1' })
  projectId!: string;

  @ApiProperty({ description: 'Identifier único (ex: DEV-7)', example: 'DEV-7' })
  identifier!: string;

  @ApiProperty({ description: 'Estado V3 atual', example: 'INBOX' })
  status!: string;

  @ApiPropertyOptional({ description: 'Prioridade', nullable: true })
  priority!: string | null;

  @ApiPropertyOptional({ description: 'ID do assignee', nullable: true })
  assigneeId!: string | null;

  @ApiPropertyOptional({ description: 'ID do sprint', nullable: true })
  sprintId!: string | null;

  @ApiPropertyOptional({ description: 'Dados polimórficos (identifier, v3, telemetry, automation)', nullable: true })
  dados!: Record<string, unknown> | null;

  @ApiProperty({ description: 'Data de criação ISO 8601' })
  criadoEm!: string;

  @ApiProperty({ description: 'Data de atualização ISO 8601' })
  atualizadoEm!: string;
}

/**
 * DTO de lista paginada de tasks.
 */
export class ListTasksResponseDto {
  @ApiProperty({ type: [TaskResponseDto] })
  items!: TaskResponseDto[];

  @ApiProperty({ description: 'Metadados de paginação' })
  pagination!: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}
