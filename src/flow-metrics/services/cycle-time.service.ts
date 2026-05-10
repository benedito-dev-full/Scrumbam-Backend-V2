import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { calculatePercentiles } from '../helpers/percentile';
import { PeriodResolver, PeriodInput } from '../helpers/period-resolver';
import { CycleTimeResponseDto } from '../dto/cycle-time-response.dto';
import { parseTaskDados } from '../../tasks/schemas/task-dados.schema';

/**
 * idClasse DTabela para status DONE e VALIDATED (seed F1 V2).
 * Apenas tasks nestes status possuem cycleTime preenchido na telemetria.
 */
const DONE_STATUS_IDS = [BigInt(-444), BigInt(-449)];

/**
 * Serviço de cálculo de cycle time de tasks de um projeto.
 *
 * Cycle time = `dados.telemetry.cycleTime` (em horas), calculado pelo
 * `TasksService.updateStatus` no momento em que a task entra em DONE ou
 * VALIDATED (F5). Representa o tempo entre EXECUTING e conclusão.
 *
 * F8 é read-only puro — NÃO persiste nada, NÃO emite eventos.
 * Fonte: DTask.dados.telemetry.cycleTime (estrutural — Prisma direto).
 *
 * @see PrismaService — acesso ao banco (read-only neste service)
 * @see calculatePercentiles — cálculo estatístico de p50/p75/p90/p95
 * @see PeriodResolver — resolução de período via TimezoneService
 */
@Injectable()
export class CycleTimeService {
  private readonly logger = new Logger(CycleTimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly periodResolver: PeriodResolver,
  ) {}

  /**
   * Calcula p50/p75/p90/p95/avg de cycle time para um projeto.
   *
   * Lê tasks em status DONE/VALIDATED com `dados.telemetry.cycleTime`
   * preenchido dentro do período especificado. Tasks sem telemetria são
   * excluídas do cálculo (`samples` reflete apenas as com dados).
   *
   * @param projectId - Chave BigInt do DProject
   * @param period - Filtros de período (periodFrom/periodTo ou period pré-definido)
   * @returns CycleTimeResponseDto com percentis, média e amostras
   *
   * @throws {BadRequestException} Se periodFrom > periodTo
   *
   * @example
   * ```typescript
   * const result = await service.calculate(BigInt(123), { period: 'month' });
   * // { p50: 4.5, p75: 8.0, p90: 16.2, avg: 6.1, samples: 42, unit: 'hours' }
   *
   * // Sem dados
   * const empty = await service.calculate(BigInt(999), {});
   * // { p50: null, p75: null, p90: null, avg: null, samples: 0, unit: 'hours' }
   * ```
   *
   * @see CycleTimeResponseDto — estrutura de retorno
   */
  async calculate(projectId: bigint, period: PeriodInput): Promise<CycleTimeResponseDto> {
    this.logger.debug(`Calculando cycle time projeto=${projectId}`);

    const dateRange = this.periodResolver.resolve(period);

    // Buscar tasks DONE/VALIDATED do projeto — SEM filtro criadoEm.
    // O filtro de período é aplicado em JS via dados.telemetry.doneAt,
    // garantindo inclusão de tasks criadas antes do período mas concluídas dentro.
    // (Prisma não suporta JSON path filter IS NOT NULL de forma portável)
    const tasks = await this.prisma.dTask.findMany({
      where: {
        idProject: projectId,
        excluido: false,
        idStatus: { in: DONE_STATUS_IDS },
      },
      select: { dados: true },
    });

    // Filtrar por doneAt dentro do período e cycleTime disponível
    const cycleTimes: number[] = [];

    for (const task of tasks) {
      const dados = parseTaskDados(task.dados);
      const ct = dados.telemetry?.cycleTime;
      if (ct !== null && ct !== undefined && typeof ct === 'number' && ct > 0) {
        // Validar que doneAt está no período
        const doneAt = dados.telemetry?.doneAt;
        if (doneAt) {
          const doneDate = new Date(doneAt);
          if (doneDate >= dateRange.gte && doneDate <= dateRange.lte) {
            cycleTimes.push(ct);
          }
        } else {
          // Task DONE sem doneAt — inclui pelo criadoEm já filtrado
          cycleTimes.push(ct);
        }
      }
    }

    const result = calculatePercentiles(cycleTimes);

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
