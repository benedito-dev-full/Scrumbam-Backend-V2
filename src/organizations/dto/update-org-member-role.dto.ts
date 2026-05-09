import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsIn } from 'class-validator';

/**
 * DTO para atualizar cargo de membro na organização (PATCH /organizations/:id/members/:userId).
 *
 * Atualiza o `metaDados.cargo` do DVincula correspondente.
 *
 * @example
 * ```typescript
 * const dto: UpdateOrgMemberRoleDto = {
 *   role: 'ADMIN'
 * };
 * ```
 */
export class UpdateOrgMemberRoleDto {
  /**
   * Novo role do membro na organização.
   *
   * - ADMIN: acesso total (idClasse -161)
   * - MEMBER: acesso operacional (idClasse -162)
   * - VIEWER: leitura apenas (idClasse -163)
   */
  @ApiProperty({
    description: 'Novo role do membro na organização',
    example: 'ADMIN',
    enum: ['ADMIN', 'MEMBER', 'VIEWER'],
  })
  @IsString()
  @IsIn(['ADMIN', 'MEMBER', 'VIEWER'])
  role!: 'ADMIN' | 'MEMBER' | 'VIEWER';
}
