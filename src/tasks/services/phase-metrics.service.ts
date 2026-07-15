import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PhaseMetricsResponseDto } from '../dto/phase-metrics-response.dto';

/**
 * Opções de cálculo de métricas.
 *
 * - `recursive` (default `true`): quando `true`, agrega TODOS os descendentes
 *   via CTE recursiva. Quando `false`, conta apenas filhas diretas.
 */
export interface PhaseMetricsOptions {
  recursive?: boolean;
}

/**
 * Linha agregada retornada pela CTE/SQL — todos os campos vêm como `bigint`
 * (`COUNT(*)` em PostgreSQL). Convertemos para `number` no service.
 */
type MetricsRow = {
  total: bigint;
  done: bigint;
  failed: bigint;
  inProgress: bigint;
  pending: bigint;
};

/**
 * Constantes de idClasse de DTabela para estados V3 — fonte da verdade é o
 * seed canônico V2 (`prisma/seeds/classes.seed.ts`). Replicadas aqui para
 * uso literal no SQL (PostgreSQL não aceita parâmetros como literais de
 * CASE/FILTER). Espelham `STATUS_TO_TABELA_CLASSE` de `tasks.service.ts`.
 *
 * O JOIN é com `DTabela` (chave POSITIVA criada em runtime por projeto) →
 * `idClasse` (NEGATIVA, do seed) para identificar o estado do registro.
 */
const PHASE_IDCLASSE = -200 as const;
const STATUS_DONE_IDCLASSE = -444 as const;
const STATUS_FAILED_IDCLASSE = -445 as const;
const STATUS_EXECUTING_IDCLASSE = -443 as const;
// Pending: INBOX (-441), READY (-442).
//
// Poda 9 -> 5: VALIDATING (-448) e VALIDATED (-449) contavam como PENDENTE aqui
// e, ao mesmo tempo, como CONCLUIDO em `delay-justifications/overdue.util.ts` —
// a MESMA task produzia dois numeros diferentes. Com a remocao dos 4 status a
// divergencia morre: DONE (-444) e o unico estado de conclusao nos DOIS arquivos.
// CANCELLED (-446) / DISCARDED (-447) tambem sairam — nao ha mais o que excluir
// de `total`.

/**
 * Service de métricas agregadas de fases (% conclusão + contagens).
 *
 * Implementa o ADR-V2-047 — Fase 5. Calcula `total`, `done`, `failed`,
 * `inProgress`, `pending` e `percent` para uma fase (ou task) usando:
 *
 * - Modo `recursive=true` (default): CTE recursiva PostgreSQL descobre TODOS
 *   os descendentes (até guardrail hardcoded de 20 níveis), com defense-in-depth
 *   por `idProject` no anchor e no passo recursivo.
 * - Modo `recursive=false`: query simples por `idPai = phaseId`.
 *
 * Identificação de estado via JOIN com `DTabela.idClasse` (constantes do seed
 * V2). `percent = 0` quando `total = 0` (sem NaN).
 *
 * @see ADR-V2-047 (Fases via DTask.idPai)
 * @see PhaseHierarchyService — guardrail de profundidade compartilhado
 * @see prisma/seeds/classes.seed.ts — origem das constantes idClasse
 */
@Injectable()
export class PhaseMetricsService {
  private readonly logger = new Logger(PhaseMetricsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcula métricas agregadas da fase indicada.
   *
   * Executa duas queries: (1) `findUnique` para extrair `idProject` da raiz
   * (defense-in-depth contra cross-project leak) e (2) a query agregadora —
   * CTE recursiva ou direta dependendo de `options.recursive`. Total = 2.
   *
   * @param phaseId - chave da fase/task raiz
   * @param options - `recursive` (default true) e qualquer extensão futura
   * @returns objeto com `total`, `done`, `failed`, `inProgress`, `pending`,
   *   `percent`, `recursive`, `computedAt`
   *
   * @throws {NotFoundException} Quando `phaseId` não existe, está soft-deleted
   *   ou está fora de qualquer projeto (`idProject = NULL`).
   *
   * @example
   * ```typescript
   * // Métricas recursivas da fase 5 (default)
   * const m = await service.compute(BigInt(5));
   * // { total: 50, done: 20, failed: 2, inProgress: 5, pending: 23,
   * //   percent: 40, recursive: true, computedAt: '2026-05-21T...' }
   *
   * // Apenas filhas diretas
   * const m2 = await service.compute(BigInt(5), { recursive: false });
   * ```
   */
  async compute(phaseId: bigint, options?: PhaseMetricsOptions): Promise<PhaseMetricsResponseDto> {
    const recursive = options?.recursive ?? true;
    this.logger.log(`compute(${phaseId}, recursive=${recursive})`);

    // 1. Pré-query: extrai idProject para defense-in-depth (cross-project).
    const rootProjectId = await this.resolveRootProjectId(phaseId);

    // 2. Query agregadora — CTE recursiva ou direta.
    const row = recursive
      ? await this.computeRecursive(phaseId, rootProjectId)
      : await this.computeDirect(phaseId, rootProjectId);

    const total = Number(row.total ?? 0);
    const done = Number(row.done ?? 0);
    const failed = Number(row.failed ?? 0);
    const inProgress = Number(row.inProgress ?? 0);
    const pending = Number(row.pending ?? 0);
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);

    const result: PhaseMetricsResponseDto = {
      phaseId: phaseId.toString(),
      total,
      done,
      failed,
      inProgress,
      pending,
      percent,
      recursive,
      computedAt: new Date().toISOString(),
    };

    this.logger.debug(`compute(${phaseId}) → total=${total} done=${done} percent=${percent}%`);

    return result;
  }

