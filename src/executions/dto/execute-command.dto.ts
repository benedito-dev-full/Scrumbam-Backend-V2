import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Comando estruturado aceito pela F13.
 * Shell string livre nao faz parte do contrato externo.
 */
export class StructuredCommandDto {
  @ApiProperty({
    description: 'Executavel permitido pela allowlist',
    example: 'npm',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(64)
  executable!: string;

  @ApiProperty({
    description: 'Argumentos passados sem shell e sem metacaracteres',
    example: ['test', '--', '--runInBand'],
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  @MaxLength(512, { each: true })
  args!: string[];

  @ApiPropertyOptional({
    description: 'Working directory relativo ao remotePath do projeto',
    example: 'src/auth',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cwd?: string;

  @ApiPropertyOptional({
    description: 'Variaveis de ambiente allowlisted',
    example: { NODE_ENV: 'test', CI: 'true' },
  })
  @IsOptional()
  @IsObject()
  env?: Record<string, string>;

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
}

/**
 * DTO para criacao de execution Claude Code em um projeto.
 *
 * Bloco C/F13: a entrada externa aceita somente command estruturado.
 */
export class ExecuteCommandDto {
  @ApiProperty({
    description: 'Comando estruturado executado sem shell',
    type: StructuredCommandDto,
  })
  @ValidateNested()
  @Type(() => StructuredCommandDto)
  command!: StructuredCommandDto;

  @ApiPropertyOptional({
    description: 'Agent esperado. Se informado, deve bater com o primary ativo do projeto.',
    example: '456',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    description: 'Habilita rollback conservador em falha',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  rollbackOnFailure?: boolean;

  @ApiPropertyOptional({
    description: 'ID da task associada (string do BigInt)',
    example: '42',
  })
  @IsOptional()
  @IsString()
  taskId?: string;
}
