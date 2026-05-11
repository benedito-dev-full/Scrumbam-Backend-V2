import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO para aceitar convite e completar onboarding.
 *
 * Usado em `POST /invites/:token/accept` (publico).
 *
 * Validacoes:
 * - name: 2-100 chars (DEntidade.nome).
 * - password: minimo 8 caracteres (mesma policy do `RegisterDto`).
 *
 * O email do novo usuario vem do proprio convite (DTabela.nome). O token
 * em path param e usado para localizar o convite (via hash SHA-256).
 *
 * @example
 * ```typescript
 * const dto: AcceptInviteDto = {
 *   name: 'Maria Souza',
 *   password: 'senha123',
 * };
 * ```
 */
export class AcceptInviteDto {
  /**
   * Nome completo do novo usuario (DEntidade.nome + DUserGroup.nome).
   */
  @ApiProperty({
    description: 'Nome completo do novo usuario',
    example: 'Maria Souza',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @MinLength(2, { message: 'Nome deve ter no minimo 2 caracteres' })
  @MaxLength(100, { message: 'Nome deve ter no maximo 100 caracteres' })
  name!: string;

  /**
   * Senha em texto plano — sera hashada com bcrypt rounds=12.
   * Mesma policy do `RegisterDto`.
   */
  @ApiProperty({
    description: 'Senha (minimo 8 caracteres)',
    example: 'senha123',
    minLength: 8,
  })
  @IsString()
  @MinLength(8, { message: 'Senha deve ter no minimo 8 caracteres' })
  password!: string;
}
