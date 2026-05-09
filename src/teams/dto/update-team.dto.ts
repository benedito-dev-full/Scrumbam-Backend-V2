import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

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
}
