import { ApiProperty } from '@nestjs/swagger';
import { AiProviderName } from './send-message.dto';

/**
 * Disponibilidade de UM provider de IA para a org (sem dado sensivel).
 *
 * Retornado por `GET /ai/providers` — acessivel a qualquer membro da org
 * (nao exige ADMIN). Informa apenas SE a org tem chave configurada para o
 * provider, NUNCA a chave nem mascara.
 *
 * @example
 * ```json
 * { "provider": "claude", "configured": false }
 * ```
 */
export class AiProviderAvailabilityDto {
  /** Provider (`gemini` | `claude` | `openai`). */
  @ApiProperty({ description: 'Provider de IA', example: 'claude' })
  provider!: AiProviderName;

  /** `true` quando a org tem chave deste provider cadastrada (nivel org). */
  @ApiProperty({ description: 'Se a org tem chave configurada para o provider', example: false })
  configured!: boolean;
}

/**
 * Resposta de `GET /ai/providers`: disponibilidade dos 3 providers para a org.
 *
 * @example
 * ```json
 * {
 *   "providers": [
 *     { "provider": "gemini", "configured": true },
 *     { "provider": "claude", "configured": false },
 *     { "provider": "openai", "configured": false }
 *   ]
 * }
 * ```
 */
export class AiProvidersAvailabilityResponseDto {
  /** Lista de disponibilidade por provider. */
  @ApiProperty({
    description: 'Disponibilidade por provider',
    type: [AiProviderAvailabilityDto],
  })
  providers!: AiProviderAvailabilityDto[];
}
