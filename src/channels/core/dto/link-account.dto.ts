import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * DTO para pareamento manual de conta via HTTP (POST /channels/pairing/link).
 *
 * Permite que o usuário autenticado vincule seu chatId externo usando o código
 * gerado por `generate`. Útil para testes e ambientes sem webhook ativo.
 *
 * O campo `chatId` é recebido como string porque JSON não suporta Int64 nativo.
 * O service converte para BigInt no ponto de entrada.
 *
 * Validações:
 * - code: string exatamente 12 chars (formato CSPRNG hex)
 * - channelName: deve ser um dos canais suportados
 * - chatId: string numérica (convertida para BigInt no service)
 *
 * @example
 * ```typescript
 * const dto: LinkAccountDto = {
 *   code: 'a1b2c3d4e5f6',
 *   channelName: 'telegram',
 *   chatId: '123456789'
 * };
 * ```
 */
export class LinkAccountDto {
  /**
   * Código de pareamento one-shot gerado por `generate`.
   *
   * Exatamente 12 caracteres hexadecimais (6 bytes CSPRNG em hex).
   */
  @ApiProperty({
    description: 'Código de pareamento one-shot (12 chars hexadecimais)',
    example: 'a1b2c3d4e5f6',
    minLength: 12,
    maxLength: 12,
  })
  @IsString()
  @MinLength(12)
  @MaxLength(12)
  code!: string;

  /**
   * Canal de comunicação a ser vinculado.
   *
   * Deve ser um dos canais suportados na F10.
   */
  @ApiProperty({
    description: 'Nome do canal de comunicação',
    example: 'telegram',
    enum: ['telegram'],
  })
  @IsString()
  @IsIn(['telegram'])
  channelName!: string;

  /**
   * ID do chat no canal externo, representado como string.
   *
   * ChatId do Telegram é Int64 — representado como string para evitar
   * perda de precisão em JSON. Convertido para BigInt no service.
   */
  @ApiProperty({
    description: 'ID do chat no canal externo (string numérica — Int64)',
    example: '123456789',
  })
  @IsString()
  @Matches(/^\d+$/, { message: 'chatId deve ser uma string numérica' })
  chatId!: string;
}
