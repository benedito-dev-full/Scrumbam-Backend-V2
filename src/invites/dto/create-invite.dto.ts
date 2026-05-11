import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString } from 'class-validator';

/**
 * DTO para criar convite de membro por email.
 *
 * Usado em `POST /organizations/:orgId/invites` (auth + ADMIN).
 *
 * Validacoes aplicadas via class-validator:
 * - email: formato RFC-compliant
 * - role: 'MEMBER' | 'VIEWER' (ADMIN nao se auto-eleva via convite — apenas
 *   outro ADMIN pode promover via endpoint dedicado, ADR-V2-003).
 *
 * @example
 * ```typescript
 * const dto: CreateInviteDto = {
 *   email: 'novo@empresa.com',
 *   role: 'MEMBER',
 * };
 * ```
 */
export class CreateInviteDto {
  /**
   * Email do convidado (formato RFC-compliant).
   *
   * Sera persistido em lowercase em `DTabela.nome` e usado para
   * deduplicacao de convites pendentes por (orgId, email).
   */
  @ApiProperty({
    description: 'Email do convidado',
    example: 'novo@empresa.com',
  })
  @IsEmail()
  email!: string;

  /**
   * Role do convidado na organizacao.
   *
   * - MEMBER: acesso operacional (idClasse DVincula -162).
   * - VIEWER: somente leitura (idClasse DVincula -163).
   *
   * ADMIN nao e permitido — promocao via endpoint separado.
   */
  @ApiProperty({
    description: 'Role na organizacao',
    example: 'MEMBER',
    enum: ['MEMBER', 'VIEWER'],
  })
  @IsString()
  @IsIn(['MEMBER', 'VIEWER'])
  role!: 'MEMBER' | 'VIEWER';
}
