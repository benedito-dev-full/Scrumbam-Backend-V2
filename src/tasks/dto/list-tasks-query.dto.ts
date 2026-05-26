import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';

/**
 * DTO para query de listagem de tasks (GET /tasks).
 *
 * Suporta filtros por projectId, status, assignee, sprint e — desde a Fase 4
 * de ADR-V2-047 — filtros hierárquicos (`idPai`, `idClasse`, `depth`).
 *
 * Cursor pagination decrescente por chave.
 *
 * @example
 * ```typescript
 * const query: ListTasksQueryDto = {
 *   projectId: '1',
 *   status: 'INBOX',
 *   limit: 20,
 * };
 *
 * // Listar filhas diretas de uma fase
 * const query2: ListTasksQueryDto = { idPai: '5', limit: 50 };
 *
 * // Listar apenas as fases (idClasse=-200) de um projeto
 * const query3: ListTasksQueryDto = { projectId: '1', idClasse: '-200' };
 *
 * // Listar descendentes até 3 níveis de profundidade
 * const query4: ListTasksQueryDto = { idPai: '5', depth: 3 };
 * ```
 */
export class ListTasksQueryDto {
  @ApiPropertyOptional({ description: 'Filtrar por projeto (chave DProject)', example: '1' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por status V3',
    enum: [
      'INBOX',
      'READY',
      'EXECUTING',
      'DONE',
      'FAILED',
      'CANCELLED',
      'DISCARDED',
      'VALIDATING',
      'VALIDATED',
    ],
    example: 'INBOX',
  })
  @IsOptional()
  @IsEnum([
    'INBOX',
    'READY',
    'EXECUTING',
    'DONE',
    'FAILED',
    'CANCELLED',
    'DISCARDED',
    'VALIDATING',
    'VALIDATED',
  ])
  status?: string;

