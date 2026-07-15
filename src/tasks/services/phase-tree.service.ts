import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  PhaseTreeNodeDto,
  PhaseTreeNodeMetricsDto,
  PhaseTreeResponseDto,
} from '../dto/phase-tree-response.dto';

/**
 * Opções de construção da árvore.
 *
 * - `maxDepth`: profundidade máxima de descida (default 20; guardrail
 *   absoluto 20 níveis, mesmo limite do `PhaseHierarchyService` —
 *   defense-in-depth também hardcoded no SQL).
 * - `includeMetrics`: quando `true`, anexa `metrics` em cada nó-fase
 *   (idClasse=-200). Tasks executáveis recebem `metrics: null`.
 */
export interface PhaseTreeOptions {
  maxDepth?: number;
  includeMetrics?: boolean;
}

/** Linha bruta retornada pela CTE de tree — todos os ids vêm como `text` */
type TreeRow = {
  id: string;
  idPai: string | null;
  idClasse: string;
  nome: string;
  status: string | null;
  depth: number;
};

/** Linha bruta da CTE de metrics-per-phase. */
type MetricsRow = {
  phaseId: string;
  total: bigint;
  done: bigint;
  failed: bigint;
  inProgress: bigint;
};

/**
 * Guardrail absoluto compartilhado com `PhaseHierarchyService`.
 *
 * NOTA: Literais SQL de idClasse (-200 para PHASE) usam constantes hardcoded
 * em vez de variáveis parametrizadas porque PostgreSQL não aceita parâmetros
 * em contextos de literal (como CASE, FILTER, Window functions). Os valores
 * vêm do seed canônico (`prisma/seeds/classes.seed.ts`) e são estáveis
 * entre projetos — o mesmo padrão usado em `phase-metrics.service.ts`.
 * A segurança é garantida: idClasses são seeds negativos (read-only pré-deploy),
 * nunca input do usuário.
 */
const MAX_TREE_DEPTH = 20;
const PHASE_IDCLASSE_STR = '-200';

/**
 * Service responsável por construir a árvore recursiva de uma fase ou task.
 *
 * Implementa o ADR-V2-047 — Fase 5. Usa CTE recursiva PostgreSQL para
 * descobrir todos os descendentes da `rootId` dentro do mesmo `idProject`
 * (defense-in-depth contra cross-project leak), com guardrail hardcoded
 * `depth < 20` para impedir ciclos runtime.
 *
 * Montagem em memória via `Map<id, PhaseTreeNodeDto>` — 1ª passada
 * instancia os nós, 2ª passada liga `children`. Quando `includeMetrics=true`,
 * executa uma SEGUNDA CTE única que agrega `done/failed/inProgress/total`
 * por `phase_root` mais próximo (evita N+1 chamando `compute()` por nó).
 *
 * @see ADR-V2-047 (Fases via DTask.idPai)
 * @see PhaseMetricsService — modo single-phase (consistente com a 2ª CTE aqui)
 * @see PhaseHierarchyService — guardrail compartilhado de profundidade
 */
