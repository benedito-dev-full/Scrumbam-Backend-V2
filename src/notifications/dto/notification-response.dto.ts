import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response serializado de uma notificacao `DEvento -490`.
 *
 * Todos os campos BigInt sao expostos como string para preservar precisao em
 * JSON e manter ADR-V2-025.
 *
 * @example
 * ```json
 * {
 *   "id": "1001",
 *   "idClasse": "-490",
 *   "recipientId": "150",
 *   "eventType": "task.status.changed",
 *   "title": "Task atualizada",
 *   "message": "Status da task alterado.",
 *   "read": false,
 *   "createdAt": "2026-05-10T12:00:00.000Z",
 *   "metadata": {}
 * }
 * ```
 */
export class NotificationResponseDto {
  /**
   * `DEvento.chave` da notificacao.
   */
  @ApiProperty({ example: '1001' })
  id!: string;

  /**
   * Classe canonica da notificacao em `DEvento`.
   */
  @ApiProperty({ example: '-490' })
  idClasse!: string;

  /**
   * Destinatario da notificacao (`DEntidade.chave`).
   */
  @ApiProperty({ example: '150', nullable: true })
  recipientId!: string | null;

  /**
   * Tipo do evento original que gerou a notificacao.
   */
  @ApiProperty({ example: 'task.status.changed', nullable: true })
  eventType!: string | null;

  /**
   * Titulo curto exibido pela UI.
   */
  @ApiProperty({ example: 'Task atualizada' })
  title!: string;

  /**
   * Mensagem principal exibida pela UI.
   */
  @ApiProperty({ example: 'Status da task alterado.' })
  message!: string;

  /**
   * Estado de leitura derivado de `metaDados.read`.
   */
  @ApiProperty({ example: false })
  read!: boolean;

  /**
   * Task relacionada, quando o evento original carregar esse contexto.
   */
  @ApiPropertyOptional({ example: '123', nullable: true })
  taskId?: string | null;

  /**
   * Projeto relacionado, quando disponivel.
   */
  @ApiPropertyOptional({ example: '456', nullable: true })
  projectId?: string | null;

  /**
   * Execucao relacionada, quando disponivel.
   */
  @ApiPropertyOptional({ example: '789', nullable: true })
  executionId?: string | null;

  /**
   * Timestamp ISO de criacao do `DEvento`.
   */
  @ApiProperty({ example: '2026-05-10T12:00:00.000Z' })
  createdAt!: string;

  /**
   * `DEvento.metaDados` original para payloads complementares de UI.
   */
  @ApiProperty({ type: Object, additionalProperties: true })
  metadata!: Record<string, unknown>;
}
