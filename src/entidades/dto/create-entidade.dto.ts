import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEmail,
  IsNumberString,
} from 'class-validator';

/**
 * DTO para criação de entidade (POST /entidades).
 *
 * @example
 * ```json
 * { "idClasse": "-150", "nome": "João Silva", "email": "joao@empresa.com" }
 * ```
 */
export class CreateEntidadeDto {
  /** ID da DClasse (imutável após criação). Ex: -150 (USER), -152 (ORG). */
  @ApiProperty({ description: 'ID da DClasse. Ex: -150 (USER), -152 (ORG)', example: '-150' })
  @IsNotEmpty()
  @IsNumberString({}, { message: 'idClasse deve ser um número inteiro' })
  idClasse!: string;

  /** Nome da entidade (obrigatório). */
  @ApiProperty({ description: 'Nome', example: 'João Silva' })
  @IsNotEmpty()
  @IsString()
  nome!: string;

  /** Email (recomendado para USER). */
  @ApiPropertyOptional({ description: 'Email', example: 'joao@empresa.com' })
  @IsOptional()
  @IsEmail({}, { message: 'email deve ser um endereço de e-mail válido' })
  email?: string;

  /** Código único (CNPJ, CPF, slug, código interno). */
  @ApiPropertyOptional({ description: 'Código único', example: 'USR-001' })
  @IsOptional()
  @IsString()
  codigo?: string;

  /** CPF ou CNPJ (sem formatação). */
  @ApiPropertyOptional({ description: 'CPF ou CNPJ (sem formatação)', example: '12345678000190' })
  @IsOptional()
  @IsString()
  cpfCnpj?: string;

  /** Telefone fixo. */
  @ApiPropertyOptional({ description: 'Telefone fixo', example: '(11) 3000-0000' })
  @IsOptional()
  @IsString()
  telefone?: string;

  /** Celular / WhatsApp. */
  @ApiPropertyOptional({ description: 'Celular / WhatsApp', example: '(11) 99000-0000' })
  @IsOptional()
  @IsString()
  celular?: string;

  /** Endereço (logradouro). */
  @ApiPropertyOptional({ description: 'Endereço', example: 'Rua das Flores, 100' })
  @IsOptional()
  @IsString()
  endereco?: string;

  /** Bairro. */
  @ApiPropertyOptional({ description: 'Bairro', example: 'Centro' })
  @IsOptional()
  @IsString()
  bairro?: string;

  /** CEP (sem formatação). */
  @ApiPropertyOptional({ description: 'CEP', example: '01310100' })
  @IsOptional()
  @IsString()
  cep?: string;

  /** Chave da entidade pai na hierarquia (idEstab). */
  @ApiPropertyOptional({ description: 'Chave da entidade pai (idEstab)', example: '100' })
  @IsOptional()
  @IsNumberString({}, { message: 'idEstab deve ser um número inteiro' })
  idEstab?: string;

  /** Chave do local de escrituração (dono operacional). */
  @ApiPropertyOptional({ description: 'Chave do local de escrituração', example: '50' })
  @IsOptional()
  @IsNumberString({}, { message: 'idLocEscritu deve ser um número inteiro' })
  idLocEscritu?: string;

  /** Dados polimórficos específicos do tipo (Json livre). */
  @ApiPropertyOptional({ description: 'Dados adicionais (Json)', example: { hostname: 'agent-01.devari.com' } })
  @IsOptional()
  dados?: Record<string, unknown>;
}
