import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Projeção **SEGURA** de uma sessão (`GET /auth/sessions`).
 *
 * Alimenta a tela "Dispositivos conectados" (OWASP ASVS — Session Management:
 * sessões precisam ser enumeráveis e termináveis individualmente).
 *
 * ## O que este DTO NUNCA carrega
 *
 * `codigo` (= sha256 do refresh token corrente), `metaDados.prevHash`,
 * `familyId` e `jti`. Vazar qualquer um deles é vazar credencial ou dar ao
 * atacante o mapa da família de tokens. É exatamente por causa desta projeção
 * obrigatória que a DClasse SESSION (-485) é **denylisted** no endpoint
 * genérico `/tabelas` (Pilar 2) — lá ela sairia com `codigo` e `metaDados` crus.
 *
 * @example
 * ```json
 * [
 *   {
 *     "id": "1042",
 *     "device": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)…",
 *     "ip": "189.4.x.x",
 *     "createdAt": "2026-07-10T14:02:11.000Z",
 *     "lastUsedAt": "2026-07-13T09:31:44.000Z",
 *     "expiresAt": "2026-07-20T09:31:44.000Z",
 *     "current": true
 *   }
 * ]
 * ```
 */
export class SessionResponseDto {
  /** Chave da sessão (DTabela) — usada em `DELETE /auth/sessions/:id`. */
  @ApiProperty({ description: 'ID da sessão', example: '1042' })
  id!: string;

  /** Rótulo do dispositivo (User-Agent resumido). */
  @ApiProperty({
    description: 'Dispositivo (User-Agent resumido)',
    example: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  })
  device!: string;

  /** IP de origem no último uso. */
  @ApiPropertyOptional({ description: 'IP de origem', example: '189.4.10.2', nullable: true })
  ip?: string | null;

  /** Quando a sessão foi criada (login). */
  @ApiProperty({ description: 'Criação da sessão (ISO)', example: '2026-07-10T14:02:11.000Z' })
  createdAt!: string;

  /** Último refresh bem-sucedido desta sessão. */
  @ApiProperty({ description: 'Último uso (ISO)', example: '2026-07-13T09:31:44.000Z' })
  lastUsedAt!: string;

  /** Expiração idle (renovada a cada refresh). */
  @ApiProperty({
    description: 'Expiração por inatividade (ISO)',
    example: '2026-07-20T09:31:44.000Z',
  })
  expiresAt!: string;

  /** Expiração ABSOLUTA (teto duro — nunca estendido; força re-login). */
  @ApiProperty({ description: 'Expiração absoluta (ISO)', example: '2026-08-09T14:02:11.000Z' })
  absoluteExpiresAt!: string;

  /**
   * `true` na sessão que emitiu o token DESTE request.
   *
   * Resolvido pelo claim `sid` do JWT. Tokens emitidos antes da F3 não têm
   * `sid` → `current: false` em todas (degradação benigna: o frontend só perde
   * o rótulo "este dispositivo" até o próximo refresh).
   */
  @ApiProperty({ description: 'É a sessão deste request?', example: true })
  current!: boolean;
}
