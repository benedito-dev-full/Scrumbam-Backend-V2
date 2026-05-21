import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
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
 * Service de métricas agregadas de fases (% conclusão + contagens).
 *
 * **STATUS: STUB (Fase 4 — ADR-V2-047).**
 *
 * Os endpoints `/tasks/:id/metrics` foram registrados em Fase 4 (DTOs,
 * Swagger, guards, validação de scope). A implementação real — CTE recursiva
 * com `COUNT(*) FILTER (WHERE idStatus = X)` — entra em Fase 5 do plano
 * `plan-entidades-fases-via-dtask-idpai-task1.md`.
 *
 * Em F5 o método `compute` deve:
 * 1. Resolver os `idStatus` das DTabelas DONE/FAILED/EXECUTING do projeto
 *    da fase (lookup por `idClasse` + `dEntidadeId`).
 * 2. Rodar 1 CTE recursiva `$queryRaw` agregando por status.
 * 3. Calcular `percent = done / total * 100` com fallback `0` se `total=0`.
 *
 * @see plan-entidades-fases-via-dtask-idpai-task1.md Fase 5 (linhas 437-444)
 */
@Injectable()
export class PhaseMetricsService {
  private readonly logger = new Logger(PhaseMetricsService.name);

  constructor(private readonly _prisma: PrismaService) {
    // Prisma será usado em Fase 5 (CTE via $queryRaw). Injetado já em F4
    // para deixar a assinatura final pronta — testes unitários podem
    // injetar mocks sem mudar construtor depois.
    void this._prisma;
  }

  /**
   * Calcula métricas agregadas da fase indicada.
   *
   * **NÃO IMPLEMENTADO em Fase 4.** Lança `NotImplementedException`.
   *
   * @param phaseId - chave da fase/task raiz
   * @param options - `recursive` (default true)
   * @returns objeto com `total`, `done`, `failed`, `inProgress`, `pending`,
   *   `percent`, `recursive`, `computedAt`
   *
   * @throws {NotImplementedException} Sempre em Fase 4.
   */
  async compute(
    phaseId: bigint,
    options?: PhaseMetricsOptions,
  ): Promise<PhaseMetricsResponseDto> {
    this.logger.warn(
      `compute(${phaseId}) chamado mas ainda não implementado ` +
        `(stub Fase 4 — opts=${JSON.stringify(options ?? {})})`,
    );
    throw new NotImplementedException(
      'PhaseMetricsService.compute ainda não implementado — ' +
        'aguarda Fase 5 do plan-entidades-fases-via-dtask-idpai-task1 (ADR-V2-047). ' +
        'O endpoint está registrado e responde 501 até lá.',
    );
  }
}
