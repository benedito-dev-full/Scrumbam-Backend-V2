import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para atualização parcial de projeto (PATCH /projects/:id).
 *
 * Todos os campos são opcionais. Apenas MANAGER pode atualizar.
 *
 * @example
 * ```typescript
 * const dto: UpdateProjectDto = {
 *   nome: 'Novo Nome',
 *   automationEnabled: true,
 * };
 * ```
 */
export class UpdateProjectDto {
  @ApiPropertyOptional({
    description: 'Novo nome do projeto',
    example: 'Scrumban V2 — Novo Nome',
    minLength: 3,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  nome?: string;

  @ApiPropertyOptional({
    description: 'Nova descrição do projeto',
    example: 'Descrição atualizada',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Habilitar ou desabilitar automação Claude Code',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  automationEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'URL do repositório git',
    example: 'https://github.com/org/novo-repo',
  })
  @IsOptional()
  @IsUrl()
  gitRepo?: string;

  @ApiPropertyOptional({
    description: 'Prefixo do identifier das tasks',
    example: 'FEAT',
    maxLength: 8,
  })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  prefix?: string;
}
