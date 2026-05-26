import { IsEnum, IsIn, IsISO8601, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para criação de task (DTask).
 *
 * Ao criar, o identifier DEV-N é gerado atomicamente via DTabela -475.
 * O estado inicial é sempre INBOX.
 *
 * @example
 * ```typescript
 * const dto: CreateTaskDto = {
 *   nome: 'Implementar autenticação JWT',
 *   projectId: '1',
 *   priority: 'HIGH',
 * };
 * ```
 */
export class CreateTaskDto {
  @ApiProperty({
    description: 'Nome/título da task',
    example: 'Implementar autenticação JWT',
    minLength: 3,
    maxLength: 512,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(512)
  nome!: string;

  @ApiProperty({
    description: 'ID do projeto (chave DProject)',
    example: '1',
  })
  @IsString()
  projectId!: string;

  @ApiPropertyOptional({
    description: 'Descrição detalhada da task',
    example: 'Implementar JWT com refresh token usando DUserGroup',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  descricao?: string;

  @ApiPropertyOptional({
    description: 'Prioridade da task — alinhada com seed canônico DTabela -421..-424 (V2)',
    enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
    example: 'MEDIUM',
  })
  @IsOptional()
  @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: string;

  @ApiPropertyOptional({
    description: 'ID do assignee (chave DEntidade)',
    example: '100',
  })
  @IsOptional()
  @IsString()
  assigneeId?: string;

  @ApiPropertyOptional({
    description: 'ID do sprint (chave DTabela -400)',
    example: '1',
  })
  @IsOptional()
  @IsString()
  sprintId?: string;

  @ApiPropertyOptional({
    description: 'Texto bruto da captura (Telegram, etc.)',
    example: 'via telegram',
  })
  @IsOptional()
  @IsString()
  rawText?: string;

  @ApiPropertyOptional({
    description: 'Fonte da captura',
    enum: ['telegram', 'web', 'api', 'mcp'],
    example: 'web',
  })
  @IsOptional()
  @IsEnum(['telegram', 'web', 'api', 'mcp'])
  source?: string;

  @ApiPropertyOptional({
    description: 'Tipo da task (persistido em dados.taskType; exposto no top-level do response)',
    enum: ['FEATURE', 'BUG', 'IMPROVEMENT', 'REVIEW', 'EXPLAIN'],
    example: 'BUG',
  })
  @IsOptional()
  @IsIn(['FEATURE', 'BUG', 'IMPROVEMENT', 'REVIEW', 'EXPLAIN'])
  taskType?: string;

  @ApiPropertyOptional({
    description:
      'ID da task pai (DTask.chave) — hierarquia de fases (ADR-V2-047). ' +
      'Quando omitido, a task fica na raiz (sem pai).',
    example: '5',
  })
  @IsOptional()
  @IsString()
  idPai?: string;

  @ApiPropertyOptional({
    description:
      'idClasse polimórfica da DTask. Default: "-154" (SCRUMBAN_TASK). Use ' +
      '"-200" para criar FASE/BLOCO (ADR-V2-047 / ADR-V2-050). Quando "-200", ' +
      'os campos `assigneeId`, `sprintId`, `priority` e `taskType` são ' +
      'IGNORADOS silenciosamente (fase é agrupador, sem intention própria). ' +
      'Se `idPai` for informado para uma fase, o pai DEVE ser outra fase (-200) ' +
      '— sub-fase.',
    enum: ['-154', '-200'],
    example: '-200',
    default: '-154',
  })
  @IsOptional()
  @IsString()
  @IsIn(['-154', '-200'], { message: 'idClasse deve ser "-154" (TASK) ou "-200" (PHASE).' })
  idClasse?: string;

  @ApiPropertyOptional({
    description:
      'Data limite da task (due date) no formato ISO 8601 (ex: "2026-06-30" ou ' +
      '"2026-06-30T23:59:59.000Z"). Persistida como DateTime? na coluna DTask.dueDate ' +
      '(D1 — Bloco D integração frontend V2). Aceita date-only ou datetime completo.',
    example: '2026-06-30',
  })
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @ApiPropertyOptional({
    description:
      'Campos extras polimórficos (Opção A). Aceita `{ idBloco: string }` para ' +
      'vincular a task a um bloco (idClasse=-200) sem usar idPai.',
    example: { idBloco: '42' },
  })
  @IsOptional()
  @IsObject()
  dados?: Record<string, unknown>;
}
