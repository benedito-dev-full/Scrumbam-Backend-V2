import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsIn } from 'class-validator';

/**
 * DTO para adicionar membro ao time (POST /teams/:id/members).
 *
 * Cria DVincula idClasse=-181 (TEAM_MEMBERSHIP) com cargo LEAD ou MEMBER.
 *
 * @example
 * ```typescript
 * const dto: AddTeamMemberDto = { userId: '12345', cargo: 'MEMBER' };
 * ```
 */
export class AddTeamMemberDto {
  /**
   * ID da DEntidade do usuário a adicionar.
   */
  @ApiProperty({
    description: 'ID da DEntidade do usuário (entidadeId)',
    example: '12345',
  })
  @IsString()
  userId!: string;

  /**
   * Cargo no time.
   *
   * - LEAD: líder do time (pode gerenciar membros)
   * - MEMBER: membro regular
   */
  @ApiProperty({
    description: 'Cargo no time',
    example: 'MEMBER',
    enum: ['LEAD', 'MEMBER'],
  })
  @IsString()
  @IsIn(['LEAD', 'MEMBER'])
  cargo!: 'LEAD' | 'MEMBER';
}
