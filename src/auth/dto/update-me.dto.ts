import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { UserPreferencesDto } from './user-preferences.dto';

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

  /**
   * Preferências pessoais do usuário (tema, idioma, notificações).
   *
   * Persistidas em `DEntidade.dados.preferences`. Merge por chave de 1º nível:
   * mandar `appearance` substitui o bloco appearance inteiro mas não toca
   * `locale` ou `notifications`. Campos ausentes não são alterados.
   *
   * @see UserPreferencesDto — shape completo dos sub-blocos.
   */
  @ApiPropertyOptional({
    description: 'Preferências de UI/notificações (merge por chave de 1º nível)',
    type: () => UserPreferencesDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UserPreferencesDto)
  preferences?: UserPreferencesDto;

  /**
   * Senha atual — obrigatória apenas quando `newPassword` é fornecido.
   * Validada via bcrypt no service antes de aplicar a troca.
   */
  @ApiPropertyOptional({
    description: 'Senha atual (obrigatória se trocar senha)',
    example: 'senhaAtual123',
  })
  @ValidateIf((o: UpdateMeDto) => o.newPassword !== undefined)
  @IsString()
  @MinLength(8, { message: 'Senha atual deve ter pelo menos 8 caracteres' })
  currentPassword?: string;

  /**
   * Nova senha (mín. 8 caracteres). Exige `currentPassword` para validação.
   */
  @ApiPropertyOptional({
    description: 'Nova senha (mínimo 8 caracteres)',
    example: 'novaSenha456',
  })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Nova senha deve ter pelo menos 8 caracteres' })
  newPassword?: string;
}
