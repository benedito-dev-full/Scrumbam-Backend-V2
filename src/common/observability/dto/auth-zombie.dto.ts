import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/**
 * Payload do beacon de **estado zumbi** do frontend (F0 — Observabilidade).
 *
 * Emitido no boot do app quando o cookie `scrumbam_auth=1` está presente
 * (escopo NAVEGADOR) mas o `accessToken` está ausente após a reidratação do
 * store (escopo ABA) — o sintoma A do plano: aba nova com app "zumbi",
 * sem nenhum request saindo e sem logout.
 *
 * **Payload mínimo por decisão de segurança:** o endpoint é `@Public()` (o
 * usuário zumbi, por definição, não tem token). Nenhum campo além deste é
 * aceito — `forbidNonWhitelisted: true` no ValidationPipe global rejeita
 * qualquer chave extra com 400, o que impede o endpoint de virar um dreno de
 * dados arbitrários. **Nunca** enviar token, hash, email ou identificador de
 * usuário aqui.
 *
 * @example
 * ```json
 * { "hadRefreshToken": true }
 * ```
 */
export class AuthZombieDto {
  /**
   * `true` se havia refresh token no storage no momento do boot.
   *
   * Discrimina os dois zumbis:
   * - `true`  → dava para recuperar a sessão com refresh silencioso (F2).
   * - `false` → storage vazio, só o cookie sobreviveu (aba nova pura).
   */
  @ApiProperty({
    description: 'Havia refresh token no storage quando o estado zumbi foi detectado',
    example: true,
  })
  @IsBoolean()
  hadRefreshToken!: boolean;
}
