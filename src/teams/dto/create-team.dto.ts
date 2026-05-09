import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional, Matches } from 'class-validator';

/**
 * DTO para criação de time (POST /organizations/:orgId/teams).
 *
 * Cria DEntidade idClasse=-180 (TEAM) + DTabela -475 (ISSUE_COUNTER)
 * + DVincula -181 (TEAM_MEMBERSHIP LEAD) em transaction atômica.
 *
 * O prefixo deve ser único por organização.
 *
 * @example
 * ```typescript
 * const dto: CreateTeamDto = {
 *   nome: 'Backend Team',
 *   prefix: 'BACK'
 * };
 * ```
 */
export class CreateTeamDto {
  /**
   * Nome do time.
   */
  @ApiProperty({
    description: 'Nome do time',
    example: 'Backend Team',
    minLength: 2,
    maxLength: 255,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  nome!: string;

  /**
   * Prefixo do issue counter (ex: BACK → BACK-1, BACK-2...).
   *
   * Deve ser único por organização. Apenas letras maiúsculas e hífens.
   * Default 'DEV' se não informado.
   */
  @ApiPropertyOptional({
    description: 'Prefixo do issue counter (ex: BACK → BACK-1). Único por org.',
    example: 'BACK',
    pattern: '^[A-Z][A-Z0-9-]{0,9}$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9-]{0,9}$/, {
    message: 'prefix deve conter apenas letras maiúsculas, números e hífens (ex: BACK, DEV-2)',
  })
  prefix?: string;

  /**
   * Descrição opcional do time.
   */
  @ApiPropertyOptional({
    description: 'Descrição do time',
    example: 'Responsável pelo backend da plataforma',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
