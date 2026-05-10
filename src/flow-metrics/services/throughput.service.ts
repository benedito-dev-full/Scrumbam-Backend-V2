import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { PeriodResolver, PeriodInput } from '../helpers/period-resolver';
import { ThroughputResponseDto, ThroughputDataPointDto } from '../dto/throughput-response.dto';
import { DateRange } from '../../common/services/timezone.service';

/**
 * Linha de resultado do $queryRaw de throughput.
 */
interface ThroughputRawRow {
  d: Date | string;
  c: number | string | bigint;
}

/**
 * Serviço de cálculo de throughput de tasks de um projeto.
 *
 * Throughput = quantidade de tasks concluídas (DONE/VALIDATED) por período.
 * Usa `dados.telemetry.doneAt` como timestamp de conclusão via $queryRaw
 * parametrizado com `date_trunc` — sem interpolação de string (seguro contra injection).
 *
 * F8 é read-only puro — NÃO persiste nada, NÃO emite eventos.
 *
 * Nota técnica (plano §6 nota 2): Prisma groupBy não suporta date_trunc em
 * campos JSON nativamente. Usamos $queryRaw com parâmetros Prisma.sql para
 * evitar SQL injection.
 *
 * @see PrismaService — acesso ao banco (read-only neste service)
 * @see PeriodResolver — resolução de período via TimezoneService
 */
@Injectable()
export class ThroughputService {
  private readonly logger = new Logger(ThroughputService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly periodResolver: PeriodResolver,
  ) {}

  /**
   * Calcula série temporal de throughput para um projeto.
   *
   * Agrupa tasks concluídas por dia ou semana dentro do período.
   * Usa SQL raw parametrizado com date_trunc sobre o campo JSON `doneAt`.
   *
   * @param projectId - Chave BigInt do DProject
   * @param granularity - Agrupamento temporal ('day' ou 'week')
   * @param period - Filtros de período
   * @returns ThroughputResponseDto com série temporal e total
   *
   * @throws {BadRequestException} Se periodFrom > periodTo
   *
   * @example
   * ```typescript
   * const result = await service.calculate(BigInt(123), 'day', { period: 'month' });
   * // {
   * //   series: [{ date: '2026-01-15', count: 3 }, ...],
   * //   total: 42,
   * //   granularity: 'day'
   * // }
   * ```
   *
   * @see ThroughputResponseDto — estrutura de retorno
   */
  async calculate(
    projectId: bigint,
    granularity: 'day' | 'week',
    period: PeriodInput,
  ): Promise<ThroughputResponseDto> {
    this.logger.debug(`Calculando throughput projeto=${projectId} granularity=${granularity}`);

    const dateRange = this.periodResolver.resolve(period);

    const rows = await this.queryThroughput(projectId, granularity, dateRange);

    const series: ThroughputDataPointDto[] = rows.map((row) => ({
      date: this.formatDate(row.d),
      count: Number(row.c),
    }));

    const total = series.reduce((acc, s) => acc + s.count, 0);

    return {
      series,
      total,
      granularity,
    };
  }

