import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO para criação de permissão granular em DPermissao.
 *
 * Permissões granulares complementam o RBAC de roles (ADR-V2-003).
 * Enquanto roles definem acesso geral (ADMIN/MEMBER/VIEWER),
 * DPermissao permite fine-grained access control por recurso+ação.
 *
 * @example
 * ```typescript
 * const dto: CreatePermissaoDto = {
 *   dUserGroupId: '1',
 *   recurso: '/api/v1/projects',
 *   acao: 'DELETE',
 *   permitido: false,
 * };
 * ```
 */
export class CreatePermissaoDto {
  /** Chave BigInt do DUserGroup (string). */
  @ApiProperty({ description: 'ID do DUserGroup', example: '1' })
  @IsString()
  @IsNotEmpty()
  dUserGroupId!: string;

  /** Recurso (endpoint, módulo ou ação). */
  @ApiProperty({ description: 'Recurso protegido (ex: /api/v1/projects)', example: '/api/v1/projects' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  recurso!: string;

  /** Ação no recurso. */
  @ApiProperty({ description: 'Ação (ex: DELETE, EXPORT)', example: 'DELETE' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  acao!: string;

  /** Conceder (true) ou negar (false) a permissão. */
  @ApiProperty({ description: 'Permitido?', example: true })
  @IsBoolean()
  permitido!: boolean;

  /** Metadados adicionais (contexto, condições). */
  @ApiPropertyOptional({ description: 'Metadados adicionais (JSON livre)' })
  @IsOptional()
  metaDados?: Record<string, unknown>;
}
