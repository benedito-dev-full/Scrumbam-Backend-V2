import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Auditoria minima de UMA tool executada — incluida na response do `POST /ai/chat`
 * para o frontend poder mostrar badge "IA usou tool X" (opcional v1).
 */
export class ChatToolCallDto {
  @ApiProperty({ description: 'Nome da tool executada', example: 'createTask' })
  name!: string;

  @ApiProperty({ description: 'Hash dos argumentos (audit)', example: 'a1b2c3d4' })
  argsHash!: string;

  @ApiProperty({
    description: 'Preview truncado do resultado da tool',
    example: '{ success: true, taskId: "123" }',
  })
  resultPreview!: string;
}

/**
 * Response do `POST /ai/chat` — mensagem do assistant com metadados de execucao.
 *
 * v1: payload simples — apenas o texto final, modelo usado e contagem de tools.
 * v2 (streaming): trocara para SSE; mesmo shape sera emitido como evento final.
 */
export class ChatMessageResponseDto {
  /**
   * Texto final da resposta do assistant (apos todas as tool calls).
   * Markdown aceito — frontend renderiza com `react-markdown`.
   */
  @ApiProperty({
    description: 'Texto final do assistant (markdown aceito)',
    example: 'O projeto 1 tem 3 tasks em EXECUTING. Quer ver os titulos?',
  })
  assistantMessage!: string;

  /**
   * Modelo usado para gerar a resposta (ex: 'gemini-2.5-flash').
   * Frontend pode mostrar como tooltip para transparencia.
   */
  @ApiProperty({ description: 'Modelo usado', example: 'gemini-2.5-flash' })
  model!: string;

  /**
   * Quantidade de tools executadas nesta resposta. Util para debug e
   * para o frontend mostrar badge "IA pesquisou".
   */
  @ApiProperty({ description: 'Quantidade de tools executadas', example: 1 })
  toolCallsCount!: number;

  /**
   * Detalhe das tools executadas (opcional — pode vir vazio se nenhuma).
   * Permite ao frontend mostrar quais tools foram usadas.
   */
  @ApiPropertyOptional({
    description: 'Detalhe das tools executadas',
    type: [ChatToolCallDto],
  })
  toolCalls?: ChatToolCallDto[];

  /**
   * ID da DEvento -508 persistida — util para "regenerar" ou "reportar".
   */
  @ApiProperty({ description: 'ID da mensagem persistida (DEvento -508)', example: '12345' })
  messageId!: string;
}
