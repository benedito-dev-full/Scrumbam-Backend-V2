import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AI_PROVIDER_NAMES, AiProviderName } from './send-message.dto';

/**
 * DTO para definir a preferencia de provider/modelo padrao da org
 * (`PUT /ai/preference`).
 *
 * Persistido em `DTabela -484 AI_PROVIDER_PREF` (`dEntidadeId=orgId`). O `orgId`
 * vem do JWT, nunca do body. Honrado como fallback do default global na cascata
 * de roteamento (`dto.provider ?? pref.org ?? gemini`).
 *
 * Validacoes via class-validator:
 * - provider: obrigatorio, ∈ {gemini, claude, openai}.
 * - model: opcional, string ≤ 100 chars (modelo default do provider quando ausente).
 *
 * @example
 * ```typescript
 * const dto: SetProviderPrefDto = { provider: 'claude', model: 'claude-sonnet-4-5' };
 * ```
 */
export class SetProviderPrefDto {
  /** Provider preferido como default da org. */
  @ApiProperty({
    description: 'Provider preferido como default da org',
    enum: AI_PROVIDER_NAMES,
    example: 'claude',
  })
  @IsIn(AI_PROVIDER_NAMES)
  provider!: AiProviderName;

  /**
   * Modelo preferido dentro do provider (opcional).
   *
   * Quando ausente, o provider usa seu modelo default interno.
   */
  @ApiPropertyOptional({
    description: 'Modelo preferido (ex: claude-sonnet-4-5). Default: modelo interno do provider',
    example: 'claude-sonnet-4-5',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}
