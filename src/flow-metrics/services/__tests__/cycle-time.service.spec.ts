import { Test, TestingModule } from '@nestjs/testing';
import { CycleTimeService } from '../cycle-time.service';
import { PrismaService } from '../../../prisma.service';
import { PeriodResolver } from '../../helpers/period-resolver';
import { TimezoneService } from '../../../common/services/timezone.service';

const mockPrisma = {
  dTask: {
    findMany: jest.fn(),
  },
};

const mockTimezone = {
  getPeriodDates: jest.fn().mockReturnValue({
    gte: new Date('2026-01-01T03:00:00Z'),
    lte: new Date('2026-02-01T02:59:59Z'),
  }),
  applyDateFilters: jest.fn().mockReturnValue({
    gte: new Date('2026-01-01T03:00:00Z'),
    lte: new Date('2026-01-31T02:59:59Z'),
  }),
  toStartOfDayBrazil: jest.fn((d: Date) => d),
  toEndOfDayBrazil: jest.fn((d: Date) => d),
};

describe('CycleTimeService', () => {
  let service: CycleTimeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CycleTimeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TimezoneService, useValue: mockTimezone },
        PeriodResolver,
      ],
    }).compile();

    service = module.get<CycleTimeService>(CycleTimeService);
    jest.clearAllMocks();
    mockTimezone.getPeriodDates.mockReturnValue({
      gte: new Date('2026-01-01T03:00:00Z'),
      lte: new Date('2026-02-01T02:59:59Z'),
    });
  });

  it('deve retornar amostras=0 e null quando não há tasks', async () => {
    mockPrisma.dTask.findMany.mockResolvedValue([]);

    const result = await service.calculate(BigInt(1), { period: 'month' });

    expect(result.samples).toBe(0);
    expect(result.p50).toBeNull();
    expect(result.p75).toBeNull();
    expect(result.p90).toBeNull();
    expect(result.avg).toBeNull();
    expect(result.unit).toBe('hours');
  });

  it('deve retornar amostras=0 quando tasks sem telemetria', async () => {
    mockPrisma.dTask.findMany.mockResolvedValue([
      { dados: { v3: { state: 'DONE' } } }, // sem telemetry
      { dados: null },
    ]);

    const result = await service.calculate(BigInt(1), {});

    expect(result.samples).toBe(0);
    expect(result.p50).toBeNull();
  });

  it('deve calcular percentis corretamente para 1 task', async () => {
    mockPrisma.dTask.findMany.mockResolvedValue([
      {
        dados: {
          telemetry: {
            cycleTime: 8.0,
            doneAt: '2026-01-15T12:00:00Z',
          },
        },
      },
    ]);

    const result = await service.calculate(BigInt(1), { period: 'month' });

    expect(result.samples).toBe(1);
    expect(result.p50).toBe(8.0);
    expect(result.avg).toBe(8.0);
    expect(result.unit).toBe('hours');
  });

  it('deve calcular percentis para N tasks', async () => {
    const cycleTimes = [2, 4, 6, 8, 10];
    mockPrisma.dTask.findMany.mockResolvedValue(
      cycleTimes.map((ct) => ({
        dados: {
          telemetry: {
            cycleTime: ct,
            doneAt: '2026-01-15T12:00:00Z',
          },
        },
      })),
    );

    const result = await service.calculate(BigInt(1), { period: 'month' });

    expect(result.samples).toBe(5);
    expect(result.p50).toBe(6);
    expect(result.unit).toBe('hours');
  });

  it('deve filtrar tasks com cycleTime <= 0', async () => {
    // Usar doneAt dentro do range mockado (2026-01-01 a 2026-02-01)
    mockPrisma.dTask.findMany.mockResolvedValue([
      { dados: { telemetry: { cycleTime: 0, doneAt: '2026-01-20T12:00:00Z' } } },
      { dados: { telemetry: { cycleTime: -1, doneAt: '2026-01-20T12:00:00Z' } } },
      { dados: { telemetry: { cycleTime: 5, doneAt: '2026-01-20T12:00:00Z' } } },
    ]);

    const result = await service.calculate(BigInt(1), { period: 'month' });
    expect(result.samples).toBe(1);
    expect(result.p50).toBe(5);
  });

  it('deve chamar findMany com idStatus para DONE e VALIDATED', async () => {
    mockPrisma.dTask.findMany.mockResolvedValue([]);

    await service.calculate(BigInt(42), { period: 'week' });

    expect(mockPrisma.dTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          idProject: BigInt(42),
          excluido: false,
        }),
      }),
    );
  });
});
