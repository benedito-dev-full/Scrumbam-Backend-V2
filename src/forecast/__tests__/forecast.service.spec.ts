import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ForecastService } from '../forecast.service';
import { PrismaService } from '../../prisma.service';
import { ThroughputService } from '../../flow-metrics/services/throughput.service';
import { WipAgeService } from '../../flow-metrics/services/wip-age.service';
import { PeriodResolver } from '../../flow-metrics/helpers/period-resolver';
import { TimezoneService } from '../../common/services/timezone.service';

const mockPrisma = {
  dProject: { findFirst: jest.fn() },
  dTabela: { findMany: jest.fn() },
  dTask: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
};

const baseRange = {
  gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  lte: new Date(),
};

const mockTimezone = {
  getPeriodDates: jest.fn().mockReturnValue(baseRange),
  applyDateFilters: jest.fn().mockReturnValue(baseRange),
  toStartOfDayBrazil: jest.fn((_d: Date) => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
  toEndOfDayBrazil: jest.fn((_d: Date) => new Date()),
};

const mockThroughput = {
  calculate: jest.fn(),
  getHistoricalArray: jest.fn(),
};

const mockWipAge = {
  calculate: jest.fn(),
};

describe('ForecastService', () => {
  let service: ForecastService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ForecastService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ThroughputService, useValue: mockThroughput },
        { provide: WipAgeService, useValue: mockWipAge },
        { provide: TimezoneService, useValue: mockTimezone },
        PeriodResolver,
      ],
    }).compile();

    service = module.get<ForecastService>(ForecastService);
    jest.clearAllMocks();
    mockTimezone.getPeriodDates.mockReturnValue(baseRange);
    mockTimezone.toEndOfDayBrazil.mockReturnValue(new Date());
  });

  it('deve lançar NotFoundException se projeto não encontrado', async () => {
    mockPrisma.dProject.findFirst.mockResolvedValue(null);

    await expect(
      service.forecast(BigInt(999), { historicalSprints: 4, iterations: 100 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('deve usar rolling window como fallback quando sprints insuficientes', async () => {
    mockPrisma.dProject.findFirst.mockResolvedValue({ chave: BigInt(1) });
    mockPrisma.dTabela.findMany.mockResolvedValue([]); // sem sprints
    mockPrisma.dTask.count.mockResolvedValue(10);
    mockPrisma.dTask.findMany.mockResolvedValue([]);
    mockThroughput.getHistoricalArray.mockResolvedValue([3, 5, 4, 6, 3, 7]);

    const result = await service.forecast(BigInt(1), { historicalSprints: 4, iterations: 100 });

    expect(result.source).toBe('rolling-window');
    expect(result.tasksRemaining).toBe(10);
  });

  it('deve lançar BadRequestException quando sem histórico suficiente', async () => {
    mockPrisma.dProject.findFirst.mockResolvedValue({ chave: BigInt(1) });
    mockPrisma.dTabela.findMany.mockResolvedValue([]);
    mockPrisma.dTask.findMany.mockResolvedValue([]);
    mockThroughput.getHistoricalArray.mockResolvedValue([]); // sem dados

    await expect(
      service.forecast(BigInt(1), { historicalSprints: 4, iterations: 100 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve retornar p50=0 quando sem tasks restantes', async () => {
    mockPrisma.dProject.findFirst.mockResolvedValue({ chave: BigInt(1) });
    mockPrisma.dTabela.findMany.mockResolvedValue([]);
    mockPrisma.dTask.count.mockResolvedValue(0); // sem tasks restantes
    mockPrisma.dTask.findMany.mockResolvedValue([]);
    mockThroughput.getHistoricalArray.mockResolvedValue([3, 5, 4]);

    const result = await service.forecast(BigInt(1), { historicalSprints: 4, iterations: 100 });

    expect(result.tasksRemaining).toBe(0);
    expect(result.p50).toBe(0);
    expect(result.p95).toBe(0);
  });

  it('deve retornar unit=days', async () => {
    mockPrisma.dProject.findFirst.mockResolvedValue({ chave: BigInt(1) });
    mockPrisma.dTabela.findMany.mockResolvedValue([]);
    mockPrisma.dTask.count.mockResolvedValue(15);
    mockPrisma.dTask.findMany.mockResolvedValue([]);
    mockThroughput.getHistoricalArray.mockResolvedValue([3, 5, 4, 6]);

    const result = await service.forecast(BigInt(1), { historicalSprints: 4, iterations: 500 });

    expect(result.unit).toBe('days');
    expect(result.p50).toBeGreaterThan(0);
  });

  it('deve passar iterations correto para Monte Carlo', async () => {
    mockPrisma.dProject.findFirst.mockResolvedValue({ chave: BigInt(1) });
    mockPrisma.dTabela.findMany.mockResolvedValue([]);
    mockPrisma.dTask.count.mockResolvedValue(10);
    mockPrisma.dTask.findMany.mockResolvedValue([]);
    mockThroughput.getHistoricalArray.mockResolvedValue([4, 5, 6]);

    const result = await service.forecast(BigInt(1), { historicalSprints: 4, iterations: 200 });

    expect(result.iterations).toBe(200);
  });
});