@Injectable()
export class PhaseTreeService {
  private readonly logger = new Logger(PhaseTreeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Constrói a árvore recursiva a partir de `rootId`.
   *
   * Executa 2 queries (sem `includeMetrics`) ou 3 queries (com): pré-query
   * de `idProject` (404 anti-enumeration) + CTE de árvore + CTE opcional
   * de métricas-por-fase. ZERO N+1.
   *
   * @param rootId - chave da task/fase raiz da árvore
   * @param options - `maxDepth` (1..20, default 20) e `includeMetrics`
   * @returns árvore aninhada conforme `PhaseTreeResponseDto`
   *
   * @throws {NotFoundException} Quando `rootId` não existe, está soft-deleted
   *   ou está fora de qualquer projeto.
   *
   * @example
   * ```typescript
   * // Árvore completa até 20 níveis
   * const tree = await service.buildTree(BigInt(5));
   * // { root: {...}, totalNodes: 12, maxDepthReached: 3 }
   *
   * // Apenas 2 níveis com métricas em cada fase
   * const tree = await service.buildTree(BigInt(5), {
   *   maxDepth: 2,
   *   includeMetrics: true,
   * });
   * ```
   */
  async buildTree(rootId: bigint, options?: PhaseTreeOptions): Promise<PhaseTreeResponseDto> {
    const requestedDepth = options?.maxDepth ?? MAX_TREE_DEPTH;
    const effectiveDepth = Math.min(Math.max(requestedDepth, 1), MAX_TREE_DEPTH);
    // CTE depth é 0-indexada: maxDepth=N → permite profundidades 0..N-1 → d.depth < N-1
    const depthCap = effectiveDepth - 1;
    const includeMetrics = options?.includeMetrics ?? false;

    this.logger.log(
      `buildTree(${rootId}) maxDepth=${effectiveDepth} includeMetrics=${includeMetrics}`,
    );

    // 1. Pré-query: extrai idProject para defense-in-depth (cross-project).
    const rootProjectId = await this.resolveRootProjectId(rootId);

    // 2. CTE de árvore.
    const rows = await this.queryTree(rootId, rootProjectId, depthCap);
    if (rows.length === 0) {
      throw new NotFoundException(`Task ${rootId.toString()} não encontrada ou inacessível.`);
    }

    // 3. Montagem em memória.
    const rootIdStr = rootId.toString();
    const byId = new Map<string, PhaseTreeNodeDto>();
    let maxDepthReached = 0;

    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        nome: r.nome,
        idClasse: r.idClasse,
        idPai: r.idPai,
        status: r.status,
        depth: r.depth,
        children: [],
        metrics: null,
      });
      if (r.depth > maxDepthReached) maxDepthReached = r.depth;
    }

    // 4. Ligação parent→child em uma 2ª passada (a CTE garante ORDER BY depth ASC,
    //    então os pais sempre aparecem antes dos filhos no Map).
    for (const r of rows) {
      if (r.id === rootIdStr) continue;
      if (r.idPai && byId.has(r.idPai)) {
        byId.get(r.idPai)!.children.push(byId.get(r.id)!);
      }
    }

    // 5. Métricas opcionais — 2ª CTE agregando por phase_root.
    if (includeMetrics) {
      const metricsByPhase = await this.queryMetricsByPhase(rootId, rootProjectId);
      for (const node of byId.values()) {
        if (node.idClasse === PHASE_IDCLASSE_STR) {
          node.metrics = metricsByPhase.get(node.id) ?? this.emptyMetrics();
        }
      }
    }

    const root = byId.get(rootIdStr);
    if (!root) {
      // Defensive — a CTE garante que o anchor sempre aparece, mas se algum
      // bug retornasse rows sem o root, evitamos `!` indevido.
      throw new NotFoundException(
        `Task ${rootId.toString()} não encontrada na árvore retornada pela CTE.`,
      );
    }

    const response: PhaseTreeResponseDto = {
      root,
      totalNodes: rows.length,
      maxDepthReached,
    };

    this.logger.debug(`buildTree(${rootId}) → nodes=${rows.length} maxDepth=${maxDepthReached}`);

    return response;
  }

  /**
   * Resolve `idProject` da raiz e garante 404 quando inacessível. Centraliza
   * o filtro de defense-in-depth usado pela CTE.
   */
  private async resolveRootProjectId(rootId: bigint): Promise<bigint> {
    const root = await this.prisma.dTask.findUnique({
      where: { chave: rootId },
      select: { idProject: true, excluido: true },
    });

    if (!root || root.excluido || !root.idProject) {
      throw new NotFoundException(`Task ${rootId.toString()} não encontrada ou inacessível.`);
    }

    return root.idProject;
  }

  /**
   * CTE recursiva que devolve todos os nós da árvore (incluindo a raiz),
   * com `status` resolvido via JOIN com `DTabela`. Guardrail `depth < 20`
   * hardcoded — defense-in-depth contra ciclos runtime e limite do caller.
   */
  private async queryTree(
    rootId: bigint,
    rootProjectId: bigint,
    depthCap: number,
  ): Promise<TreeRow[]> {
    return this.prisma.$queryRaw<TreeRow[]>`
      WITH RECURSIVE tree AS (
        SELECT
          t.chave,
          t."idPai",
          t."idClasse",
          t.nome,
          t."idStatus",
          s_anchor.codigo AS status_code,
          0 AS depth
        FROM "DTask" t
        LEFT JOIN "DTabela" s_anchor
          ON s_anchor.chave = t."idStatus" AND s_anchor.excluido = false
        WHERE t.chave = ${rootId}
          AND t.excluido = false
          AND t."idProject" = ${rootProjectId}

        UNION ALL

        SELECT
          c.chave,
          c."idPai",
          c."idClasse",
          c.nome,
          c."idStatus",
          s_child.codigo AS status_code,
          tree.depth + 1
        FROM "DTask" c
        INNER JOIN tree ON c."idPai" = tree.chave
        LEFT JOIN "DTabela" s_child
          ON s_child.chave = c."idStatus" AND s_child.excluido = false
        WHERE c.excluido = false
          AND c."idProject" = ${rootProjectId}
          AND tree.depth < ${depthCap}
          AND tree.depth < 20
      )
      SELECT
        chave::text AS id,
        "idPai"::text AS "idPai",
        "idClasse"::text AS "idClasse",
        nome,
        status_code AS status,
        depth::int AS depth
      FROM tree
      ORDER BY depth ASC, chave ASC
    `;
  }

  /**
   * CTE recursiva agregadora — para cada nó descendente da raiz, descobre o
   * `phase_root` mais próximo (subindo até encontrar `idClasse = -200`) e
   * agrega `total/done/failed/inProgress` por `phase_root`. Resultado: `Map`
   * indexado por id (string) com `PhaseTreeNodeMetricsDto`. ZERO N+1.
   *
   * Semântica consistente com `PhaseMetricsService.compute(phaseId, recursive=true)`:
   * exclui a própria raiz (`depth > 0`), exclui PHASE do `total`, exclui
   * (poda 9 → 5: não há mais status excluídos do `total`).
   */
  private async queryMetricsByPhase(
    rootId: bigint,
    rootProjectId: bigint,
  ): Promise<Map<string, PhaseTreeNodeMetricsDto>> {
    const rows = await this.prisma.$queryRaw<MetricsRow[]>`
      WITH RECURSIVE descendants AS (
        SELECT
          chave,
          "idPai",
          "idClasse",
          "idStatus",
          0 AS depth,
          chave AS phase_root
        FROM "DTask"
        WHERE chave = ${rootId}
          AND excluido = false
          AND "idProject" = ${rootProjectId}

        UNION ALL

        SELECT
          c.chave,
          c."idPai",
          c."idClasse",
          c."idStatus",
          d.depth + 1,
          CASE
            WHEN c."idClasse" = -200 THEN c.chave
            ELSE d.phase_root
          END AS phase_root
        FROM "DTask" c
        INNER JOIN descendants d ON c."idPai" = d.chave
        WHERE c.excluido = false
          AND c."idProject" = ${rootProjectId}
          AND d.depth < 20
      )
      SELECT
        d.phase_root::text AS "phaseId",
        COUNT(*) FILTER (
          WHERE d."idClasse" != -200
        ) AS total,
        COUNT(*) FILTER (WHERE s."idClasse" = -444) AS done,
        COUNT(*) FILTER (WHERE s."idClasse" = -445) AS failed,
        COUNT(*) FILTER (WHERE s."idClasse" = -443) AS "inProgress"
      FROM descendants d
      LEFT JOIN "DTabela" s ON s.chave = d."idStatus" AND s.excluido = false
      WHERE d.depth > 0
      GROUP BY d.phase_root
    `;

    const out = new Map<string, PhaseTreeNodeMetricsDto>();
    for (const r of rows) {
      const total = Number(r.total ?? 0);
      const done = Number(r.done ?? 0);
      const percent = total === 0 ? 0 : Math.round((done / total) * 100);
      out.set(r.phaseId, {
        total,
        done,
        failed: Number(r.failed ?? 0),
        inProgress: Number(r.inProgress ?? 0),
        percent,
      });
    }
    return out;
  }

  private emptyMetrics(): PhaseTreeNodeMetricsDto {
    return { total: 0, done: 0, failed: 0, inProgress: 0, percent: 0 };
  }
}
