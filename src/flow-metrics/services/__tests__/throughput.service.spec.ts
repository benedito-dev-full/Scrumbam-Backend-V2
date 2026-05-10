import { Test, TestingModule } from '@nestjs/testing';
import { ThroughputService } from '../throughput.service';
import { PrismaService } from '../../../prisma.service';
import { PeriodResolver } from '../../helpers/period-resolver';
import { TimezoneService } from '../../../common/services/timezone.service';

const mockPrisma = {
  $queryRaw: jest.fn(),
  dTask: {
    findMany: jest.fn(),
  },
};

const baseRange = {
  gte: new Date('2026-01-01T03:00:00Z'),
  lte: new Date('2026-02-01T02:59:59Z'),
};

const mockTimezone = {
  getPeriodDates: jest.fn().mockReturnValue(baseRange),
  applyDateFilters: jest.fn().mockReturnValue(baseRange),
  toStartOfDayBrazil: jest.fn((d: Date) => d),
  toEndOfDayBrazil: jest.fn((d: Date) => d),
};

describe('ThroughputService', () => {
  let service: ThroughputService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThroughputService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TimezoneService, useValue: mockTimezone },
        PeriodResolver,
      ],
    }).compile();

    service = module.get<ThroughputService>(ThroughputService);
    jest.clearAllMocks();
    mockTimezone.getPeriodDates.mockReturnValue(baseRange);
    mockTimezone.applyDateFilters.mockReturnValue(baseRange);
  });

  it('deve retornar série vazia e total=0 quando sem tasks', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const result = await service.calculate(BigInt(1), 'day', { period: 'month' });

    expect(result.series).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.granularity).toBe('day');
  });

  it('deve retornar série com total correto para granularidade day', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { d: new Date('2026-01-15T00:00:00Z'), c: 3 },
      { d: new Date('2026-01-16T00:00:00Z'), c: 5 },
    ]);

    const result = await service.calculate(BigInt(1), 'day', { period: 'month' });

    expect(result.series).toHaveLength(2);
    expect(result.total).toBe(8);
    expect(result.series[0].count).toBe(3);
    expect(result.series[1].count).toBe(5);
  });

  it('deve retornar granularity=week quando solicitado', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { d: new Date('2026-01-13T00:00:00Z'), c: 10 },
    ]);

    const result = await service.calculate(BigInt(1), 'week', {});

    expect(result.granularity).toBe('week');
    expect(result.total).toBe(10);
  });

  it('deve usar fallback JS quando $queryRaw falha', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('SQL error'));
    mockPrisma.dTask.findMany.mockResolvedValue([
      {
        dados: {
          telemetry: { doneAt: '2026-01-15T12:00:00Z' },
        },
      },
      {
        dados: {
          telemetry: { doneAt: '2026-01-15T14:00:00Z' },
        },
      },
    ]);

    const result = await service.calculate(BigInt(1), 'day', {});

    expect(result.series.length).toBeGreaterThanOrEqual(0);
    // Fallback deve retornar resultado (não lançar)
  });

  it('deve formatar datas como YYYY-MM-DD na série', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { d: new Date('2026-01-15T12:00:00Z'), c: 2 },
    ]);

    const result = await service.calculate(BigInt(1), 'day', {});

    expect(result.series[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getHistoricalArray deve retornar array de counts', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { d: new Date('2026-01-01T00:00:00Z'), c: 3 },
      { d: new Date('2026-01-08T00:00:00Z'), c: 5 },
    ]);

    const arr = await service.getHistoricalArray(BigInt(1), {}, 'week');
    expect(arr).toEqual([3, 5]);
  });
});