  /**
   * Filtro interno para callers de service que precisam buscar mais de um status.
   * O controller HTTP continua expondo `status` como contrato publico simples.
   *
   * @IsOptional+@IsArray pra evitar 400 do ValidationPipe (forbidNonWhitelisted)
   * quando o TS materializa o campo como `undefined` na instancia do DTO.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  statuses?: string[];

  /**
   * Filtro interno para callers de service que precisam limitar a listagem a
   * varios projetos ja autorizados. O controller HTTP continua expondo apenas
   * `projectId` como contrato publico simples.
   *
   * Mesmo motivo: anotacoes para nao quebrar a whitelist do ValidationPipe.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  projectIds?: string[];

  @ApiPropertyOptional({ description: 'Filtrar por assignee (chave DEntidade)', example: '100' })
  @IsOptional()
  @IsString()
  assigneeId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por sprint (chave DTabela -400)', example: '1' })
  @IsOptional()
  @IsString()
  sprintId?: string;

  @ApiPropertyOptional({
    description: 'Cursor para paginação (chave da última task)',
    example: '100',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Itens por página (1-100, default: 20)',
    example: 20,
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;

  /**
   * Filtro por pai na hierarquia de fases (ADR-V2-047).
   *
   * - `string numérica`: retorna apenas filhas diretas (1 nível) da task indicada.
   * - `'null'` (literal): retorna apenas tasks raiz (sem `idPai`) — útil para
   *   listar as fases do topo do projeto.
   * - omitido: não aplica filtro hierárquico.
   *
   * Combine com `idClasse=-200` para listar somente fases filhas, ou com
   * `depth` para descer N níveis.
   */
  @ApiPropertyOptional({
    description:
      'ID da task pai (ADR-V2-047). Aceita "null" literal para listar raízes. ' +
      'Combine com `idClasse=-200` para listar somente fases.',
    example: '5',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(-?\d+|null)$/, {
    message: 'idPai deve ser string numérica (positiva/negativa) ou "null"',
  })
  idPai?: string;

  /**
   * Filtro por classe polimórfica de DTask (chave da DClasse).
   *
   * - `-200` (PHASE): retorna apenas fases (agrupadores hierárquicos).
   * - `-154` (SCRUMBAN_TASK): retorna apenas tasks executáveis.
   *
   * Em F5 outras classes (MILESTONE/EPIC/BLOCK) podem aparecer.
   */
  @ApiPropertyOptional({
    description:
      'Filtrar por idClasse da DTask. -200=PHASE, -154=SCRUMBAN_TASK. Inteiro negativo.',
    example: '-200',
  })
  @IsOptional()
  @IsString()
  @Matches(/^-?\d+$/, { message: 'idClasse deve ser string numérica (positiva/negativa)' })
  idClasse?: string;

  /**
   * Profundidade da consulta hierárquica (descida na árvore via `idPai`).
   *
   * Aplicável apenas quando combinado com `idPai`. Quando informado, a
   * listagem retorna descendentes recursivos até `depth` níveis (CTE
   * recursiva PostgreSQL).
   *
   * - `1` (default quando `idPai` informado): apenas filhas diretas.
   * - `0`: apenas a própria raiz (`idPai` indicado).
   * - `2..20`: descendentes até esse nível.
   *
   * Cap absoluto: 20 níveis (guardrail anti-DoS — mesmo limite de
   * `MAX_PHASE_DEPTH` em PhaseHierarchyService).
   */
  @ApiPropertyOptional({
    description:
      'Profundidade de descida na árvore (1=filhas diretas, ..., 20=máximo). ' +
      'Combinar com `idPai`. Sem `idPai` é ignorado.',
    example: 1,
    minimum: 0,
    maximum: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  @Type(() => Number)
  depth?: number;

  /**
   * Filtro por data limite — início do intervalo (inclusivo).
   *
   * Formato ISO 8601 (date-only ou datetime completo).
   * Combina com `dueDateTo` para intervalo fechado.
   *
   * Exemplo: `dueDateFrom=2026-06-01` retorna tasks com dueDate >= 2026-06-01.
   */
  @ApiPropertyOptional({
    description:
      'Filtrar tasks com dueDate >= este valor (ISO 8601). ' +
      'Combine com `dueDateTo` para intervalo fechado.',
    example: '2026-06-01',
  })
  @IsOptional()
  @IsISO8601()
  dueDateFrom?: string;

  /**
   * Filtro por data limite — fim do intervalo (inclusivo).
   *
   * Formato ISO 8601 (date-only ou datetime completo).
   */
  @ApiPropertyOptional({
    description:
      'Filtrar tasks com dueDate <= este valor (ISO 8601). ' +
      'Combine com `dueDateFrom` para intervalo fechado.',
    example: '2026-06-30',
  })
  @IsOptional()
  @IsISO8601()
  dueDateTo?: string;

  /**
   * Filtro por bloco (Opção A — dados.idBloco).
   *
   * Retorna apenas tasks cujo campo `dados->>'idBloco'` é igual ao valor
   * informado. Tasks permanecem com `idPai=null` (raiz) e aparecem
   * normalmente nas views List e Kanban.
   */
  @ApiPropertyOptional({
    description:
      'Filtrar tasks vinculadas a um bloco (dados.idBloco). ' +
      'String numérica — chave da task de bloco (idClasse=-200).',
    example: '42',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'idBloco deve ser string numérica positiva' })
  idBloco?: string;

  /**
   * Filtro por "vence hoje" no timezone America/Sao_Paulo.
   *
   * Quando `true`, retorna tasks com dueDate entre o início e o fim
   * do dia atual (00:00:00 → 23:59:59.999) em horário de Brasília.
   * Tem precedência sobre `dueDateFrom`/`dueDateTo` quando combinados.
   */
  @ApiPropertyOptional({
    description:
      'Quando true, retorna apenas tasks com dueDate no dia de hoje ' +
      '(timezone America/Sao_Paulo). Tem precedência sobre dueDateFrom/dueDateTo.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  dueDateToday?: boolean;
}
