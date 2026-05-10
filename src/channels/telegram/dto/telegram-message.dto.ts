import {
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para o chat Telegram.
 *
 * Representa o campo `chat` de uma mensagem do Telegram.
 * O `id` é Int64 no protocolo Telegram — convertido para BigInt no service.
 */
export class TelegramChatDto {
  /**
   * ID do chat no Telegram.
   *
   * Int64 no protocolo Telegram. No service é convertido para BigInt via `BigInt(id)`.
   * NUNCA usar parseInt ou Number — risco de perda de precisão para IDs > 2^53.
   */
  @ApiProperty({ description: 'ID do chat Telegram (Int64)', example: 123456789 })
  @IsNumber()
  id!: number;

  /** Tipo do chat: 'private', 'group', 'supergroup', 'channel'. */
  @ApiProperty({ description: 'Tipo do chat', example: 'private' })
  @IsString()
  type!: string;
}

/**
 * DTO para o remetente da mensagem Telegram.
 */
export class TelegramFromDto {
  /** ID do usuário no Telegram. */
  @ApiProperty({ description: 'ID do usuário Telegram', example: 987654321 })
  @IsNumber()
  id!: number;

  /** Username do usuário (sem @). */
  @ApiPropertyOptional({ description: 'Username Telegram (sem @)', example: 'johndoe' })
  @IsOptional()
  @IsString()
  username?: string;
}

/**
 * DTO para mensagem de voz do Telegram.
 */
export class TelegramVoiceDto {
  /** File ID do arquivo de voz — necessário para download via getFile. */
  @ApiProperty({ description: 'File ID do áudio de voz', example: 'BQACAgIAAxkBAAI...' })
  @IsString()
  file_id!: string;

  /** Duração em segundos. */
  @ApiProperty({ description: 'Duração do áudio em segundos', example: 5 })
  @IsNumber()
  duration!: number;

  /** MIME type do arquivo de voz. */
  @ApiPropertyOptional({ description: 'MIME type do arquivo de voz', example: 'audio/ogg' })
  @IsOptional()
  @IsString()
  mime_type?: string;
}

/**
 * DTO para mensagem Telegram inbound.
 *
 * Representa o campo `message` de um Update do Telegram.
 * Suporta mensagens de texto e de voz — campos específicos são opcionais.
 *
 * Validações aplicadas:
 * - messageId: número obrigatório
 * - chat: objeto com id e type (obrigatório)
 * - from: objeto opcional com id e username
 * - text: string opcional (presente em mensagens de texto)
 * - voice: objeto opcional (presente em mensagens de voz)
 * - date: timestamp Unix obrigatório
 *
 * @example
 * ```json
 * {
 *   "message_id": 42,
 *   "chat": { "id": 123456789, "type": "private" },
 *   "from": { "id": 987654321, "username": "johndoe" },
 *   "text": "Hello bot!",
 *   "date": 1746000000
 * }
 * ```
 */
export class TelegramMessageDto {
  /** ID da mensagem dentro do chat. */
  @ApiProperty({ description: 'ID da mensagem dentro do chat', example: 42 })
  @IsNumber()
  message_id!: number;

  /** Chat de origem da mensagem. */
  @ApiProperty({ description: 'Chat de origem', type: TelegramChatDto })
  @ValidateNested()
  @Type(() => TelegramChatDto)
  chat!: TelegramChatDto;

  /** Remetente da mensagem (ausente em canais). */
  @ApiPropertyOptional({ description: 'Remetente da mensagem', type: TelegramFromDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramFromDto)
  from?: TelegramFromDto;

  /** Texto da mensagem (para mensagens de texto). */
  @ApiPropertyOptional({ description: 'Texto da mensagem', example: 'Hello!' })
  @IsOptional()
  @IsString()
  text?: string;

  /** Dados de voz (para mensagens de voz). */
  @ApiPropertyOptional({ description: 'Dados do arquivo de voz', type: TelegramVoiceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramVoiceDto)
  voice?: TelegramVoiceDto;

  /** Timestamp Unix da mensagem. */
  @ApiProperty({ description: 'Timestamp Unix da mensagem', example: 1746000000 })
  @IsNumber()
  date!: number;
}
