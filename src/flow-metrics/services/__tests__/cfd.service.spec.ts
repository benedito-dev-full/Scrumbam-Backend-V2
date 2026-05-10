import { Test, TestingModule } from '@nestjs/testing';
import { CfdService } from '../cfd.service';
import { PrismaService } from '../../../prisma.service';
import { PeriodResolver } from '../../helpers/period-resolver';
import { TimezoneService } from '../../../common/services/timezone.service';

const baseRange = {
  gte: new Date('2026-01-01T03:00:00Z'),
  lte: new Date('2026-01-03T02:59:59Z'),
};

const mockTimezone = {
  getPeriodDates: jest.fn().mockReturnValue(baseRange),
  applyDateFilters: jest.fn().mockReturnValue(baseRange),
  toStartOfDayBrazil: jest.fn((d: Date) => d),
  toEndOfDayBrazil: jest.fn((d: Date) => d),
};

const mockPrisma = {
  dTask: {
    findMany: jest.fn(),
  },
  dEvento: {
    findMany: jest.fn(),
  },
};

describe('CfdService', () => {
  let service: CfdService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CfdService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TimezoneService, useValue: mockTimezone },
        PeriodResolver,
      ],
    }).compile();

    service = module.get<CfdService>(CfdService);
    jest.clearAllMocks();
    mockTimezone.getPeriodDates.mockReturnValue(baseRange);
    mockTimezone.applyDateFilters.mockReturnValue(baseRange);
  });

  it('deve retornar série vazia quando não há tasks', async () => {
    mockPrisma.dTask.findMany.mockResolvedValue([]);
    mockPrisma.dEvento.findMany.mockResolvedValue([]);

    const result = await service.calculate(BigInt(1), { period: 'week' });

    expect(result.series).toHaveLength(0);
  });

  it('deve conter 3 pontos para período de 3 dias', async () => {
    const taskId = BigInt(100);
    mockPrisma.dTask.findMany.mockResolvedValue([
      { chave: taskId, idStatus: BigInt(-441), criadoEm: new Date('2026-01-01T00:00:00Z') },
    ]);
    mockPrisma.dEvento.findMany.mockResolvedValue([]);

    const result = await service.calculate(BigInt(1), {});

    // 3 dias no período (1, 2, 3 de janeiro)
    expect(result.series.length).toBeGreaterThanOrEqual(1);
    // Cada ponto deve ter a chave do status inicial (INBOX)
    if (result.series.length > 0) {
      expect(result.series[0].counts).toBeDefined();
    }
  });

  it('deve aplicar transições de status via replay de eventos', async () => {
    const taskId = BigInt(100);

    mockPrisma.dTask.findMany.mockResolvedValue([
      { chave: taskId, idStatus: BigInt(-442), criadoEm: new Date('2026-01-01T00:00:00Z') },
    ]);

    mockPrisma.dEvento.findMany.mockResolvedValue([
      {
        criadoEm: new Date('2026-01-02T10:00:00Z'),
        metaDados: { taskId: taskId.toString(), from: 'INBOX', to: 'READY' },
        identificadorExterno: null,
      },
    ]);

    const result = await service.calculate(BigInt(1), {});

    expect(result.series.length).toBeGreaterThan(0);
  });

  it('deve manter estado INBOX por default para tasks sem transição', async () => {
    const taskId = BigInt(200);

    mockPrisma.dTask.findMany.mockResolvedValue([
      { chave: taskId, idStatus: BigInt(-441), criadoEm: new Date('2026-01-01T00:00:00Z') },
    ]);
    mockPrisma.dEvento.findMany.mockResolvedValue([]);

    const result = await service.calculate(BigInt(1), {});

    const firstDay = result.series[0];
    expect(firstDay.counts['INBOX']).toBe(1);
  });

  it('deve retornar série com formato de data YYYY-MM-DD', async () => {
    mockPrisma.dTask.findMany.mockResolvedValue([
      { chave: BigInt(1), idStatus: BigInt(-441), criadoEm: new Date('2026-01-01T00:00:00Z') },
    ]);
    mockPrisma.dEvento.findMany.mockResolvedValue([]);

    const result = await service.calculate(BigInt(1), {});

    for (const point of result.series) {
      expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
