import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { calculatePercentiles } from '../helpers/percentile';
import { PeriodResolver, PeriodInput } from '../helpers/period-resolver';
import { LeadTimeResponseDto } from '../dto/lead-time-response.dto';
import { parseTaskDados } from '../../tasks/schemas/task-dados.schema';

/**
 * idClasse DTabela para status DONE e VALIDATED (seed F1 V2).
 */
const DONE_STATUS_IDS = [BigInt(-444), BigInt(-449)];

/**
 * Serviço de cálculo de lead time de tasks de um projeto.
 *
 * Lead time = `dados.telemetry.leadTime` (em horas), calculado pelo
 * `TasksService.updateStatus` no momento da conclusão. Representa o
 * tempo total desde a criação da task (INBOX) até DONE/VALIDATED.
 *
 * F8 é read-only puro — NÃO persiste nada, NÃO emite eventos.
 * Fonte: DTask.dados.telemetry.leadTime (estrutural — Prisma direto).
 *
 * @see PrismaService — acesso ao banco (read-only neste service)
 * @see calculatePercentiles — cálculo estatístico de p50/p75/p90/p95
 * @see PeriodResolver — resolução de período via TimezoneService
 */
@Injectable()
export class LeadTimeService {
  private readonly logger = new Logger(LeadTimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly periodResolver: PeriodResolver,
  ) {}

  /**
   * Calcula p50/p75/p90/p95/avg de lead time para um projeto.
   *
   * Lê tasks em status DONE/VALIDATED com `dados.telemetry.leadTime`
   * preenchido dentro do período. Tasks sem telemetria são excluídas
   * do cálculo (`samples` reflete apenas as com dados disponíveis).
   *
   * @param projectId - Chave BigInt do DProject
   * @param period - Filtros de período (periodFrom/periodTo ou period pré-definido)
   * @returns LeadTimeResponseDto com percentis, média e amostras
   *
   * @throws {BadRequestException} Se periodFrom > periodTo
   *
   * @example
   * ```typescript
   * const result = await service.calculate(BigInt(123), { period: 'week' });
   * // { p50: 24.0, p75: 48.5, p90: 96.0, avg: 32.4, samples: 38, unit: 'hours' }
   *
   * // Sem dados no período
   * const empty = await service.calculate(BigInt(999), {});
   * // { p50: null, p75: null, p90: null, avg: null, samples: 0, unit: 'hours' }
   * ```
   *
   * @see LeadTimeResponseDto — estrutura de retorno
   */
  async calculate(projectId: bigint, period: PeriodInput): Promise<LeadTimeResponseDto> {
    this.logger.debug(`Calculando lead time projeto=${projectId}`);

    const dateRange = this.periodResolver.resolve(period);

    // SEM filtro criadoEm — o período é aplicado em JS via dados.telemetry.doneAt,
    // garantindo inclusão de tasks criadas antes do período mas concluídas dentro.
    const tasks = await this.prisma.dTask.findMany({
      where: {
        idProject: projectId,
        excluido: false,
        idStatus: { in: DONE_STATUS_IDS },
      },
      select: { dados: true },
    });

    const leadTimes: number[] = [];

    for (const task of tasks) {
      const dados = parseTaskDados(task.dados);
      const lt = dados.telemetry?.leadTime;
      if (lt !== null && lt !== undefined && typeof lt === 'number' && lt > 0) {
        const doneAt = dados.telemetry?.doneAt;
        if (doneAt) {
          const doneDate = new Date(doneAt);
          if (doneDate >= dateRange.gte && doneDate <= dateRange.lte) {
            leadTimes.push(lt);
          }
        } else {
          leadTimes.push(lt);
        }
      }
    }

    const result = calculatePercentiles(leadTimes);

    return {
      p50: result?.p50 ?? null,
      p75: result?.p75 ?? null,
      p90: result?.p90 ?? null,
      avg: result?.avg ?? null,
      samples: result?.samples ?? 0,
      unit: 'hours',
    };
  }
}
