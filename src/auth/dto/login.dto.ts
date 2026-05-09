import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * DTO para login via email + senha.
 *
 * Validações:
 * - email: string, formato email válido
 * - password: string, mínimo 8 caracteres
 *
 * @example
 * ```typescript
 * const dto: LoginDto = { email: 'user@empresa.com', password: 'senha123' };
 * ```
 */
export class LoginDto {
  /**
   * Email do usuário (DUserGroup.usuario).
   * Armazenado em lower-case — case-insensitive no login.
   */
  @ApiProperty({ description: 'Email do usuário', example: 'user@empresa.com' })
  @IsEmail({}, { message: 'Email inválido' })
  email!: string;

  /**
   * Senha em texto plano — bcrypt.compare com hash armazenado.
   * NUNCA logada em nenhum nível.
   */
  @ApiProperty({ description: 'Senha (mín. 8 caracteres)', example: 'senha123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Senha deve ter no mínimo 8 caracteres' })
  password!: string;
}
