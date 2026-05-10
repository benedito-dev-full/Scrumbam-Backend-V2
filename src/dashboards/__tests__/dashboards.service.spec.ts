import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TtlCacheService } from '../../common/cache/ttl-cache.service';
import { TimezoneService } from '../../common/services/timezone.service';
import { DashboardsService } from '../dashboards.service';

describe('DashboardsService', () => {
  const projectId = BigInt(123);
  const fixedRange = {
    gte: new Date('2026-05-01T03:00:00.000Z'),
    lte: new Date('2026-05-31T02:59:59.999Z'),
  };

  let prisma: any;
  let cache: TtlCacheService;
  let flowDashboard: any;
  let throughput: any;
  let periodResolver: any;
  let timezoneService: jest.Mocked<TimezoneService>;
  let service: DashboardsService;

  beforeEach(() => {
    prisma = {
      dTabela: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      dTask: {
        findMany: jest.fn(),
      },
      dProject: {
        findFirst: jest.fn(),
      },
    };
    cache = new TtlCacheService();
    flowDashboard = {
      getDashboard: jest.fn().mockResolvedValue({
        projectId: '123',
        cycleTime: {},
        leadTime: {},
        throughput: {},
        wipAge: {},
        cfd: {},
        calculatedAt: '2026-05-10T12:00:00.000Z',
      }),
    };
    throughput = {
      calculate: jest.fn().mockResolvedValue({
        series: [{ date: '2026-05-05', count: 2 }],
        total: 2,
        granularity: 'week',
      }),
    };
    periodResolver = {
      resolve: jest.fn().mockReturnValue(fixedRange),
    };
    timezoneService = {
      getPeriodDates: jest.fn().mockReturnValue({
        gte: new Date('2026-05-10T03:00:00.000Z'),
        lte: new Date('2026-05-11T02:59:59.999Z'),
      }),
      toBrazilTime: jest.fn().mockReturnValue(new Date('2026-05-10T09:00:00.000Z')),
    } as unknown as jest.Mocked<TimezoneService>;

    service = new DashboardsService(
      prisma,
      cache,
      flowDashboard,
      throughput,
      periodResolver,
      timezoneService,
    );
  });

  it('metrics chama F8 dashboard service e cacheia por 60s', async () => {
    const first = await service.getMetrics('10', projectId, { period: 'month' });
    const second = await service.getMetrics('10', projectId, { period: 'month' });

    expect(flowDashboard.getDashboard).toHaveBeenCalledTimes(1);
    expect(first.cache).toEqual({ hit: false, ttlSeconds: 60 });
    expect(second.cache).toEqual({ hit: true, ttlSeconds: 60 });
  });

  it('resolveProjectId valida tenant e retorna BigInt', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ chave: projectId, idEstab: BigInt(10) });

    await expect(service.resolveProjectId('123', '10')).resolves.toBe(projectId);
  });

  it('resolveProjectId retorna 403 para org divergente', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ chave: projectId, idEstab: BigInt(11) });

    await expect(service.resolveProjectId('123', '10')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('resolveProjectId retorna 403 quando organizacao esta ausente', async () => {
    await expect(service.resolveProjectId('123', '')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.dProject.findFirst).not.toHaveBeenCalled();
  });

  it('resolveProjectId retorna 404 para id invalido ou projeto ausente', async () => {
    await expect(service.resolveProjectId('invalid', '10')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.dProject.findFirst).not.toHaveBeenCalled();

    prisma.dProject.findFirst.mockResolvedValue(null);
    await expect(service.resolveProjectId('123', '10')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('velocity agrega sprints e tasks sem N+1', async () => {
    prisma.dTabela.findMany
      .mockResolvedValueOnce([
        { chave: BigInt(1), nome: 'Sprint 1', dados: null, metaDados: null },
        { chave: BigInt(2), nome: 'Sprint 2', dados: null, metaDados: null },
      ])
      .mockResolvedValueOnce([{ chave: BigInt(900) }]);
    prisma.dTask.findMany.mockResolvedValue([
      {
        chave: BigInt(11),
        idStatus: BigInt(900),
        idSprint: BigInt(1),
        idAssignee: null,
        criadoEm: new Date('2026-05-03T12:00:00.000Z'),
        dados: { telemetry: { doneAt: '2026-05-04T12:00:00.000Z' } },
        assignee: null,
      },
      {
        chave: BigInt(12),
        idStatus: BigInt(901),
        idSprint: BigInt(1),
        idAssignee: null,
        criadoEm: new Date('2026-05-05T12:00:00.000Z'),
        dados: {},
        assignee: null,
      },
    ]);

    const result = await service.getVelocity('10', projectId, { period: 'month' });

    expect(prisma.dTabela.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.dTabela.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          idClasse: { gte: BigInt(-419), lte: BigInt(-400) },
        }),
      }),
    );
    expect(prisma.dTask.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.dTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ OR: expect.any(Array) }),
      }),
    );
    expect(result.series[0]).toMatchObject({ sprintId: '1', completed: 1, planned: 2 });
    expect(result.avgVelocity).toBe(0.5);
  });

  it('burndown calcula remaining corretamente', async () => {
    prisma.dTask.findMany.mockResolvedValue([
      {
        chave: BigInt(11),
        idStatus: BigInt(900),
        idSprint: null,
        idAssignee: null,
        criadoEm: new Date('2026-05-01T12:00:00.000Z'),
        dados: { telemetry: { doneAt: '2026-05-01T12:00:00.000Z' } },
        assignee: null,
      },
      {
        chave: BigInt(12),
        idStatus: BigInt(901),
        idSprint: null,
        idAssignee: null,
        criadoEm: new Date('2026-05-02T12:00:00.000Z'),
        dados: {},
        assignee: null,
      },
    ]);

    const result = await service.getBurndown('10', projectId, {
      periodFrom: '2026-05-01',
      periodTo: '2026-05-02',
    });

    expect(prisma.dTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ OR: expect.any(Array) }),
      }),
    );
    expect(result.scopeTotal).toBe(2);
    expect(result.completedTotal).toBe(1);
    expect(result.series[0].actualRemaining).toBe(1);
    expect(result.series[result.series.length - 1].plannedRemaining).toBe(0);
  });

  it('tasksByUser agrupa unknown/unassigned sem quebrar', async () => {
    prisma.dTask.findMany.mockResolvedValue([
      {
        chave: BigInt(11),
        idStatus: BigInt(700),
        idSprint: null,
        idAssignee: null,
        criadoEm: new Date('2026-05-03T12:00:00.000Z'),
        dados: {},
        assignee: null,
      },
    ]);
    prisma.dTabela.findMany.mockResolvedValue([]);

    const result = await service.getTasksByUser('10', projectId, { period: 'month' });

    expect(prisma.dTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
      }),
    );
    expect(result.users).toEqual([
      {
        userId: null,
        userName: 'Unassigned',
        total: 1,
        byStatus: { '700': 1 },
      },
    ]);
  });

  it('dailySummary usa timezone Brasil', async () => {
    prisma.dTask.findMany.mockResolvedValue([
      {
        chave: BigInt(11),
        idStatus: BigInt(700),
        idSprint: null,
        idAssignee: null,
        criadoEm: new Date('2026-05-10T12:00:00.000Z'),
        dados: { telemetry: { doneAt: '2026-05-10T13:00:00.000Z' } },
        assignee: null,
      },
    ]);
    prisma.dTabela.findMany.mockResolvedValue([]);

    const result = await service.getDailySummary('10', projectId);

    expect(timezoneService.getPeriodDates).toHaveBeenCalledWith('today');
    expect(timezoneService.toBrazilTime).toHaveBeenCalled();
    expect(result.completedToday).toBe(1);
    expect(result.createdToday).toBe(1);
  });
});
