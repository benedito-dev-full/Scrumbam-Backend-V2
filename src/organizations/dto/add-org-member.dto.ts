import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsIn } from 'class-validator';

/**
 * DTO para adicionar membro à organização (POST /organizations/:id/members).
 *
 * Cria DVincula idClasse=-162 (MEMBER) ou -163 (VIEWER) para o usuário na org.
 *
 * @example
 * ```typescript
 * const dto: AddOrgMemberDto = {
 *   userId: '12345',
 *   role: 'MEMBER'
 * };
 * ```
 */
export class AddOrgMemberDto {
  /**
   * ID da DEntidade do usuário a adicionar.
   *
   * Deve ser o `entidadeId` do usuário (não o userGroupId).
   */
  @ApiProperty({
    description: 'ID da DEntidade do usuário (entidadeId)',
    example: '12345',
  })
  @IsString()
  userId!: string;

  /**
   * Role do membro na organização.
   *
   * - MEMBER: acesso operacional (idClasse -162)
   * - VIEWER: leitura apenas (idClasse -163)
   *
   * Nota: ADMIN só pode ser definido via outros mecanismos (criador).
   */
  @ApiProperty({
    description: 'Role do membro na organização',
    example: 'MEMBER',
    enum: ['MEMBER', 'VIEWER'],
  })
  @IsString()
  @IsIn(['MEMBER', 'VIEWER'])
  role!: 'MEMBER' | 'VIEWER';
}
