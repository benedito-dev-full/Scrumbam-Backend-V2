import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para adicionar membro ao projeto.
 *
 * Cria DVincula -171 (MANAGER), -172 (MEMBER) ou -173 (VIEWER).
 *
 * @example
 * ```typescript
 * const dto: AddProjectMemberDto = {
 *   userId: '200',
 *   role: 'MEMBER',
 *   cargo: 'Backend Engineer',
 * };
 * ```
 */
export class AddProjectMemberDto {
  @ApiProperty({
    description: 'ID da DEntidade do usuário a adicionar',
    example: '200',
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    description: 'Role do membro no projeto',
    enum: ['MANAGER', 'MEMBER', 'VIEWER'],
    example: 'MEMBER',
  })
  @IsEnum(['MANAGER', 'MEMBER', 'VIEWER'])
  role!: 'MANAGER' | 'MEMBER' | 'VIEWER';

  @ApiPropertyOptional({
    description: 'Cargo customizado (ex: Backend Engineer)',
    example: 'Backend Engineer',
  })
  @IsOptional()
  @IsString()
  cargo?: string;
}

/**
 * DTO para atualizar role/cargo de membro no projeto.
 */
export class UpdateProjectMemberDto {
  @ApiProperty({
    description: 'Novo role do membro',
    enum: ['MANAGER', 'MEMBER', 'VIEWER'],
    example: 'MANAGER',
  })
  @IsEnum(['MANAGER', 'MEMBER', 'VIEWER'])
  role!: 'MANAGER' | 'MEMBER' | 'VIEWER';

  @ApiPropertyOptional({
    description: 'Novo cargo customizado',
    example: 'Tech Lead',
  })
  @IsOptional()
  @IsString()
  cargo?: string;
}