  /**
   * Resolve `idProject` da raiz (`phaseId`). Centraliza a validação 404 e
   * o filtro de defense-in-depth usado pelas CTEs.
   */
  private async resolveRootProjectId(phaseId: bigint): Promise<bigint> {
    const root = await this.prisma.dTask.findUnique({
      where: { chave: phaseId },
      select: { idProject: true, excluido: true },
    });

    if (!root || root.excluido || !root.idProject) {
      throw new NotFoundException(`Task ${phaseId.toString()} não encontrada ou inacessível.`);
    }

    return root.idProject;
  }

  /**
   * Agrega métricas via CTE recursiva — TODOS os descendentes da `phaseId`
   * dentro do mesmo `idProject`, até guardrail hardcoded `depth < 20`.
   *
   * Exclui a própria raiz (`depth > 0`) e nós de classe PHASE (-200) do
   * `total`.
   */
  private async computeRecursive(phaseId: bigint, rootProjectId: bigint): Promise<MetricsRow> {
    const rows = await this.prisma.$queryRaw<MetricsRow[]>`
      WITH RECURSIVE descendants AS (
        SELECT chave, "idPai", "idClasse", "idStatus", 0 AS depth
        FROM "DTask"
        WHERE chave = ${phaseId}
          AND excluido = false
          AND "idProject" = ${rootProjectId}

        UNION ALL

        SELECT c.chave, c."idPai", c."idClasse", c."idStatus", d.depth + 1
        FROM "DTask" c
        INNER JOIN descendants d ON c."idPai" = d.chave
        WHERE c.excluido = false
          AND c."idProject" = ${rootProjectId}
          AND d.depth < 20
      )
      SELECT
        COUNT(*) FILTER (WHERE d."idClasse" != ${PHASE_IDCLASSE}) AS total,
        COUNT(*) FILTER (WHERE s."idClasse" = ${STATUS_DONE_IDCLASSE}) AS done,
        COUNT(*) FILTER (WHERE s."idClasse" = ${STATUS_FAILED_IDCLASSE}) AS failed,
        COUNT(*) FILTER (WHERE s."idClasse" = ${STATUS_EXECUTING_IDCLASSE}) AS "inProgress",
        COUNT(*) FILTER (WHERE s."idClasse" IN (-441, -442)) AS pending
      FROM descendants d
      LEFT JOIN "DTabela" s ON s.chave = d."idStatus" AND s.excluido = false
      WHERE d.depth > 0
    `;

    return rows[0] ?? this.emptyRow();
  }

  /**
   * Agrega métricas apenas das filhas DIRETAS de `phaseId`. Sem recursão.
   */
  private async computeDirect(phaseId: bigint, rootProjectId: bigint): Promise<MetricsRow> {
    const rows = await this.prisma.$queryRaw<MetricsRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE t."idClasse" != ${PHASE_IDCLASSE}) AS total,
        COUNT(*) FILTER (WHERE s."idClasse" = ${STATUS_DONE_IDCLASSE}) AS done,
        COUNT(*) FILTER (WHERE s."idClasse" = ${STATUS_FAILED_IDCLASSE}) AS failed,
        COUNT(*) FILTER (WHERE s."idClasse" = ${STATUS_EXECUTING_IDCLASSE}) AS "inProgress",
        COUNT(*) FILTER (WHERE s."idClasse" IN (-441, -442)) AS pending
      FROM "DTask" t
      LEFT JOIN "DTabela" s ON s.chave = t."idStatus" AND s.excluido = false
      WHERE t."idPai" = ${phaseId}
        AND t.excluido = false
        AND t."idProject" = ${rootProjectId}
    `;

    return rows[0] ?? this.emptyRow();
  }

  private emptyRow(): MetricsRow {
    return {
      total: BigInt(0),
      done: BigInt(0),
      failed: BigInt(0),
      inProgress: BigInt(0),
      pending: BigInt(0),
    };
  }
}
