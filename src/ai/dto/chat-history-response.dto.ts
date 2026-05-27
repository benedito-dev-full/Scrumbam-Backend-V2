import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Shape de UMA mensagem no historico do chat (`GET /ai/chat/history`).
 *
 * Inclui `metadata.toolCalls` para permitir o frontend renderizar badge
 * "IA usou tool X" no historico hidratado (paridade com a response do POST).
 */
export class ChatHistoryMessageDto {
  /** ID da DEvento -508. */
  @ApiProperty({ description: 'ID persistido (DEvento -508)', example: '12345' })
  id!: string;

  /** 'user' = mensagem do humano; 'assistant' = mensagem do Nexus. */
  @ApiProperty({
    description: 'Papel da mensagem',
    example: 'user',
    enum: ['user', 'assistant'],
  })
  role!: 'user' | 'assistant';

  /** Conteudo textual (markdown aceito). */
  @ApiProperty({ description: 'Conteudo da mensagem', example: 'Quais tasks?' })
  content!: string;

  /** Timestamp ISO 8601 UTC. */
  @ApiProperty({ description: 'Timestamp ISO 8601', example: '2026-05-27T18:30:00.000Z' })
  createdAt!: string;

  /** Modelo usado (apenas para `role=assistant`). */
  @ApiPropertyOptional({
    description: 'Modelo usado (apenas role=assistant)',
    example: 'gemini-2.5-flash',
  })
  model?: string;

  /** Quantidade de tools executadas (apenas para `role=assistant`). */
  @ApiPropertyOptional({ description: 'Quantidade de tools usadas', example: 2 })
  toolCallsCount?: number;
}

/**
 * Response do `GET /ai/chat/history` — historico cronologico do user.
 *
 * v1: ordem cronologica (ASC). Cursor pagination simples — quando `nextCursor`
 * vier, ha mais mensagens antigas para carregar (frontend pode lazy-load).
 */
export class ChatHistoryResponseDto {
  @ApiProperty({
    description: 'Mensagens em ordem cronologica (mais antiga primeiro)',
    type: [ChatHistoryMessageDto],
  })
  items!: ChatHistoryMessageDto[];

  @ApiPropertyOptional({
    description: 'Cursor para proxima pagina (mensagens mais antigas). Null quando nao ha mais.',
    example: '12300',
    nullable: true,
  })
  nextCursor!: string | null;
}
