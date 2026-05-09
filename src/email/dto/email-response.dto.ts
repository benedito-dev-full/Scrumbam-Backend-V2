import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO de resposta para operações de envio de email.
 *
 * Retornado após envio bem-sucedido com ID da mensagem,
 * provider utilizado e timestamp do envio.
 *
 * @example
 * ```json
 * {
 *   "id": "<messageId@smtp.local>",
 *   "provider": "smtp",
 *   "sentAt": "2026-05-09T12:00:00.000Z"
 * }
 * ```
 */
export class EmailResponseDto {
  /**
   * ID único da mensagem retornado pelo provider.
   */
  @ApiProperty({
    description: 'ID único da mensagem retornado pelo provider',
    example: '<messageId@smtp.local>',
  })
  id!: string;

  /**
   * Nome do provider que enviou o email.
   */
  @ApiProperty({
    description: "Provider utilizado para envio ('smtp', 'sendgrid', 'resend')",
    example: 'smtp',
    enum: ['smtp', 'smtp-mock', 'sendgrid', 'resend'],
  })
  provider!: string;

  /**
   * Timestamp ISO 8601 do momento do envio.
   */
  @ApiProperty({
    description: 'Timestamp ISO 8601 do envio',
    example: '2026-05-09T12:00:00.000Z',
  })
  sentAt!: string;
}
