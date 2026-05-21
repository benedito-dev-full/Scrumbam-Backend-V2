import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * idClasse PHASE (-200) — agregador hierárquico (ADR-V2-047).
 * Descendentes contam apenas tasks-folha (não PHASEs), exatamente como
 * `PhaseMetricsService.computeRecursive` faz para o cálculo de `percent`.
 */
const ID_CLASSE_PHASE = BigInt(-200);

/**
 * Serviço que enumera as chaves de **tasks-folha descendentes** de uma fase
 * (`DTask` com `idClasse=-200`) usando CTE recursiva PostgreSQL.
 *
 * F9b (ADR-V2-047) — peça chave da composição "Flow Metrics by Phase":
 * a CTE roda UMA vez (1 query) e devolve `bigint[]` de IDs; cada um dos
 * 6 services de Flow Metrics (`cycle-time`, `lead-time`, `throughput`,
 * `wip-age`, `cfd`, `dashboard`) é então invocado com `taskIdsFilter`
 * (parâmetro opcional adicionado em F9b parte 1). Pattern espelha o
 * `PhaseMetricsService.computeRecursive` do módulo `tasks/services`
 * (Fase 5 do ADR-V2-047) sem duplicação de lógica de agregação.
 *
 * **Defense-in-depth (ADR-V2-042):**
 *   - Pré-query `findUnique` extrai `idProject` da raiz; o filtro
 *     `"idProject" = ${rootProjectId}` é aplicado no anchor E no passo
 *     recursivo da CTE — bloqueia cross-project enxertos de `idPai`.
 *
 * **Guardrail:** `depth < 20` HARDCODED no SQL (PostgreSQL não aceita
 * placeholder em literal de comparação). Mesmo limite usado em F3/F5.
 *
 * **N+1 budget:** 1 query (CTE) por chamada. Reviewer valida.
 *
 * F9b é read-only — NÃO persiste, NÃO emite eventos.
 *
 * @see PhaseMetricsService — pattern de CTE recursiva original (Fase 5)
 * @see ByPhaseResolverService — consumidor desta API (Fase 9b parte 2)
 */
@Injectable()
export class PhaseDescendantsService {
  private readonly logger = new Logger(PhaseDescendantsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retorna a lista de chaves de tasks-folha descendentes (recursivo) de uma fase.
   *
   * Algoritmo:
   *  1. Pré-query `findUnique` extrai `idProject` da raiz `phaseId`.
   *     Se a raiz não existir, estiver soft-deleted ou não tiver `idProject`,
   *     lança `NotFoundException` com mensagem genérica (anti-enumeration).
   *  2. CTE recursiva (anchor = filhos diretos de `phaseId`) percorre a
   *     árvore até `depth < 20`. Anchor e passo recursivo filtram por
   *     `"idProject" = rootProjectId` (defense-in-depth).
   *  3. Retorna apenas folhas (`idClasse != -200 PHASE`) — sub-fases
   *     intermediárias NÃO entram no filtro de tasks de Flow Metrics.
   *
   * @param phaseId - chave BigInt do `DTask` raiz (espera-se `idClasse=-200`,
   *                  mas o método NÃO valida — `ByPhaseResolver` valida antes).
   * @returns Array de chaves de tasks-folha descendentes (vazio se nenhuma).
   *
   * @throws {NotFoundException} Se `phaseId` não existir, estiver soft-deleted
   *                             ou não tiver `idProject` associado.
   *
   * @example
   * ```typescript
   * const taskIds = await service.findDescendantTaskIds(BigInt(7));
   * // [BigInt(101), BigInt(102), BigInt(103)] — tasks-folha de descendentes da fase
   * ```
   */
  async findDescendantTaskIds(phaseId: bigint): Promise<bigint[]> {
    // 1. Resolver idProject da raiz (defense-in-depth + 404 anti-enumeration)
    const root = await this.prisma.dTask.findUnique({
      where: { chave: phaseId },
      select: { idProject: true, excluido: true },
    });

    if (!root || root.excluido || !root.idProject) {
      throw new NotFoundException(`Fase ${phaseId.toString()} não encontrada ou inacessível.`);
    }

    const rootProjectId = root.idProject;

    // 2. CTE recursiva — anchor: filhos diretos de phaseId.
    //    Guardrail `depth < 20` HARDCODED (PG não aceita placeholder em literal).
    //    Filtro idProject reaplicado em ambos os ramos da CTE.
    const rows = await this.prisma.$queryRaw<Array<{ chave: bigint }>>`
      WITH RECURSIVE descendants AS (
        SELECT chave, "idPai", "idClasse", 0 AS depth
        FROM "DTask"
        WHERE "idPai" = ${phaseId}
          AND excluido = false
          AND "idProject" = ${rootProjectId}

        UNION ALL

        SELECT c.chave, c."idPai", c."idClasse", d.depth + 1
        FROM "DTask" c
        INNER JOIN descendants d ON c."idPai" = d.chave
        WHERE c.excluido = false
          AND c."idProject" = ${rootProjectId}
          AND d.depth < 20
      )
      SELECT chave
      FROM descendants
      WHERE "idClasse" != ${ID_CLASSE_PHASE}
    `;

    this.logger.debug(
      `findDescendantTaskIds(${phaseId.toString()}) → ${rows.length} folhas em projeto=${rootProjectId.toString()}`,
    );

    return rows.map((r) => r.chave);
  }
}
