import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';

/**
 * Profundidade maxima padrao da hierarquia DTask.idPai → DTask.chave.
 *
 * Soft-limit configuravel via env `MAX_PHASE_DEPTH` (default 20).
 * Atua como guardrail contra DoS (atacante criando 10000 niveis) e
 * limite tecnico da CTE recursiva em PostgreSQL.
 */
const DEFAULT_MAX_PHASE_DEPTH = 20;

/**
 * Service de hierarquia de fases (ADR-V2-047 — Fases via DTask.idPai).
 *
 * Responsavel por:
 * - `validateNoCycle`: garantir que setar `idPai` nao cria ciclo.
 * - `validateProjectConsistency`: filha e pai devem ter o mesmo `idProject`.
 * - `softDeleteCascade`: marca task + todos descendentes como `excluido=true`
 *   em uma unica statement (CTE recursiva).
 *
 * Tabela estrutural — NAO usa Engine (Pilar 1 nao se aplica a cadastros).
 *
 * @see ADR-V2-047 docs/decisions/ADR-V2-047-fases-via-dtask-idpai.md
 */
@Injectable()
export class PhaseHierarchyService {
  private readonly logger = new Logger(PhaseHierarchyService.name);
  private readonly MAX_DEPTH: number;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    const raw = configService.get<string | number>('MAX_PHASE_DEPTH');
    const parsed = raw !== undefined && raw !== null ? Number(raw) : DEFAULT_MAX_PHASE_DEPTH;
    this.MAX_DEPTH =
      Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_PHASE_DEPTH;
  }

  /**
   * Profundidade maxima configurada (exposta para testes / introspeccao).
   */
  get maxDepth(): number {
    return this.MAX_DEPTH;
  }

  /**
   * Valida que setar `idPai=newParentId` em `taskId` NAO cria ciclo.
   *
   * Sobe pelos ancestrais a partir de `newParentId`. Se encontrar `taskId`
   * no caminho ascendente, e ciclo. Tambem enforce profundidade max
   * (`MAX_PHASE_DEPTH`).
   *
   * Caso trivial: `newParentId === null` retorna sem queries (mover para raiz
   * eh sempre valido).
   *
   * Performance: O(depth) — no maximo `MAX_DEPTH` `findUnique`s. Aceitavel
   * em update path (uma operacao por request).
   *
   * @param taskId - chave da task que esta sendo movida
   * @param newParentId - novo `idPai` proposto (ou null para raiz)
   *
   * @throws {BadRequestException} Se ciclo detectado ou profundidade excedida
   * @throws {NotFoundException} Se pai (ou ancestral) nao existe ou esta excluido
   *
   * @example
   * ```typescript
   * // Antes de mover task=10 para fase=5
   * await phaseHierarchy.validateNoCycle(BigInt(10), BigInt(5));
   * ```
   */
  async validateNoCycle(taskId: bigint, newParentId: bigint | null): Promise<void> {
    // Mover para raiz e sempre valido
    if (newParentId === null) {
      return;
    }

    // Auto-parent: trivialmente ciclo
    if (taskId === newParentId) {
      throw new BadRequestException(`Task ${taskId} nao pode ser pai de si mesma`);
    }

    let current: bigint | null = newParentId;
    let depth = 0;

    while (current !== null) {
      // Ciclo detectado: encontramos taskId no caminho ascendente
      if (current === taskId) {
        throw new BadRequestException(
          `Ciclo na hierarquia: definir idPai=${newParentId} em task ${taskId} criaria loop`,
        );
      }

      const parent: { idPai: bigint | null; excluido: boolean } | null =
        await this.prisma.dTask.findUnique({
          where: { chave: current },
          select: { idPai: true, excluido: true },
        });

      if (!parent || parent.excluido) {
        throw new NotFoundException(`Pai ${current} nao encontrado ou excluido`);
      }

      depth++;
      if (depth > this.MAX_DEPTH) {
        throw new BadRequestException(
          `Profundidade maxima (${this.MAX_DEPTH}) excedida na hierarquia de fases`,
        );
      }

      current = parent.idPai;
    }
  }

  /**
   * Valida que filha (`taskId`) e pai (`newParentId`) pertencem ao mesmo
   * `idProject`. Fase cross-project e proibida (CEO, ADR-V2-047).
   *
   * Caso trivial: `newParentId === null` retorna sem queries (sem pai
   * = qualquer projeto).
   *
   * Performance: 2 queries em paralelo (`Promise.all`).
   *
   * @param taskId - chave da task filha
   * @param newParentId - chave do novo pai proposto (ou null)
   *
   * @throws {BadRequestException} Se `idProject` divergem
   * @throws {NotFoundException} Se task ou pai nao existem
   *
   * @example
   * ```typescript
   * await phaseHierarchy.validateProjectConsistency(BigInt(10), BigInt(5));
   * ```
   */
  async validateProjectConsistency(taskId: bigint, newParentId: bigint | null): Promise<void> {
    if (newParentId === null) {
      return;
    }

    const [task, parent] = await Promise.all([
      this.prisma.dTask.findUnique({
        where: { chave: taskId },
        select: { idProject: true },
      }),
      this.prisma.dTask.findUnique({
        where: { chave: newParentId },
        select: { idProject: true },
      }),
    ]);

    if (!task) {
      throw new NotFoundException(`Task ${taskId} nao encontrada`);
    }
    if (!parent) {
      throw new NotFoundException(`Pai ${newParentId} nao encontrado`);
    }

    const taskProject = task.idProject?.toString() ?? null;
    const parentProject = parent.idProject?.toString() ?? null;

    if (taskProject !== parentProject) {
      throw new BadRequestException(
        `Cross-project parent nao permitido: task.idProject=${taskProject} vs pai.idProject=${parentProject}`,
      );
    }
  }

  /**
   * Soft-delete recursivo via CTE: marca `taskId` e TODOS descendentes como
   * `excluido=true` em uma unica statement PostgreSQL.
   *
   * Idempotente: descendentes ja excluidos sao ignorados (CTE filtra com
   * `excluido = false`). Task inexistente retorna `affected = 0` sem erro.
   *
   * Guardrail `depth < 20` na propria CTE como defesa em profundidade
   * (alem do `validateNoCycle` no create).
   *
   * @param taskId - chave da raiz do soft-delete
   * @returns objeto com contagem de linhas afetadas (raiz + descendentes)
   *
   * @example
   * ```typescript
   * const { affected } = await phaseHierarchy.softDeleteCascade(BigInt(5));
   * logger.log(`Fase 5 e ${affected - 1} descendentes excluidos`);
   * ```
   */
  async softDeleteCascade(taskId: bigint): Promise<{ affected: number }> {
    this.logger.log(`softDeleteCascade: iniciando cascade soft-delete da task=${taskId}`);

    const result = await this.prisma.$executeRaw`
      WITH RECURSIVE descendants AS (
        SELECT chave, 0 AS depth
        FROM "DTask"
        WHERE chave = ${taskId} AND excluido = false

        UNION ALL

        SELECT t.chave, d.depth + 1
        FROM "DTask" t
        INNER JOIN descendants d ON t."idPai" = d.chave
        WHERE t.excluido = false AND d.depth < 20
      )
      UPDATE "DTask"
      SET excluido = true, "atualizadoEm" = NOW()
      WHERE chave IN (SELECT chave FROM descendants)
    `;

    const affected = Number(result);
    this.logger.log(`softDeleteCascade: task=${taskId} afetou ${affected} registros`);
    return { affected };
  }
}
