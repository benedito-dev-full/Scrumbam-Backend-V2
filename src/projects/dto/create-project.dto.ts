import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para criação de projeto (DProject).
 *
 * Cria atomicamente:
 * 1. DProject (tabela canônica)
 * 2. DVincula -171 (PROJECT_ROLE_MANAGER) para o criador
 * 3. 9 DTabela statuses V3 padrão (INBOX a VALIDATED)
 * 4. 1 DTabela Sprint default ("Sprint 1")
 *
 * @example
 * ```typescript
 * const dto: CreateProjectDto = {
 *   nome: 'Scrumban Backend V2',
 *   prefix: 'DEV',
 *   description: 'Refundação canônica Devari-Core',
 *   orgId: '100',
 * };
 * ```
 */
export class CreateProjectDto {
  /**
   * Nome do projeto (obrigatório, 3-255 caracteres).
   */
  @ApiProperty({
    description: 'Nome do projeto',
    example: 'Scrumban Backend V2',
    minLength: 3,
    maxLength: 255,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  nome!: string;

  /**
   * Prefixo do identifier de tasks (ex: "DEV" → gera DEV-1, DEV-2...).
   * Máximo 8 caracteres. Default: "DEV".
   */
  @ApiPropertyOptional({
    description: 'Prefixo do identifier das tasks (ex: DEV → DEV-1, DEV-2...)',
    example: 'DEV',
    maxLength: 8,
    default: 'DEV',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  prefix?: string;

  /**
   * Descrição do projeto (opcional).
   */
  @ApiPropertyOptional({
    description: 'Descrição do projeto',
    example: 'Refundação canônica do Scrumban sob template Devari-Core',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /**
   * ID da organização pai (DEntidade -152).
   * Se fornecido, vincula o projeto à organização via DProject.idEstab.
   */
  @ApiPropertyOptional({
    description: 'ID da organização pai (DEntidade -152)',
    example: '100',
  })
  @IsOptional()
  @IsString()
  orgId?: string;

  /**
   * Se automação Claude Code está habilitada.
   */
  @ApiPropertyOptional({
    description: 'Habilitar automação Claude Code',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  automationEnabled?: boolean;

  /**
   * URL do repositório git.
   */
  @ApiPropertyOptional({
    description: 'URL do repositório git',
    example: 'https://github.com/org/repo',
  })
  @IsOptional()
  @IsUrl()
  gitRepo?: string;
}
