import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
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
 * DTO para criação de execution Claude Code em um projeto.
 *
 * ADR-V2-049: o body aceita 2 modos canônicos + 1 híbrido (debug):
 *
 *  1. **Modo PROMPT (preferido):** `{ taskId }` — backend monta prompt natural
 *     via `PromptBuilderService` a partir da `DTask`. `command` é gerado
 *     internamente como placeholder estruturado.
 *  2. **Modo COMMAND (legado, mantido p/ MCP/CLI):** `{ command: {...} }` —
 *     contrato F13 original. Backend usa o command literalmente.
 *  3. **Modo HÍBRIDO (debug):** `{ taskId, command }` — `command` vence; `taskId`
 *     fica apenas como metadado em `dados.task.id` (audit trail).
 *
 * Validação cross-field (via `@ValidateIf`): pelo menos UM dos dois (`taskId`
 * ou `command`) é obrigatório. Se ambos ausentes → 400 BadRequest.
 *
 * @see docs/decisions/ADR-V2-049-prompt-builder-canonico.md
 */
export class ExecuteCommandDto {
  @ApiPropertyOptional({
    description:
      'Comando estruturado executado sem shell (modo COMMAND). Obrigatório se taskId ausente.',
    type: StructuredCommandDto,
  })
  @ValidateIf((o: ExecuteCommandDto) => !o.taskId)
  @ValidateNested()
  @IsObject({ message: 'command obrigatório quando taskId ausente' })
  @Type(() => StructuredCommandDto)
  command?: StructuredCommandDto;

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
    description:
      'ID da task associada (string do BigInt). Modo PROMPT: backend monta prompt natural via PromptBuilder. Obrigatório se command ausente.',
    example: '42',
  })
  @ValidateIf((o: ExecuteCommandDto) => !o.command)
  @IsString({ message: 'taskId obrigatório quando command ausente' })
  @IsNotEmpty({ message: 'taskId obrigatório quando command ausente' })
  // Reviewer fix R2: garante que taskId é numérico (BigInt como string).
  // Sem isso, `{ taskId: "abc" }` → `BigInt("abc")` lança SyntaxError não-tratado
  // que vira HTTP 500. Com `@Matches`, vira 400 BadRequest limpo no ValidationPipe.
  @Matches(/^\d+$/, { message: 'taskId deve ser numérico (BigInt como string)' })
  taskId?: string;
}
