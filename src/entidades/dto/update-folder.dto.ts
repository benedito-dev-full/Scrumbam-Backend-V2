import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO para renomeação de Folder (PATCH /entidades/folders/:id).
 *
 * Apenas `nome` é editável no MVP (cor/ícone OUT — CEO Q2; ordem
 * manual OUT — CEO Q3). organizationId é imutável (folder não migra
 * entre orgs).
 *
 * @example
 * ```typescript
 * const dto: UpdateFolderDto = { nome: 'Cliente Acme — Renomeado' };
 * ```
 *
 * @see ADR-V2-FOLDERS-001
 */
export class UpdateFolderDto {
  /**
   * Novo nome da pasta (1..100 chars).
   */
  @ApiPropertyOptional({
    description: 'Novo nome da pasta',
    example: 'Cliente Acme — Renomeado',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nome?: string;
}
