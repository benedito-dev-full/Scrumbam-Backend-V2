import { IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para resposta da transcrição de áudio via Groq Whisper.
 *
 * Representa o resultado da chamada à API Groq
 * `POST /openai/v1/audio/transcriptions`.
 *
 * @example
 * ```json
 * {
 *   "text": "Criar tarefa implementar login para amanhã",
 *   "language": "pt",
 *   "duration": 4.5
 * }
 * ```
 */
export class TranscriptionDto {
  /**
   * Texto transcrito do áudio.
   *
   * Pode ser string vazia se o áudio não contiver fala detectável.
   */
  @ApiProperty({
    description: 'Texto transcrito do áudio',
    example: 'Criar tarefa implementar login para amanhã',
  })
  @IsString()
  text!: string;

  /**
   * Idioma detectado no áudio (código ISO 639-1).
   *
   * Retornado pela API Groq quando detectado automaticamente.
   */
  @ApiPropertyOptional({
    description: 'Idioma detectado (ISO 639-1)',
    example: 'pt',
  })
  @IsOptional()
  @IsString()
  language?: string;

  /**
   * Duração do áudio em segundos.
   *
   * Retornado pela API Groq na resposta verbose_json.
   */
  @ApiPropertyOptional({
    description: 'Duração do áudio em segundos',
    example: 4.5,
  })
  @IsOptional()
  @IsNumber()
  duration?: number;
}
