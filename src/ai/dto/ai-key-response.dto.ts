import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AiProviderName } from './send-message.dto';

/**
 * DTO de resposta MASCARADA de uma chave de IA da org.
 *
 * Retornado por `POST /ai/keys` (apos upsert) e `GET /ai/keys` (listagem).
 * **NUNCA contem o campo `plaintext`/`key` cru** — apenas prefixo + mascara
 * + metadados. Espelha o contrato de mascaramento do `ApiKeyService` (-471).
 *
 * @example
 * ```json
 * {
 *   "provider": "claude",
 *   "prefix": "sk-ant-",
 *   "masked": "sk-ant-…f3a9",
 *   "configured": true,
 *   "createdAt": "2026-06-04T10:00:00.000Z",
 *   "lastRotatedAt": "2026-06-04T10:00:00.000Z"
 * }
 * ```
 */
export class AiKeyResponseDto {
  /** Provider da chave (`gemini` | `claude` | `openai`). */
  @ApiProperty({ description: 'Provider da chave', example: 'claude' })
  provider!: AiProviderName;

  /** Prefixo publico da chave (primeiros chars — identificacao). */
  @ApiProperty({ description: 'Prefixo publico da chave', example: 'sk-ant-' })
  prefix!: string;

  /**
   * Representacao mascarada da chave (`prefixo…sufixo`).
   *
   * Suficiente para o ADMIN identificar a chave sem expor o segredo.
   */
  @ApiProperty({ description: 'Chave mascarada (prefixo…sufixo)', example: 'sk-ant-…f3a9' })
  masked!: string;

  /** `true` quando a org tem chave deste provider cadastrada. */
  @ApiProperty({ description: 'Se a org tem chave deste provider', example: true })
  configured!: boolean;

  /** Data de criacao do registro da chave (ISO 8601). */
  @ApiPropertyOptional({ description: 'Data de criacao', example: '2026-06-04T10:00:00.000Z' })
  createdAt?: string;

  /** Data da ultima rotacao da chave (ISO 8601). */
  @ApiPropertyOptional({ description: 'Data da ultima rotacao', example: '2026-06-04T10:00:00.000Z' })
  lastRotatedAt?: string;
}
