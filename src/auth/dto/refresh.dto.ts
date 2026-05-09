import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO para renovação de access token via refresh token.
 *
 * O refresh token é rotativo (ADR-V2-003, Decisão D3):
 * - Cada uso gera novo refresh token e invalida o anterior.
 * - Reuse detectado → revogação imediata + 401 UnauthorizedException.
 *
 * @example
 * ```typescript
 * const dto: RefreshDto = { refreshToken: 'abc123...' };
 * ```
 */
export class RefreshDto {
  /**
   * Refresh token em texto plano recebido no response de login/refresh anterior.
   * Armazenado como hash SHA-256 em DUserGroup.dados.refreshTokenHash.
   */
  @ApiProperty({
    description: 'Refresh token (obtido no login ou refresh anterior)',
    example: 'eyJhbGciOiJIUzI1NiJ9...',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
