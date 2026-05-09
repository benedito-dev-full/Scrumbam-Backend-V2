import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO para atualização do perfil do usuário autenticado (PATCH /auth/me).
 *
 * Todos os campos são opcionais — apenas campos presentes são atualizados.
 * `email` altera DUserGroup.usuario e DEntidade.email em conjunto.
 *
 * @example
 * ```typescript
 * const dto: UpdateMeDto = { name: 'João Novo', onboardingCompleted: true };
 * ```
 */
export class UpdateMeDto {
  /**
   * Novo nome completo do usuário.
   */
  @ApiPropertyOptional({ description: 'Nome completo', example: 'João Silva Jr.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  /**
   * Novo email — atualiza DUserGroup.usuario e DEntidade.email.
   * Verificação de duplicidade aplicada.
   */
  @ApiPropertyOptional({ description: 'Email', example: 'novo@empresa.com' })
  @IsOptional()
  @IsEmail({}, { message: 'Email inválido' })
  email?: string;

  /**
   * Chave do projeto padrão do usuário (stored em DEntidade.dados.defaultProjectId).
   */
  @ApiPropertyOptional({ description: 'ID do projeto padrão', example: '10' })
  @IsOptional()
  @IsString()
  defaultProjectId?: string;

  /**
   * Chave do time padrão do usuário (stored em DEntidade.dados.defaultTeamId).
   */
  @ApiPropertyOptional({ description: 'ID do time padrão', example: '20' })
  @IsOptional()
  @IsString()
  defaultTeamId?: string;

  /**
   * Indica se o usuário completou o onboarding (DEntidade.dados.onboardingCompleted).
   */
  @ApiPropertyOptional({ description: 'Onboarding completo?', example: true })
  @IsOptional()
  @IsBoolean()
  onboardingCompleted?: boolean;
}
