import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

/**
 * DTO para atualização parcial de organização (PATCH /organizations/:id).
 *
 * Todos os campos são opcionais — apenas os presentes são atualizados.
 *
 * @example
 * ```typescript
 * const dto: UpdateOrganizationDto = {
 *   nome: 'Novo Nome'
 * };
 * ```
 */
export class UpdateOrganizationDto {
  /**
   * Novo nome da organização.
   */
  @ApiPropertyOptional({
    description: 'Novo nome da organização',
    example: 'Acme Corp v2',
    minLength: 2,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  nome?: string;

  /**
   * Nova descrição da organização.
   */
  @ApiPropertyOptional({
    description: 'Nova descrição da organização',
    example: 'Time atualizado',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
