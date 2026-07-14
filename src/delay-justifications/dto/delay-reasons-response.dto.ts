import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DelayReasonsGroupBy } from './delay-reasons-query.dto';

/**
 * Uma linha do ranking do painel de motivos de atraso.
 *
 * O significado de `key`/`label` depende de `groupBy` da resposta-mãe:
 * - `motivo` → `key` = DClasse-motivo (ex. `-535`), `label` = nome do motivo.
 * - `usuario` → `key` = DEntidade.chave do autor, `label` = nome do usuário.
 * - `projeto` → `key` = DProject.chave, `label` = nome do projeto.
 *
 * Shape estável e uniforme para os 3 cortes (a gaveta do front só troca
 * `groupBy` e re-renderiza a mesma lista de `{ key, label, count, avgDelayDays }`).
 *
 * @example
 * ```json
 * { "key": "-535", "label": "Problema técnico / bug", "count": 18, "avgDelayDays": 3.4 }
 * ```
 */
export class DelayReasonGroupDto {
  /** Chave da dimensão agrupada (string; semântica varia por `groupBy`). */
  @ApiProperty({ description: 'Chave do grupo (varia por groupBy)', example: '-535' })
  key!: string;

  /**
   * Rótulo legível resolvido (nome do motivo/usuário/projeto). `null` quando a
   * entidade referenciada não pôde ser resolvida (ex. foi removida).
   */
  @ApiPropertyOptional({
    description: 'Rótulo legível do grupo',
    example: 'Problema técnico / bug',
    nullable: true,
  })
  label!: string | null;

  /** Nº de justificativas vigentes (`excluido=false`) neste grupo. */
  @ApiProperty({ description: 'Contagem de justificativas vigentes', example: 18 })
  count!: number;

  /**
   * Média de dias de atraso (`metaDados.delayDays`) das justificativas do
   * grupo. `null` só se o grupo não tiver amostras válidas.
   */
  @ApiPropertyOptional({ description: 'Média de dias de atraso', example: 3.4, nullable: true })
  avgDelayDays!: number | null;
}

/**
 * Filtros efetivamente aplicados na agregação (eco da query, normalizado).
 * Permite ao front rehidratar o estado da gaveta e exibir os filtros ativos.
 */
export class DelayReasonsFiltersDto {
  @ApiPropertyOptional({ description: 'Filtro por autor', example: '42', nullable: true })
  userId!: string | null;

  @ApiPropertyOptional({ description: 'Filtro por projeto', example: '10', nullable: true })
  projectId!: string | null;

  @ApiPropertyOptional({ description: 'Filtro por motivo', example: '-535', nullable: true })
  motivoClasse!: string | null;

  @ApiPropertyOptional({ description: 'Início do período', example: '2026-07-01', nullable: true })
  from!: string | null;

  @ApiPropertyOptional({ description: 'Fim do período', example: '2026-07-31', nullable: true })
  to!: string | null;
}

/**
 * Response do painel admin de motivos de atraso (`GET /reports/delay-reasons`).
 *
 * Contrato estável pensado para os 3 cortes da gaveta (por motivo, por pessoa,
 * por projeto): o front pede um `groupBy` por vez e recebe a mesma estrutura —
 * `groups[]` ordenado por `count` desc, `total` de justificativas vigentes,
 * `orgId` (escopo de tenant) e o eco de `filters`.
 *
 * A contagem é sempre de justificativas **vigentes** (`DEvento` -503,
 * `excluido=false`) da organização, respeitando os filtros. Justificativas de
 * tasks sem projeto NÃO entram (não há como atribuí-las a uma org).
 *
 * @example
 * ```json
 * {
 *   "groupBy": "motivo",
 *   "orgId": "10",
 *   "total": 42,
 *   "groups": [
 *     { "key": "-535", "label": "Problema técnico / bug", "count": 18, "avgDelayDays": 3.4 },
 *     { "key": "-531", "label": "Dependência não entregue", "count": 12, "avgDelayDays": 5.1 }
 *   ],
 *   "filters": { "userId": null, "projectId": null, "motivoClasse": null, "from": null, "to": null }
 * }
 * ```
 */
export class DelayReasonsResponseDto {
  /** Dimensão do agrupamento desta resposta (eco da query). */
  @ApiProperty({
    description: 'Dimensão do agrupamento',
    enum: ['motivo', 'usuario', 'projeto'],
    example: 'motivo',
  })
  groupBy!: DelayReasonsGroupBy;

  /** Organização-alvo da agregação (escopo de tenant). */
  @ApiProperty({ description: 'ID da organização (DEntidade.chave)', example: '10' })
  orgId!: string;

  /** Total de justificativas vigentes contadas (soma de `groups[].count`). */
  @ApiProperty({ description: 'Total de justificativas vigentes', example: 42 })
  total!: number;

  /** Ranking ordenado por `count` desc. */
  @ApiProperty({
    description: 'Grupos do ranking (ordenado por count desc)',
    type: [DelayReasonGroupDto],
  })
  groups!: DelayReasonGroupDto[];

  /** Eco normalizado dos filtros aplicados. */
  @ApiProperty({ description: 'Filtros aplicados', type: DelayReasonsFiltersDto })
  filters!: DelayReasonsFiltersDto;
}
