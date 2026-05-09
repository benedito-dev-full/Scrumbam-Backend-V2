import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

/**
 * DTO para cadastro de novo usuário com criação automática de organização.
 *
 * O register cria em transaction atômica:
 * 1. DUserGroup (-46) — credenciais
 * 2. DEntidade (-150) — perfil do usuário
 * 3. DEntidade (-152) — organização (nome = organizationName ?? `${name}'s Org`)
 * 4. DVincula (-161) — vínculo ADMIN da org para o usuário
 * 5. DEvento (-501) — audit trail de register
 *
 * @example
 * ```typescript
 * const dto: RegisterDto = {
 *   name: 'João Silva',
 *   email: 'joao@empresa.com',
 *   password: 'senha123',
 *   organizationName: 'Empresa ABC',
 * };
 * ```
 */
export class RegisterDto {
  /**
   * Nome completo do usuário (DEntidade.nome).
   */
  @ApiProperty({ description: 'Nome completo do usuário', example: 'João Silva' })
  @IsString()
  @MinLength(2, { message: 'Nome deve ter no mínimo 2 caracteres' })
  @MaxLength(255, { message: 'Nome deve ter no máximo 255 caracteres' })
  name!: string;

  /**
   * Email do usuário (DUserGroup.usuario — único no banco).
   */
  @ApiProperty({ description: 'Email do usuário', example: 'joao@empresa.com' })
  @IsEmail({}, { message: 'Email inválido' })
  email!: string;

  /**
   * Senha em texto plano — será hashada com bcrypt rounds=12.
   * NUNCA logada em nenhum nível.
   */
  @ApiProperty({ description: 'Senha (mín. 8 caracteres)', example: 'senha123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Senha deve ter no mínimo 8 caracteres' })
  password!: string;

  /**
   * Nome da organização criada automaticamente.
   * Se ausente, usa `${name}'s Org`.
   */
  @ApiPropertyOptional({ description: "Nome da organização (default: '{name}'s Org')", example: 'Empresa ABC' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  organizationName?: string;
}
