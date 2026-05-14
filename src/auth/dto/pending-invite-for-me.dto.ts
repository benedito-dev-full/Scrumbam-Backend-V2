import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO de convite pendente endereçado ao próprio user autenticado.
 *
 * Retornado por `GET /auth/pending-invites` (Etapa 4 do plano
 * orphan-workspace). Diferente de `PendingInviteDto` (visão ADMIN da org
 * via `GET /organizations/:orgId/invites`), este DTO é a visão do
 * CONVIDADO — busca pelo email do user autenticado, independente de org
 * ou role.
 *
 * Versão FORTEMENTE sanitizada:
 *  - NÃO expõe `tokenHash` (segredo — só existe no email enviado).
 *  - NÃO expõe `flow` (`new_user` / `existing_user` — detalhe interno do
 *    accept-flow ADR-V2-030).
 *  - NÃO expõe `targetUserId` (snapshot do user vinculado no flow
 *    `existing_user`).
 *  - NÃO expõe `invitedByUserId` (audit trail interno).
 *  - NÃO expõe `email` do convidado (já é o próprio user).
 *
 * Apenas o suficiente para o frontend renderizar o empty state de
 * usuário órfão ("Você tem N convites pendentes — aceite ou crie sua
 * própria workspace").
 *
 * @example
 * ```json
 * {
 *   "inviteId": "42",
 *   "orgId": "100",
 *   "orgName": "Acme Corp",
 *   "role": "MEMBER",
 *   "expiresAt": "2026-05-21T00:00:00.000Z"
 * }
 * ```
 */
export class PendingInviteForMeDto {
  @ApiProperty({
    description: 'ID do convite (chave da DTabela -476)',
    example: '42',
  })
  inviteId!: string;

  @ApiProperty({
    description: 'ID da organização que convidou (chave da DEntidade -152)',
    example: '100',
  })
  orgId!: string;

  @ApiProperty({
    description: 'Nome da organização que convidou',
    example: 'Acme Corp',
  })
  orgName!: string;

  @ApiProperty({
    description: 'Role oferecida no convite',
    example: 'MEMBER',
    enum: ['MEMBER', 'VIEWER'],
  })
  role!: 'MEMBER' | 'VIEWER';

  @ApiProperty({
    description: 'ISO 8601 — data/hora de expiração do convite',
    example: '2026-05-21T00:00:00.000Z',
  })
  expiresAt!: string;
}