  /**
   * Executa a query raw de throughput com date_trunc.
   *
   * Parametrizado com Prisma.sql — sem interpolação de string.
   * Cast explícito ::bigint e ::timestamptz conforme plano §6 nota 2.
   *
   * @param projectId - ID do projeto
   * @param granularity - 'day' ou 'week'
   * @param dateRange - Intervalo de datas
   * @returns Array de {d: Date, c: number}
   */
  private async queryThroughput(
    projectId: bigint,
    granularity: 'day' | 'week',
    dateRange: DateRange,
  ): Promise<ThroughputRawRow[]> {
    // idClasse para DONE(-444) e VALIDATED(-449) como BigInt
    const doneIds = [BigInt(-444), BigInt(-449)];

    try {
      if (granularity === 'day') {
        return await this.prisma.$queryRaw<ThroughputRawRow[]>(
          Prisma.sql`
            SELECT
              date_trunc('day', (dados->'telemetry'->>'doneAt')::timestamptz) AS d,
              COUNT(*)::int AS c
            FROM "DTask"
            WHERE "idProject" = ${projectId}::bigint
              AND "excluido" = false
              AND "idStatus" IN (${doneIds[0]}::bigint, ${doneIds[1]}::bigint)
              AND (dados->'telemetry'->>'doneAt') IS NOT NULL
              AND (dados->'telemetry'->>'doneAt')::timestamptz >= ${dateRange.gte}::timestamptz
              AND (dados->'telemetry'->>'doneAt')::timestamptz <= ${dateRange.lte}::timestamptz
            GROUP BY 1
            ORDER BY 1 ASC
          `,
        );
      } else {
        return await this.prisma.$queryRaw<ThroughputRawRow[]>(
          Prisma.sql`
            SELECT
              date_trunc('week', (dados->'telemetry'->>'doneAt')::timestamptz) AS d,
              COUNT(*)::int AS c
            FROM "DTask"
            WHERE "idProject" = ${projectId}::bigint
              AND "excluido" = false
              AND "idStatus" IN (${doneIds[0]}::bigint, ${doneIds[1]}::bigint)
              AND (dados->'telemetry'->>'doneAt') IS NOT NULL
              AND (dados->'telemetry'->>'doneAt')::timestamptz >= ${dateRange.gte}::timestamptz
              AND (dados->'telemetry'->>'doneAt')::timestamptz <= ${dateRange.lte}::timestamptz
            GROUP BY 1
            ORDER BY 1 ASC
          `,
        );
      }
    } catch (err) {
      // Fallback: busca simples e agrega em JS
      this.logger.warn(`$queryRaw falhou, usando fallback JS: ${String(err)}`);
      return this.fallbackQuery(projectId, granularity, dateRange);
    }
  }

  /**
   * Fallback: busca tasks em JS e agrega por data manualmente.
   *
   * Usado quando $queryRaw falha (ex: ambiente sem suporte a JSON path).
   *
   * @param projectId - ID do projeto
   * @param granularity - Granularidade
   * @param dateRange - Intervalo
   */
  private async fallbackQuery(
    projectId: bigint,
    granularity: 'day' | 'week',
    dateRange: DateRange,
  ): Promise<ThroughputRawRow[]> {
    const tasks = await this.prisma.dTask.findMany({
      where: {
        idProject: projectId,
        excluido: false,
        idStatus: { in: [BigInt(-444), BigInt(-449)] },
      },
      select: { dados: true },
    });

    const countMap = new Map<string, number>();

    for (const task of tasks) {
      const raw = task.dados;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const dados = raw as Record<string, unknown>;
      const telemetry = dados['telemetry'] as Record<string, unknown> | undefined;
      const doneAtStr = telemetry?.['doneAt'] as string | undefined;
      if (!doneAtStr) continue;

      const doneAt = new Date(doneAtStr);
      if (doneAt < dateRange.gte || doneAt > dateRange.lte) continue;

      const key = this.truncateDate(doneAt, granularity);
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }

    return Array.from(countMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, count]) => ({ d: key, c: count }));
  }

  /**
   * Trunca uma data para dia ou semana no formato ISO string.
   */
  private truncateDate(date: Date, granularity: 'day' | 'week'): string {
    if (granularity === 'day') {
      return date.toISOString().slice(0, 10);
    }
    // Início da semana (segunda-feira)
    const d = new Date(date);
    const day = d.getUTCDay(); // 0=sun, 1=mon, ...
    const diff = (day === 0 ? -6 : 1 - day);
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Formata um Date ou string para YYYY-MM-DD.
   */
  private formatDate(d: Date | string): string {
    if (typeof d === 'string') {
      // Já é string — normalizar para YYYY-MM-DD
      return d.slice(0, 10);
    }
    return d.toISOString().slice(0, 10);
  }

  /**
   * Retorna o throughput histórico como array de números (tasks por período).
   *
   * Usado pelo ForecastService para alimentar o MonteCarloEngine.
   * Cada elemento representa a contagem de tasks por período.
   *
   * @param projectId - ID do projeto
   * @param period - Período de histórico
   * @param granularity - Granularidade ('day' ou 'week')
   * @returns Array de counts por período
   */
  async getHistoricalArray(
    projectId: bigint,
    period: PeriodInput,
    granularity: 'day' | 'week' = 'week',
  ): Promise<number[]> {
    const result = await this.calculate(projectId, granularity, period);
    return result.series.map((s) => s.count);
  }
}
