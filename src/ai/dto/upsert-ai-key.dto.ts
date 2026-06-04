import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { AI_PROVIDER_NAMES, AiProviderName } from './send-message.dto';

/**
 * DTO para cadastrar/rotacionar a chave de IA de um provider na org
 * (`POST /ai/keys`).
 *
 * O `orgId` NUNCA vem deste DTO — e sempre derivado do JWT
 * (`req.user.organizationId`) no controller. Aqui so trafega o provider
 * alvo e a chave plaintext a gravar.
 *
 * Validacoes aplicadas via class-validator:
 * - provider: obrigatorio, ∈ {gemini, claude, openai} (`@IsIn`).
 * - key: string nao-vazia, 10–500 chars (limites toleranates — validacao
 *   de formato por vendor e feita no service como warning, nao rejeicao).
 *
 * **Seguranca:** o `key` plaintext NUNCA e logado nem devolvido na resposta.
 *
 * @example
 * ```typescript
 * const dto: UpsertAiKeyDto = { provider: 'claude', key: 'sk-ant-...' };
 * ```
 */
export class UpsertAiKeyDto {
  /**
   * Provider de IA cuja chave da org sera cadastrada/rotacionada.
   *
   * Mapeado para a DClasse da DTabela onde a chave e gravada:
   * gemini→-481, claude→-482, openai→-483.
   */
  @ApiProperty({
    description: 'Provider de IA alvo da chave',
    enum: AI_PROVIDER_NAMES,
    example: 'claude',
  })
  @IsIn(AI_PROVIDER_NAMES)
  provider!: AiProviderName;

  /**
   * Chave (API key) plaintext do provider.
   *
   * Armazenada em texto puro nesta leva (decisao R-2 do CEO — criptografia
   * at-rest e item de alta prioridade na proxima leva). Nunca devolvida em
   * respostas; sempre mascarada.
   */
  @ApiProperty({
    description: 'API key plaintext do provider (10–500 chars). Nunca devolvida; sempre mascarada.',
    example: 'sk-ant-api03-xxxxxxxxxxxxxxxx',
    minLength: 10,
    maxLength: 500,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  key!: string;
}
