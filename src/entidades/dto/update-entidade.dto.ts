import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEmail, IsBoolean } from 'class-validator';

/**
 * DTO para atualização de entidade (PATCH /entidades/:id).
 *
 * Todos os campos são opcionais. Apenas os campos enviados são atualizados.
 * O campo `idClasse` é intencionalmente AUSENTE — tipo de entidade é imutável.
 *
 * @example
 * ```json
 * // Atualizar email e telefone
 * { "email": "novo@empresa.com", "telefone": "(11) 3001-0001" }
 *
 * // Inativar entidade
 * { "inativo": true }
 * ```
 */
export class UpdateEntidadeDto {
  /**
   * Novo nome da entidade.
   */
  @ApiPropertyOptional({ description: 'Nome da entidade', example: 'João Silva Atualizado' })
  @IsOptional()
  @IsString()
  nome?: string;

  /**
   * Novo email.
   */
  @ApiPropertyOptional({ description: 'Email da entidade', example: 'novo@empresa.com' })
  @IsOptional()
  @IsEmail({}, { message: 'email deve ser um endereço de e-mail válido' })
  email?: string;

  /**
   * Novo código único.
   */
  @ApiPropertyOptional({ description: 'Código único', example: 'USR-002' })
  @IsOptional()
  @IsString()
  codigo?: string;

  /**
   * Novo CPF ou CNPJ.
   */
  @ApiPropertyOptional({ description: 'CPF ou CNPJ (sem formatação)', example: '12345678000190' })
  @IsOptional()
  @IsString()
  cpfCnpj?: string;

  /**
   * Novo telefone fixo.
   */
  @ApiPropertyOptional({ description: 'Telefone fixo', example: '(11) 3001-0001' })
  @IsOptional()
  @IsString()
  telefone?: string;

  /**
   * Novo celular / WhatsApp.
   */
  @ApiPropertyOptional({ description: 'Celular / WhatsApp', example: '(11) 99001-0001' })
  @IsOptional()
  @IsString()
  celular?: string;

  /**
   * Novo endereço.
   */
  @ApiPropertyOptional({ description: 'Endereço (logradouro)', example: 'Av. Paulista, 1000' })
  @IsOptional()
  @IsString()
  endereco?: string;

  /**
   * Novo bairro.
   */
  @ApiPropertyOptional({ description: 'Bairro', example: 'Bela Vista' })
  @IsOptional()
  @IsString()
  bairro?: string;

  /**
   * Novo CEP.
   */
  @ApiPropertyOptional({ description: 'CEP (sem formatação)', example: '01310100' })
  @IsOptional()
  @IsString()
  cep?: string;

  /**
   * Inativar/reativar entidade (soft inativação, sem excluir).
   */
  @ApiPropertyOptional({ description: 'Inativar ou reativar entidade', example: false })
  @IsOptional()
  @IsBoolean()
  inativo?: boolean;

  /**
   * Dados polimórficos específicos do tipo (merge com Json existente).
   */
  @ApiPropertyOptional({
    description: 'Dados adicionais (Json) — merge com existente',
    example: { timezone: 'America/Sao_Paulo' },
  })
  @IsOptional()
  dados?: Record<string, unknown>;
}
