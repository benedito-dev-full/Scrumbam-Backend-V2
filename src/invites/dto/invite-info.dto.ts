import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO para `GET /invites/:token` (publico).
 *
 * Resposta sanitizada: NUNCA expoe o hash do token, chaves internas
 * (`inviteId` numerico), nem detalhe do motivo de invalidacao (anti-enumeracao).
 *
 * Estrutura:
 * - orgName: nome publico da organizacao convidante.
 * - inviterName: nome do admin que enviou (para humanizar o convite).
 * - email: email destinatario do convite (renderizar no form como readonly).
 * - role: role que sera atribuida no accept.
 * - expiresAt: ISO 8601 — usado pelo frontend para mostrar countdown.
 *
 * @example
 * ```json
 * {
 *   "orgName": "Acme Corp",
 *   "inviterName": "Joao Admin",
 *   "email": "convidado@empresa.com",
 *   "role": "MEMBER",
 *   "expiresAt": "2026-05-18T12:00:00.000Z"
 * }
 * ```
 */
export class InviteInfoDto {
  /**
   * Nome publico da organizacao convidante.
   */
  @ApiProperty({ description: 'Nome publico da organizacao', example: 'Acme Corp' })
  orgName!: string;

  /**
   * Nome do admin que enviou o convite (para humanizar).
   */
  @ApiProperty({ description: 'Nome do admin que enviou', example: 'Joao Admin' })
  inviterName!: string;

  /**
   * Email destinatario do convite (readonly no form de aceite).
   */
  @ApiProperty({ description: 'Email destinatario', example: 'convidado@empresa.com' })
  email!: string;

  /**
   * Role que sera atribuida no accept.
   */
  @ApiProperty({ description: 'Role a atribuir', example: 'MEMBER', enum: ['MEMBER', 'VIEWER'] })
  role!: 'MEMBER' | 'VIEWER';

  /**
   * Expiracao do convite (ISO 8601). Apos esta data, GET retorna 404.
   */
  @ApiProperty({ description: 'Data de expiracao (ISO 8601)', example: '2026-05-18T12:00:00.000Z' })
  expiresAt!: string;
}
