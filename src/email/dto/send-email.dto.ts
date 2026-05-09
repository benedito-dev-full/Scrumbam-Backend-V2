import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

/**
 * DTO para envio de email.
 *
 * Validações aplicadas via class-validator:
 * - `to`: email válido, obrigatório
 * - `subject`: string, obrigatório
 * - `html`: string HTML, obrigatório
 * - `text`: texto plano, opcional (fallback para clientes que não suportam HTML)
 * - `from`: email do remetente, opcional (usa default do provider)
 *
 * @example
 * ```typescript
 * const dto: SendEmailDto = {
 *   to: 'usuario@example.com',
 *   subject: 'Bem-vindo!',
 *   html: '<h1>Olá!</h1>',
 *   text: 'Olá!',
 * };
 * ```
 */
export class SendEmailDto {
  /**
   * Endereço de email do destinatário.
   */
  @ApiProperty({
    description: 'Endereço de email do destinatário',
    example: 'usuario@example.com',
  })
  @IsEmail({}, { message: 'to deve ser um endereço de email válido' })
  to!: string;

  /**
   * Assunto do email.
   */
  @ApiProperty({
    description: 'Assunto do email',
    example: 'Bem-vindo ao Scrumban!',
  })
  @IsString()
  subject!: string;

  /**
   * Corpo HTML do email.
   */
  @ApiProperty({
    description: 'Corpo HTML do email',
    example: '<h1>Olá, usuário!</h1>',
  })
  @IsString()
  html!: string;

  /**
   * Corpo em texto plano (fallback para clientes sem suporte a HTML).
   */
  @ApiPropertyOptional({
    description: 'Corpo em texto plano (fallback)',
    example: 'Olá, usuário!',
  })
  @IsOptional()
  @IsString()
  text?: string;

  /**
   * Endereço de email do remetente customizado.
   *
   * Se omitido, usa o default configurado no provider via variável de ambiente.
   */
  @ApiPropertyOptional({
    description: 'Remetente customizado (usa default do provider se omitido)',
    example: 'noreply@minha-empresa.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'from deve ser um endereço de email válido' })
  from?: string;
}
