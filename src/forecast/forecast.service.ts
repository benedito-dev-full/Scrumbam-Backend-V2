import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ThroughputService } from '../flow-metrics/services/throughput.service';
import { PeriodResolver } from '../flow-metrics/helpers/period-resolver';
import { simulate } from './monte-carlo.engine';
import { ForecastQueryDto } from './dto/forecast-query.dto';
import { ForecastResponseDto } from './dto/forecast-response.dto';

/**
 * idClasse de DTabela para sprints V2 (seed F1 — range -400..-419).
 */
const SPRINT_CLASSE_MIN = BigInt(-419);
const SPRINT_CLASSE_MAX = BigInt(-400);

/**
 * Serviço de forecast de conclusão de projetos via Monte Carlo.
 *
 * Orquestra:
 * 1. Buscar throughput histórico (últimos N sprints ou janela móvel 30d — Decisão D4)
 * 2. Contar tasks restantes (não-DONE/VALIDATED)
 * 3. Simular via bootstrap resample (Decisão D3)
 *
 * Decisão D4 (plano §5):
 * - Default: throughput por sprint (DTabela range -400..-419, N=`historicalSprints`)
 * - Fallback: janela móvel 30 dias agrupada por semana se sprints < 2
 * - Se ambos vazios → BadRequestException com mensagem clara
 *
 * F8 é read-only puro — NÃO persiste nada, NÃO emite eventos.
 *
 * @see ThroughputService — cálculo de throughput histórico
 * @see WipAgeService — contagem de tasks restantes (total WIP)
 * @see simulate — Monte Carlo bootstrap resample
 */
@Injectable()
export class ForecastService {
  private readonly logger = new Logger(ForecastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly throughputService: ThroughputService,
    private readonly periodResolver: PeriodResolver,
  ) {}

