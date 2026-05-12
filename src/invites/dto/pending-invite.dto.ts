import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO de convite pendente — retornado por GET /organizations/:orgId/invites.
 *
 * Versao sanitizada (sem tokenHash, sem flow interno) para listagem
 * administrativa. NAO confunde com InviteInfoDto (que e publico, para o
 * convidado, sem inviteId).
 */
export class PendingInviteDto {
  @ApiProperty({ description: 'ID do convite (DTabela.chave)', example: '42' })
  id!: string;

  @ApiProperty({ description: 'Email do convidado', example: 'convidado@x.com' })
  email!: string;

  @ApiProperty({ description: 'Role oferecida', example: 'MEMBER', enum: ['MEMBER', 'VIEWER'] })
  role!: 'MEMBER' | 'VIEWER';

  @ApiProperty({ description: 'ISO 8601 de quando o convite foi criado', example: '2026-05-12T19:00:00Z' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO 8601 de quando o convite expira', example: '2026-05-19T19:00:00Z' })
  expiresAt!: string;
}
