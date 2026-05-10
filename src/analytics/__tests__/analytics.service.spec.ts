import { BadRequestException } from '@nestjs/common';
import { TtlCacheService } from '../../common/cache/ttl-cache.service';
import { AnalyticsService } from '../analytics.service';

describe('AnalyticsService', () => {
  const projectId = BigInt(123);
  const fixedRange = {
    gte: new Date('2026-05-01T03:00:00.000Z'),
    lte: new Date('2026-05-10T02:59:59.999Z'),
  };

  let prisma: any;
  let cycleTime: any;
  let leadTime: any;
  let throughput: any;
  let wipAge: any;
  let forecast: any;
  let periodResolver: any;
  let service: AnalyticsService;

  beforeEach(() => {
    prisma = {
      dProject: {
        findMany: jest.fn(),
      },
      dTask: {
        count: jest.fn(),
      },
    };
    cycleTime = {
      calculate: jest
        .fn()
        .mockResolvedValueOnce({ avg: 0, p50: null, p75: null, p90: null, samples: 0, unit: 'hours' })
        .mockResolvedValueOnce({ avg: 5, p50: 5, p75: 6, p90: 7, samples: 2, unit: 'hours' }),
    };
    leadTime = {
      calculate: jest
        .fn()
        .mockResolvedValueOnce({ avg: 10, p50: 10, p75: 12, p90: 14, samples: 2, unit: 'hours' })
        .mockResolvedValueOnce({ avg: 5, p50: 5, p75: 6, p90: 7, samples: 2, unit: 'hours' }),
    };
    throughput = {
      calculate: jest
        .fn()
        .mockResolvedValueOnce({ series: [], total: 0, granularity: 'week' })
        .mockResolvedValueOnce({ series: [{ date: '2026-05-05', count: 4 }], total: 4, granularity: 'week' }),
    };
    wipAge = {
      calculate: jest.fn().mockResolvedValue({ byStatus: [], total: 3, calculatedAt: '2026-05-10T12:00:00.000Z' }),
    };
    forecast = {
      forecast: jest.fn(),
    };
    periodResolver = {
      resolve: jest.fn().mockReturnValue(fixedRange),
    };

    service = new AnalyticsService(
      prisma,
      new TtlCacheService(),
      cycleTime,
      leadTime,
      throughput,
      wipAge,
      forecast,
      periodResolver,
    );
  });

  it('compare calcula deltas seguros incluindo baseline zero', async () => {
    const result = await service.compareProject('10', projectId, {
      periodAFrom: '2026-04-01',
      periodATo: '2026-04-30',
      periodBFrom: '2026-05-01',
      periodBTo: '2026-05-10',
      granularity: 'week',
    });

    expect(result.delta.cycleTimeAvgPct).toBeNull();
    expect(result.delta.leadTimeAvgPct).toBe(-50);
    expect(result.delta.throughputPct).toBeNull();
    expect(result.delta.wipCountPct).toBeNull();
  });

  it('compare chama services F8 com periodos separados', async () => {
    await service.compareProject('10', projectId, {
      periodAFrom: '2026-04-01',
      periodATo: '2026-04-30',
      periodBFrom: '2026-05-01',
      periodBTo: '2026-05-10',
    });

    expect(cycleTime.calculate).toHaveBeenNthCalledWith(1, projectId, {
      periodFrom: '2026-04-01',
      periodTo: '2026-04-30',
    });
    expect(cycleTime.calculate).toHaveBeenNthCalledWith(2, projectId, {
      periodFrom: '2026-05-01',
      periodTo: '2026-05-10',
    });
    expect(throughput.calculate).toHaveBeenNthCalledWith(1, projectId, 'week', {
      periodFrom: '2026-04-01',
      periodTo: '2026-04-30',
    });
    expect(throughput.calculate).toHaveBeenNthCalledWith(2, projectId, 'week', {
      periodFrom: '2026-05-01',
      periodTo: '2026-05-10',
    });
  });

  it('capacityForecast busca projetos da org em lote e chama ForecastService', async () => {
    prisma.dProject.findMany.mockResolvedValue([
      { chave: BigInt(1), nome: 'A' },
      { chave: BigInt(2), nome: 'B' },
    ]);
    forecast.forecast
      .mockResolvedValueOnce({
        p50: 7,
        p75: 14,
        p85: 21,
        p95: 28,
        unit: 'days',
        tasksRemaining: 5,
        iterations: 1000,
        source: 'sprints',
      })
      .mockResolvedValueOnce({
        p50: 3,
        p75: 6,
        p85: 9,
        p95: 12,
        unit: 'days',
        tasksRemaining: 2,
        iterations: 1000,
        source: 'rolling-window',
      });

    const result = await service.capacityForecast(BigInt(10), {
      historicalSprints: 4,
      iterations: 1000,
      limitProjects: 25,
    });

    expect(prisma.dProject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idEstab: BigInt(10), excluido: false },
        take: 25,
      }),
    );
    expect(forecast.forecast).toHaveBeenCalledTimes(2);
    expect(result.totals).toEqual({ tasksRemaining: 7, p50Approx: 10, p75Approx: 20, p95Approx: 40 });
  });

  it('capacityForecast nao derruba tudo quando um projeto tem historico insuficiente', async () => {
    prisma.dProject.findMany.mockResolvedValue([{ chave: BigInt(1), nome: 'A' }]);
    prisma.dTask.count.mockResolvedValue(8);
    forecast.forecast.mockRejectedValue(new BadRequestException('Sem historico suficiente'));

    const result = await service.capacityForecast(BigInt(10), {});

    expect(result.projects[0]).toMatchObject({
      projectId: '1',
      status: 'insufficient-history',
      tasksRemaining: 8,
      p50: null,
      errorCode: 'INSUFFICIENT_HISTORY',
    });
    expect(result.warnings).toEqual(['Projeto 1: INSUFFICIENT_HISTORY']);
  });

  it('stakeholderReport gera texto deterministico a partir de metricas', async () => {
    cycleTime.calculate.mockReset().mockResolvedValue({ avg: 12, samples: 2, unit: 'hours' });
    leadTime.calculate.mockReset().mockResolvedValue({ avg: 30, samples: 2, unit: 'hours' });
    throughput.calculate.mockReset().mockResolvedValue({ series: [], total: 4, granularity: 'week' });
    wipAge.calculate.mockResolvedValue({ byStatus: [], total: 5, calculatedAt: '2026-05-10T12:00:00.000Z' });

    const result = await service.stakeholderReport('10', projectId, { period: 'week' });

    expect(result.executiveSummary).toBe(
      'O projeto concluiu 4 tasks no periodo, com 5 tasks em WIP atual e cycle time medio de 12h.',
    );
    expect(result.highlights).toEqual([
      '4 tasks concluidas no periodo.',
      'Cycle time medio observado: 12h.',
    ]);
  });
});
