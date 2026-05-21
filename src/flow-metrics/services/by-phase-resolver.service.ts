import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { JwtPayload } from '../../auth/decorators/current-user.decorator';
import { PhaseDescendantsService } from './phase-descendants.service';

/**
 * idClasse PHASE (-200) — agregador hierárquico (ADR-V2-047).
 */
const ID_CLASSE_PHASE = BigInt(-200);

/**
 * Resultado da resolução de uma fase para uso em Flow Metrics by-phase.
 */
export interface ResolvedPhaseScope {
  /** Chave BigInt do `DProject` raiz da fase (usado para resolveProjectId pelos services). */
  projectId: bigint;
  /** Chaves de tasks-folha descendentes (pode ser `[]` se fase vazia). */
  taskIds: bigint[];
}

/**
 * Resolve uma fase (`DTask` `idClasse=-200`) em `{ projectId, taskIds }` para
 * uso pelos endpoints `/flow-metrics/by-phase/:phaseId/<metric>`.
 *
 * Responsabilidades:
 *  1. Validar que `phaseId` existe e é uma fase (`idClasse=-200`).
 *  2. Validar tenant scope (ADR-V2-042): a fase deve pertencer à mesma
 *     organização do JWT (via projeto raiz).
 *  3. Disparar `PhaseDescendantsService.findDescendantTaskIds` para enumerar
 *     as folhas via CTE recursiva.
 *  4. Devolver `{ projectId, taskIds }` para que o controller invoque o
 *     service de métrica apropriado com `taskIdsFilter`.
 *
 * **Anti-enumeration:** todas as condições de falha (fase inexistente,
 * fase de outra org, idClasse incorreto) resultam em `NotFoundException`
 * com mensagem genérica `"Fase {id} não encontrada"`. Não revela se a fase
 * existe em outra organização (pattern idêntico ao `findOne` de tasks).
 *
 * **N+1 budget:** 2 queries totais:
 *  - 1 `findUnique` para resolver projeto + tenant + idClasse;
 *  - 1 CTE recursiva no `PhaseDescendantsService` para folhas.
 *
 * F9b é read-only — NÃO persiste, NÃO emite eventos.
 *
 * @see PhaseDescendantsService — CTE recursiva que retorna folhas
 * @see FlowMetricsController — consumidor (`/flow-metrics/by-phase/:phaseId/*`)
 */
@Injectable()
export class ByPhaseResolverService {
  private readonly logger = new Logger(ByPhaseResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly phaseDescendants: PhaseDescendantsService,
  ) {}

  /**
   * Resolve uma fase para `{ projectId, taskIds }` validando tenant scope.
   *
   * @param phaseId - ID da fase em string (path param HTTP).
   * @param user - Payload JWT do usuário autenticado (contém organizationId).
   * @returns `ResolvedPhaseScope` com `projectId` + lista de IDs de folhas.
   *
   * @throws {NotFoundException} Se fase inexistente, soft-deleted, idClasse !== -200,
   *                             ou pertencer a outra org (anti-enumeration unificado).
   * @throws {ForbiddenException} Se fase pertence a outra organização (validação tenant scope).
   *
   * @example
   * ```typescript
   * const { projectId, taskIds } = await resolver.resolve('7', user);
   * // projectId = BigInt(123); taskIds = [BigInt(10), BigInt(11), ...]
   * ```
   */
  async resolve(phaseId: string, user: JwtPayload): Promise<ResolvedPhaseScope> {
    let pid: bigint;
    try {
      pid = BigInt(phaseId);
    } catch {
      throw new NotFoundException(`Fase ${phaseId} não encontrada`);
    }

    // 1. Buscar fase + projeto (1 query — join via select de relação).
    //    Pega `idClasse` para validar PHASE, `idProject` para resolver projeto
    //    raiz, e `excluido`. Project lookup faz join com DProject para resgatar
    //    `idEstab` do projeto (necessário para tenant check).
    const phase = await this.prisma.dTask.findUnique({
      where: { chave: pid },
      select: {
        chave: true,
        idClasse: true,
        idProject: true,
        excluido: true,
        project: { select: { chave: true, idEstab: true } },
      },
    });

    if (!phase || phase.excluido) {
      throw new NotFoundException(`Fase ${phaseId} não encontrada`);
    }

    // 2. Verificar idClasse === -200 (PHASE). Mensagem genérica anti-enum.
    if (phase.idClasse !== ID_CLASSE_PHASE) {
      throw new NotFoundException(`Fase ${phaseId} não encontrada`);
    }

    // 3. Resolver projectId raiz.
    if (!phase.idProject || !phase.project) {
      throw new NotFoundException(`Fase ${phaseId} não encontrada`);
    }

    // 4. Tenant check (defense-in-depth ADR-V2-042) — usa NotFound para
    //    anti-enumeration (idêntico ao pattern de tasks.controller findOne).
    if (user.organizationId && phase.project.idEstab) {
      if (phase.project.idEstab.toString() !== user.organizationId) {
        throw new ForbiddenException('Acesso negado: fase pertence a outra organização');
      }
    }

    // 5. CTE recursiva — folhas descendentes (1 query)
    const taskIds = await this.phaseDescendants.findDescendantTaskIds(pid);

    this.logger.debug(
      `resolve(${phaseId}) → projectId=${phase.idProject.toString()} taskIds.length=${taskIds.length}`,
    );

    return { projectId: phase.idProject, taskIds };
  }
}
