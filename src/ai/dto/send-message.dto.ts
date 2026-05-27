import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO para envio de mensagem ao Nexus (`POST /ai/chat`).
 *
 * v1: payload minimo — apenas o texto do usuario. O backend monta o
 * historico automaticamente a partir de `DEvento -508` ao processar.
 * Frontend NAO envia historico — isso evita inconsistencias entre
 * cliente e servidor e mantem o servidor como source of truth.
 *
 * Limite de 50000 caracteres protege contra payloads abusivos (R-9 do
 * plano canonico). Texto markdown e suportado (sera renderizado no UI).
 */
export class SendMessageDto {
  /**
   * Conteudo textual da mensagem do usuario para o Nexus.
   *
   * Markdown e aceito. Limite superior gera HTTP 400 antes de chegar
   * ao service.
   */
  @ApiProperty({
    description: 'Texto da mensagem do usuario (markdown aceito, 1–50000 chars)',
    example: 'Quais sao as tasks ativas do projeto 1?',
    minLength: 1,
    maxLength: 50000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50000)
  content!: string;
}
