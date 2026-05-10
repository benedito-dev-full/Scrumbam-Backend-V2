import { ApiProperty } from '@nestjs/swagger';
import { NotificationResponseDto } from './notification-response.dto';

/**
 * Metadados de paginacao cursor-based para notificacoes.
 */
export class NotificationsPaginationDto {
  /**
   * Indica se existe proxima pagina.
   */
  @ApiProperty({ example: false })
  hasMore!: boolean;

  /**
   * Proximo cursor BigInt como string, ou null quando nao ha proxima pagina.
   */
  @ApiProperty({ example: '1000', nullable: true })
  nextCursor!: string | null;
}

/**
 * Response paginado de notificacoes.
 *
 * @example
 * ```json
 * {
 *   "items": [],
 *   "pagination": { "hasMore": false, "nextCursor": null }
 * }
 * ```
 */
export class ListNotificationsResponseDto {
  /**
   * Notificacoes serializadas para a UI.
   */
  @ApiProperty({ type: [NotificationResponseDto] })
  items!: NotificationResponseDto[];

  /**
   * Metadados de cursor pagination.
   */
  @ApiProperty({ type: NotificationsPaginationDto })
  pagination!: NotificationsPaginationDto;
}

/**
 * Response de `GET /notifications/unread-count`.
 */
export class UnreadCountResponseDto {
  /**
   * Quantidade de notificacoes nao lidas do usuario autenticado.
   */
  @ApiProperty({ example: 3 })
  count!: number;
}

/**
 * Response de `PATCH /notifications/read-all`.
 */
export class MarkAllReadResponseDto {
  /**
   * Quantidade de notificacoes atualizadas em lote.
   */
  @ApiProperty({ example: 5 })
  updated!: number;
}
