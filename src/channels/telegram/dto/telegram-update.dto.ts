import { IsNumber, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TelegramMessageDto } from './telegram-message.dto';

/**
 * DTO para Update do Telegram.
 *
 * Representa o payload enviado pelo Telegram para o webhook configurado.
 * O `update_id` é único e monotonicamente crescente — usado para deduplicação.
 *
 * Validações aplicadas:
 * - updateId: número obrigatório (Int64, mas seguro como Number no protocolo)
 * - message: objeto opcional validado via TelegramMessageDto
 *
 * @example
 * ```json
 * {
 *   "update_id": 123456789,
 *   "message": {
 *     "message_id": 42,
 *     "chat": { "id": 987654321, "type": "private" },
 *     "from": { "id": 987654321, "username": "johndoe" },
 *     "text": "/pair abc123",
 *     "date": 1746000000
 *   }
 * }
 * ```
 *
 * @see TelegramMessageDto
 */
export class TelegramUpdateDto {
  /**
   * ID único do update (monotonicamente crescente por bot).
   *
   * Usado para deduplicação: chave Redis `tg:dedup:{update_id}` com TTL 1h.
   * Evita processamento duplicado em caso de retentativas do Telegram.
   */
  @ApiProperty({ description: 'ID único do update (deduplicação)', example: 123456789 })
  @IsNumber()
  update_id!: number;

  /**
   * Mensagem recebida (texto ou voz).
   *
   * Ausente em outros tipos de update (callback_query, inline_query, etc.).
   * F10 processa apenas `message` — outros tipos são ignorados silenciosamente.
   */
  @ApiPropertyOptional({ description: 'Mensagem recebida', type: TelegramMessageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramMessageDto)
  message?: TelegramMessageDto;
}
