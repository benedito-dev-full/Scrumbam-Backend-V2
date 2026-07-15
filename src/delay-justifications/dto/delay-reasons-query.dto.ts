import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches } from 'class-validator';

/**
 * Dimensões de agrupamento suportadas pelo painel de motivos de atraso.
 *
 * - `motivo` — agrupa por DClasse-motivo (`-531..-537`). Ranking dos maiores
 *   motivos.
 * - `usuario` — agrupa por autor (`DEvento.idEntidade` = DEntidade do
 *   responsável). Ranking de quem mais atrasa.
 * - `projeto` — agrupa por projeto (`metaDados.projetoId`). Ranking de quais
 *   projetos concentram atrasos.
 */
export type DelayReasonsGroupBy = 'motivo' | 'usuario' | 'projeto';

/** Valores aceitos em `groupBy` (fonte única para o `@IsIn` e a whitelist SQL). */
export const DELAY_REASONS_GROUP_BY = ['motivo', 'usuario', 'projeto'] as const;

/**
 * DTO de query do painel admin de motivos de atraso
 * (`GET /reports/delay-reasons`, Fase 2 — ADR-V2-070).
 *
 * Todos os filtros são OPCIONAIS exceto `groupBy` (define a dimensão do
 * ranking). A agregação conta justificativas **vigentes** (`DEvento` -503,
 * `excluido=false`) da organização do requester (org ADMIN -161 SOMENTE), com
 * os filtros aplicados.
 *
 * Validações (class-validator):
 * - `userId` — string numérica opcional (DEntidade.chave do autor).
 * - `projectId` — string numérica opcional (DProject.chave). Quando presente,
 *   a org-alvo passa a ser a org DONA desse projeto (`DProject.idEstab`).
 * - `motivoClasse` — opcional, ∈ `-531..-537`.
 * - `from`/`to` — datas ISO 8601 opcionais (filtro por `criadoEm`, TZ Brasil).
 * - `groupBy` — OBRIGATÓRIO, ∈ `motivo | usuario | projeto`.
 *
 * @example
 * ```
 * GET /reports/delay-reasons?groupBy=motivo
 * GET /reports/delay-reasons?groupBy=usuario&projectId=10&from=2026-07-01
 * GET /reports/delay-reasons?groupBy=projeto&motivoClasse=-535&from=2026-07-01&to=2026-07-31
 * ```
 */
export class DelayReasonsQueryDto {
  /**
   * Dimensão do ranking (OBRIGATÓRIO). Define a chave do `GROUP BY`.
   */
  @ApiProperty({
    description: 'Dimensão do agrupamento',
    enum: DELAY_REASONS_GROUP_BY,
    example: 'motivo',
  })
  @IsIn(DELAY_REASONS_GROUP_BY, {
    message: `groupBy deve ser um de: ${DELAY_REASONS_GROUP_BY.join(', ')}`,
  })
  groupBy!: DelayReasonsGroupBy;

  /**
   * Dimensão SECUNDÁRIA opcional (cruzamento). Quando presente, cada grupo do
   * ranking primário (`groupBy`) é quebrado por esta dimensão em `groups[].sub`
   * (alimenta o card "Onde concentra" do front: cada pessoa/projeto → motivos).
   *
   * DEVE ser diferente de `groupBy` (cruzar uma dimensão com ela mesma não faz
   * sentido → 400). Ausente → resposta retrocompatível (sem `sub`).
   */
  @ApiPropertyOptional({
    description: 'Dimensão secundária do cruzamento (deve diferir de groupBy)',
    enum: DELAY_REASONS_GROUP_BY,
    example: 'motivo',
  })
  @IsOptional()
  @IsIn(DELAY_REASONS_GROUP_BY, {
    message: `subGroupBy deve ser um de: ${DELAY_REASONS_GROUP_BY.join(', ')}`,
  })
  subGroupBy?: DelayReasonsGroupBy;

  /**
   * Filtro por autor (DEntidade.chave). Restringe o ranking às justificativas
   * registradas por este usuário.
   */
  @ApiPropertyOptional({ description: 'ID do autor (DEntidade.chave)', example: '42' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'userId deve ser um ID numérico' })
  userId?: string;

  /**
   * Filtro por projeto (DProject.chave). Quando presente, a org-alvo do RBAC
   * é a org DONA deste projeto (`DProject.idEstab`).
   */
  @ApiPropertyOptional({ description: 'ID do projeto (DProject.chave)', example: '10' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'projectId deve ser um ID numérico' })
  projectId?: string;

  /**
   * Filtro por DClasse-motivo (`-531..-537`).
   */
  @ApiPropertyOptional({ description: 'DClasse-motivo (-531..-537)', example: '-535' })
  @IsOptional()
  @Matches(/^-53[1-7]$/, { message: 'motivoClasse deve estar em -531..-537' })
  motivoClasse?: string;

  /**
   * Início do período (inclusivo) — ISO 8601. Filtra por `DEvento.criadoEm`.
   */
  @ApiPropertyOptional({ description: 'Início do período (ISO 8601)', example: '2026-07-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}(T.*)?$/, { message: 'from deve ser uma data ISO 8601' })
  from?: string;

  /**
   * Fim do período (inclusivo) — ISO 8601. Filtra por `DEvento.criadoEm`.
   */
  @ApiPropertyOptional({ description: 'Fim do período (ISO 8601)', example: '2026-07-31' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}(T.*)?$/, { message: 'to deve ser uma data ISO 8601' })
  to?: string;

  /**
   * Quando `true`, a resposta ganha os contadores org-wide de tarefas ATRASADAS
   * (`overdueTotal`) e das atrasadas SEM justificativa vigente
   * (`overduePending`) — para o front montar o KPI "% com justificativa"
   * (`justificadas = overdueTotal − overduePending`).
   *
   * Ausente/`false` → ambos os contadores voltam `null` e a query extra NÃO é
   * executada (retrocompatível e sem custo de performance). Os contadores usam
   * o MESMO escopo de org/filtros (`userId`, `projectId`, `from`, `to`) já
   * resolvido pela agregação — `motivoClasse` não se aplica (é filtro de
   * justificativa, não de tarefa).
   */
  @ApiPropertyOptional({
    description:
      'Quando true, inclui overdueTotal (tarefas atrasadas) e overduePending ' +
      '(atrasadas sem justificativa) org-wide no mesmo escopo/filtros.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  includeOverdue?: boolean;
}
