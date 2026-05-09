import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

/**
 * DTO para criação de organização (POST /organizations).
 *
 * Cria DEntidade idClasse=-152 (ORGANIZATION) + Default Team + Issue Counter
 * + DVincula ADMIN em transaction atômica.
 *
 * Validações:
 * - nome: string obrigatório, 2-255 caracteres
 * - description: string opcional, até 500 caracteres
 *
 * @example
 * ```typescript
 * const dto: CreateOrganizationDto = {
 *   nome: 'Minha Empresa',
 *   description: 'Time de desenvolvimento'
 * };
 * ```
 */
export class CreateOrganizationDto {
  /**
   * Nome da organização.
   *
   * Deve ter entre 2 e 255 caracteres.
   */
  @ApiProperty({
    description: 'Nome da organização',
    example: 'Acme Corp',
    minLength: 2,
    maxLength: 255,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  nome!: string;

  /**
   * Descrição opcional da organização.
   */
  @ApiPropertyOptional({
    description: 'Descrição da organização',
    example: 'Time de desenvolvimento de software',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
