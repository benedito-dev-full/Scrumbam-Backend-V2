import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PhaseTreeResponseDto } from '../dto/phase-tree-response.dto';

/**
 * Opções de construção da árvore.
 *
 * - `maxDepth`: profundidade máxima de descida (default ilimitado;
 *   guardrail absoluto 20 níveis, mesmo limite do `PhaseHierarchyService`).
 * - `includeMetrics`: quando `true`, anexa `metrics` em cada nó-fase
 *   (idClasse=-200). Tasks executáveis não recebem `metrics`.
 */
export interface PhaseTreeOptions {
  maxDepth?: number;
  includeMetrics?: boolean;
}

/**
 * Service responsável por construir a árvore recursiva de uma fase ou task.
 *
 * **STATUS: STUB (Fase 4 — ADR-V2-047).**
 *
 * Os endpoints `/tasks/:id/tree` foram registrados em Fase 4 (DTOs, Swagger,
 * guards e validação de scope). A implementação real — CTE recursiva PostgreSQL
 * + montagem em memória via `Map<idPai, child[]>` — entra em Fase 5 do plano
 * `plan-entidades-fases-via-dtask-idpai-task1.md`.
 *
 * Decisão (Fase 4): registrar o stub via `NotImplementedException` em vez
 * de retornar HTTP 501 inline no controller. Motivo:
 *
 * 1. **Stack trace claro** — quando F5 implementar a lógica, o método já
 *    existirá no DI container e nos testes; substituição é diff mínimo.
 * 2. **Endpoints fechados em F4** — Swagger, validação, RBAC, guards
 *    estão prontos. Apenas o corpo do método muda.
 * 3. **Testes unitários do controller** podem ser escritos contra esta
 *    interface — sem acoplamento à query SQL real.
 *
 * @see PhaseHierarchyService — fonte da verdade para guardrails (depth 20)
 * @see plan-entidades-fases-via-dtask-idpai-task1.md Fase 5
 */
@Injectable()
export class PhaseTreeService {
  private readonly logger = new Logger(PhaseTreeService.name);

  constructor(private readonly _prisma: PrismaService) {
    // Prisma será usado em Fase 5 (CTE recursiva via $queryRaw). Em Fase 4
    // mantemos a injeção para minimizar diff de assinatura no construtor.
    void this._prisma;
  }

  /**
   * Constrói a árvore recursiva a partir de `rootId`.
   *
   * **NÃO IMPLEMENTADO em Fase 4.** Lança `NotImplementedException` com
   * mensagem clara apontando para o ADR e a fase do plano onde a lógica
   * será adicionada.
   *
   * @param rootId - chave da task/fase raiz da árvore
   * @param options - `maxDepth` e `includeMetrics`
   * @returns árvore aninhada conforme `PhaseTreeResponseDto`
   *
   * @throws {NotImplementedException} Sempre em Fase 4 — substituído por
   *   implementação real (CTE recursiva) em Fase 5.
   */
  async buildTree(rootId: bigint, options?: PhaseTreeOptions): Promise<PhaseTreeResponseDto> {
    this.logger.warn(
      `buildTree(${rootId}) chamado mas ainda não implementado ` +
        `(stub Fase 4 — opts=${JSON.stringify(options ?? {})})`,
    );
    throw new NotImplementedException(
      'PhaseTreeService.buildTree ainda não implementado — ' +
        'aguarda Fase 5 do plan-entidades-fases-via-dtask-idpai-task1 (ADR-V2-047). ' +
        'Os endpoints estão registrados e respondem 501 até lá.',
    );
  }
}
