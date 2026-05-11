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

  /**
   * Cor de identificação visual do time (hex `#RRGGBB`).
   *
   * Persistida em `DEntidade.dados.color`. Usada pelo frontend no avatar
   * quadrado do time. Aceita também `null` para limpar a cor.
   */
  @ApiPropertyOptional({
    description: 'Cor hex do time (#RRGGBB)',
    example: '#3B82F6',
    pattern: '^#[0-9A-Fa-f]{6}$',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'color deve ser hex no formato #RRGGBB',
  })
  color?: string | null;

  /**
   * Nome de ícone Lucide (opcional).
   *
   * Persistido em `DEntidade.dados.icon`.
   */
  @ApiPropertyOptional({
    description: 'Nome de ícone Lucide (ex: "rocket")',
    example: 'rocket',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string | null;
}
