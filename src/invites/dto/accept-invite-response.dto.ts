import { ApiProperty } from '@nestjs/swagger';
import { AuthResponseDto } from '../../auth/dto/auth-response.dto';

/**
 * Response DTO para `POST /invites/:token/accept`.
 *
 * Estende `AuthResponseDto` (mesmo shape do login) e adiciona `redirectTo`
 * para que o frontend saiba o destino padrao apos auto-login.
 *
 * @example
 * ```json
 * {
 *   "accessToken": "eyJ...",
 *   "refreshToken": "abc...",
 *   "expiresIn": 900,
 *   "tokenType": "Bearer",
 *   "user": { ... },
 *   "redirectTo": "/intentions"
 * }
 * ```
 */
export class AcceptInviteResponseDto extends AuthResponseDto {
  /**
   * Rota recomendada para redirect apos auto-login.
   *
   * No MVP sempre `/intentions`. Pode evoluir para `/onboarding` no futuro.
   */
  @ApiProperty({
    description: 'Rota recomendada para redirect apos auto-login',
    example: '/intentions',
  })
  redirectTo!: string;
}
