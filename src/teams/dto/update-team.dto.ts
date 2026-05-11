import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional, Matches } from 'class-validator';

/**
 * DTO para atualização parcial de time (PATCH /teams/:id).
 *
 * Todos os campos são opcionais.
 *
 * @example
 * ```typescript
 * const dto: UpdateTeamDto = { nome: 'Novo Nome' };
 * ```
 */
export class UpdateTeamDto {
  @ApiPropertyOptional({
    description: 'Novo nome do time',
    example: 'Frontend Team',
    minLength: 2,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  nome?: string;

  @ApiPropertyOptional({
    description: 'Nova descrição do time',
    example: 'Responsável pelo frontend',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /**
   * Nova cor hex do time (`#RRGGBB`). Aceita `null` para limpar.
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
   * Novo ícone Lucide. Aceita `null` para limpar.
   */
  @ApiPropertyOptional({
    description: 'Nome de ícone Lucide',
    example: 'rocket',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string | null;
}