  /**
   * Calcula forecast de conclusão do projeto via Monte Carlo.
   *
   * @param projectId - Chave BigInt do DProject
   * @param query - Parâmetros de forecast (historicalSprints, iterations)
   * @returns ForecastResponseDto com p50/p75/p85/p95 em dias
   *
   * @throws {NotFoundException} Se projeto não encontrado
   * @throws {BadRequestException} Se sem histórico suficiente para forecast
   *
   * @example
   * ```typescript
   * const result = await service.forecast(BigInt(123), { historicalSprints: 4, iterations: 10000 });
   * // { p50: 12, p75: 18, p85: 22, p95: 35, unit: 'days', tasksRemaining: 30, ... }
   * ```
   *
   * @see ForecastResponseDto — estrutura de retorno
   * @see simulate — implementação do Monte Carlo
   */
  async forecast(projectId: bigint, query: ForecastQueryDto): Promise<ForecastResponseDto> {
    this.logger.log(`Forecast projeto=${projectId} historicalSprints=${query.historicalSprints}`);

    const historicalSprints = query.historicalSprints ?? 4;
    const iterations = query.iterations ?? 10000;

    // 1. Validar existência do projeto
    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { chave: true },
    });
    if (!project) {
      throw new NotFoundException(`Projeto ${projectId} não encontrado`);
    }

    // 2. Buscar throughput histórico
    const { historicalThroughput, source } = await this.resolveHistoricalThroughput(
      projectId,
      historicalSprints,
    );

    if (historicalThroughput.length < 2) {
      throw new BadRequestException(
        'Sem histórico de throughput suficiente para forecast. ' +
        'É necessário ao menos 2 sprints completos ou 2 semanas com tasks concluídas.',
      );
    }

    // 3. Contar tasks restantes (não-DONE/VALIDATED)
    const tasksRemaining = await this.countTasksRemaining(projectId);

    if (tasksRemaining === 0) {
      this.logger.log(`Projeto ${projectId} sem tasks restantes — retornando forecast 0 dias`);
      return {
        p50: 0,
        p75: 0,
        p85: 0,
        p95: 0,
        unit: 'days',
        tasksRemaining: 0,
        iterations,
        source,
      };
    }

    // 4. Monte Carlo bootstrap resample
    const mcResult = simulate({
      tasksRemaining,
      throughputHistorical: historicalThroughput,
      iterations,
    });

    // 5. Converter períodos → dias
    // Se fonte é 'sprints': throughput é por sprint (assumir 7 dias por período)
    // Se fonte é 'rolling-window': throughput é por semana (7 dias por período)
    const daysPerPeriod = 7;

    return {
      p50: mcResult.p50 * daysPerPeriod,
      p75: mcResult.p75 * daysPerPeriod,
      p85: mcResult.p85 * daysPerPeriod,
      p95: mcResult.p95 * daysPerPeriod,
      unit: 'days',
      tasksRemaining,
      iterations: mcResult.iterations,
      source,
      avgThroughput: mcResult.avgThroughput,
    };
  }

  /**
   * Resolve throughput histórico via sprints ou janela móvel (Decisão D4).
   *
   * @param projectId - ID do projeto
   * @param historicalSprints - Número de sprints a considerar
   * @returns Throughput histórico e fonte usada
   */
  private async resolveHistoricalThroughput(
    projectId: bigint,
    historicalSprints: number,
  ): Promise<{ historicalThroughput: number[]; source: 'sprints' | 'rolling-window' }> {
    // Tentativa 1: últimos N sprints
    const sprintThroughput = await this.getSprintThroughput(projectId, historicalSprints);

    if (sprintThroughput.length >= 2) {
      this.logger.debug(`Usando throughput de ${sprintThroughput.length} sprints`);
      return { historicalThroughput: sprintThroughput, source: 'sprints' };
    }

    this.logger.debug(`Sprints insuficientes (${sprintThroughput.length}), usando rolling window 30d`);

    // Fallback: janela móvel 30 dias (agrupado por semana)
    const last30d = this.periodResolver.getLast30Days();
    const rollingWindow = await this.throughputService.getHistoricalArray(
      projectId,
      {
        periodFrom: last30d.gte.toISOString().slice(0, 10),
        periodTo: last30d.lte.toISOString().slice(0, 10),
      },
      'week',
    );

    return { historicalThroughput: rollingWindow, source: 'rolling-window' };
  }

  /**
   * Calcula throughput por sprint para os últimos N sprints do projeto.
   *
   * Busca DTabela com idClasse no range -400..-419 (sprints V2),
   * ordenados por criadoEm DESC, pega os N mais recentes, e conta
   * tasks DONE/VALIDATED em cada período de sprint.
   *
   * @param projectId - ID do projeto
   * @param n - Número de sprints a buscar
   * @returns Array de counts por sprint (ordenado do mais antigo ao mais recente)
   */
  private async getSprintThroughput(projectId: bigint, n: number): Promise<number[]> {
    // Buscar sprints do projeto (DTabela com idClasse range -400..-419)
    const sprints = await this.prisma.dTabela.findMany({
      where: {
        idClasse: { gte: SPRINT_CLASSE_MIN, lte: SPRINT_CLASSE_MAX },
        excluido: false,
        // Sprints vinculados ao projeto via dados.projectId (padrão F5)
        // Não há FK direta de DTabela para DProject — usar dados JSON
      },
      select: { chave: true, dados: true, criadoEm: true, nome: true },
      orderBy: { criadoEm: 'desc' },
      take: n,
    });

    // Filtrar sprints do projeto via dados.projectId
    const projectSprints = sprints.filter((s) => {
      const d = s.dados as Record<string, unknown> | null;
      if (!d) return false;
      const pid = d['projectId'] as string | undefined;
      return pid && pid === projectId.toString();
    });

    if (projectSprints.length < 2) {
      return [];
    }

    const sprintsOrdered = [...projectSprints].reverse();
    const sprintChaves = sprintsOrdered.map((s) => s.chave);

    // 1 query: contar tasks DONE/VALIDATED agrupadas por idSprint
    const groupedCounts = await this.prisma.dTask.groupBy({
      by: ['idSprint'],
      where: {
        idProject: projectId,
        excluido: false,
        idStatus: { in: [BigInt(-444), BigInt(-449)] },
        idSprint: { in: sprintChaves },
      },
      _count: { chave: true },
    });

    // Mapear resultado em JS: sprintChave -> count
    const countBySprintId = new Map<bigint, number>();
    for (const g of groupedCounts) {
      if (g.idSprint !== null && g.idSprint !== undefined) {
        countBySprintId.set(g.idSprint, g._count.chave);
      }
    }

    // Fallback por doneAt: 1 query única para sprints com count=0 que têm datas válidas
    const sprintsNeedingFallback = sprintsOrdered.filter((s) => {
      if ((countBySprintId.get(s.chave) ?? 0) > 0) return false;
      const d = s.dados as Record<string, unknown>;
      return !!d['startDate'] && !!d['endDate'];
    });

    let fallbackTasks: { dados: unknown }[] = [];
    if (sprintsNeedingFallback.length > 0) {
      // 1 query: buscar todas as tasks DONE/VALIDATED com telemetria (doneAt)
      fallbackTasks = await this.prisma.dTask.findMany({
        where: {
          idProject: projectId,
          excluido: false,
          idStatus: { in: [BigInt(-444), BigInt(-449)] },
        },
        select: { dados: true },
      });
    }

    // Montar array final na ordem correta (mais antigo ao mais recente)
    const counts: number[] = [];

    for (const sprint of sprintsOrdered) {
      const countViaIdSprint = countBySprintId.get(sprint.chave) ?? 0;

      if (countViaIdSprint > 0) {
        counts.push(countViaIdSprint);
        continue;
      }

      // Fallback: filtrar por doneAt dentro do período do sprint
      const sprintDados = sprint.dados as Record<string, unknown>;
      const startStr = sprintDados['startDate'] as string | undefined;
      const endStr = sprintDados['endDate'] as string | undefined;

      if (!startStr || !endStr) {
        counts.push(0);
        continue;
      }

      const startDate = new Date(startStr);
      const endDate = new Date(endStr);
      let sprintCount = 0;

      for (const task of fallbackTasks) {
        const td = task.dados as Record<string, unknown> | null;
        if (!td) continue;
        const tel = td['telemetry'] as Record<string, unknown> | undefined;
        const doneAt = tel?.['doneAt'] as string | undefined;
        if (!doneAt) continue;
        const doneDate = new Date(doneAt);
        if (doneDate >= startDate && doneDate <= endDate) {
          sprintCount++;
        }
      }

      counts.push(sprintCount);
    }

    return counts;
  }

  /**
   * Conta tasks restantes (não-DONE/VALIDATED) no projeto.
   *
   * @param projectId - ID do projeto
   * @returns Número de tasks restantes
   */
  private async countTasksRemaining(projectId: bigint): Promise<number> {
    return this.prisma.dTask.count({
      where: {
        idProject: projectId,
        excluido: false,
        NOT: {
          idStatus: { in: [BigInt(-444), BigInt(-449)] },
        },
      },
    });
  }
}
