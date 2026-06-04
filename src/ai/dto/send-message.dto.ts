import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Providers de IA suportados pelo Nexus (roteamento — Fase 4). */
export const AI_PROVIDER_NAMES = ['gemini', 'claude', 'openai'] as const;

/** Tipo do provider escolhido (subset fechado validado por `@IsIn`). */
export type AiProviderName = (typeof AI_PROVIDER_NAMES)[number];

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

  /**
   * Provider de IA a usar nesta mensagem (override do default).
   *
   * Opcional. Quando ausente, o backend resolve o provider na cascata
   * `preferencia da org → default global (gemini)`. Quando presente, ganha
   * de qualquer preferencia. Valores aceitos: `gemini`, `claude`, `openai`.
   */
  @ApiPropertyOptional({
    description: 'Provider de IA a usar nesta mensagem (override do default da org)',
    enum: AI_PROVIDER_NAMES,
    example: 'claude',
  })
  @IsOptional()
  @IsIn(AI_PROVIDER_NAMES)
  provider?: AiProviderName;

  /**
   * Modelo especifico dentro do provider (override do default interno).
   *
   * Opcional. Quando ausente, o provider escolhido usa seu modelo default
   * (ex: `gemini-2.5-flash`, `claude-sonnet-4-5`, `gpt-4o`).
   */
  @ApiPropertyOptional({
    description: 'Modelo especifico do provider (ex: gemini-2.5-pro). Default: modelo interno do provider',
    example: 'gemini-2.5-pro',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}
