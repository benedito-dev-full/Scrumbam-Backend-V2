import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * DTO para execução de comando Claude Code em um projeto.
 *
 * Validações:
 * - text: string obrigatória entre 10 e 50000 caracteres
 * - cwd: string opcional (working directory relativo ao remotePath)
 * - timeoutMs: inteiro opcional entre 30000ms (30s) e 3600000ms (1h)
 * - taskId: string opcional (BigInt como string da DTask associada)
 */
export class ExecuteCommandDto {
  /**
   * Prompt/comando para o Claude Code.
   * Mínimo 10 caracteres para evitar comandos triviais, máximo 50000.
   */
  @ApiProperty({
    description: 'Prompt/comando para o Claude Code',
    example: 'adicione testes unitários para o AuthService cobrindo o fluxo de login',
    minLength: 10,
    maxLength: 50000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(50000)
  text!: string;

  /**
   * Working directory relativo ao remotePath do projeto.
   * Se ausente, usa o remotePath raiz do projeto.
   */
  @ApiPropertyOptional({
    description: 'Working directory relativo ao remotePath do projeto',
    example: 'src/auth',
  })
  @IsOptional()
  @IsString()
  cwd?: string;

  /**
   * Timeout em ms (default: 600000 = 10min).
   * Mínimo: 30s (para evitar timeouts imediatos).
   * Máximo: 1h.
   */
  @ApiPropertyOptional({
    description: 'Timeout em ms (default: 600000 = 10min)',
    example: 300000,
    minimum: 30000,
    maximum: 3600000,
  })
  @IsOptional()
  @IsInt()
  @Min(30000)
  @Max(3600000)
  @Type(() => Number)
  timeoutMs?: number;

  /**
   * ID da task associada (BigInt como string).
   * Opcional — se presente, vincula a execution à DTask.
   */
  @ApiPropertyOptional({
    description: 'ID da task associada (string do BigInt)',
    example: '42',
  })
  @IsOptional()
  @IsString()
  taskId?: string;
}
