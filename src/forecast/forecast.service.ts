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
 * Serviço de forecast de conclusão de projetos via Monte Carlo.
 *
 * Orquestra:
 * 1. Buscar throughput histórico (janela móvel agrupada por semana)
 * 2. Contar tasks restantes (não-DONE)
 * 3. Simular via bootstrap resample (Decisão D3)
 *
 * Throughput histórico é calculado a partir de uma janela móvel de 30 dias
 * agrupada por semana. Se vazio → BadRequestException com mensagem clara.
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
   * @param query - Parâmetros de forecast (historicalPeriods, iterations)
   * @returns ForecastResponseDto com p50/p75/p85/p95 em dias
   *
   * @throws {NotFoundException} Se projeto não encontrado
   * @throws {BadRequestException} Se sem histórico suficiente para forecast
   *
   * @example
   * ```typescript
   * const result = await service.forecast(BigInt(123), { historicalPeriods: 4, iterations: 10000 });
   * // { p50: 12, p75: 18, p85: 22, p95: 35, unit: 'days', tasksRemaining: 30, ... }
   * ```
   *
   * @see ForecastResponseDto — estrutura de retorno
   * @see simulate — implementação do Monte Carlo
   */
  async forecast(projectId: bigint, query: ForecastQueryDto): Promise<ForecastResponseDto> {
    this.logger.log(`Forecast projeto=${projectId} historicalPeriods=${query.historicalPeriods}`);

    const iterations = query.iterations ?? 10000;

    // 1. Validar existência do projeto
    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { chave: true },
    });
    if (!project) {
      throw new NotFoundException(`Projeto ${projectId} não encontrado`);
    }

    // 2. Buscar throughput histórico (janela móvel agrupada por semana)
    const { historicalThroughput, source } = await this.resolveHistoricalThroughput(projectId);

    if (historicalThroughput.length < 2) {
      throw new BadRequestException(
        'Sem histórico de throughput suficiente para forecast. ' +
        'É necessário ao menos 2 semanas com tasks concluídas.',
      );
    }

    // 3. Contar tasks restantes (não-DONE)
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
    // Throughput é por semana (7 dias por período).
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
   * Resolve throughput histórico via janela móvel de 30 dias (por semana).
   *
   * @param projectId - ID do projeto
   * @returns Throughput histórico e fonte usada
   */
  private async resolveHistoricalThroughput(
    projectId: bigint,
  ): Promise<{ historicalThroughput: number[]; source: 'rolling-window' }> {
    // Janela móvel 30 dias (agrupado por semana)
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
   * Conta tasks restantes (não-DONE) no projeto.
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
          idStatus: { in: [BigInt(-444)] },
        },
      },
    });
  }
}
