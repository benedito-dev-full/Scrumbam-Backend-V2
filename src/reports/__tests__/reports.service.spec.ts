import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReportsService } from '../reports.service';
import { PdfGeneratorService } from '../pdf-generator.service';
import { PrismaService } from '../../prisma.service';
import { TtlCacheService } from '../../common/cache/ttl-cache.service';
import { DashboardsService } from '../../dashboards/dashboards.service';
import { AnalyticsService } from '../../analytics/analytics.service';
import { ForecastService } from '../../forecast/forecast.service';

const MOCK_PROJECT = {
  chave: BigInt(123),
  nome: 'Projeto Teste',
  idEstab: BigInt(456),
};

const MOCK_METRICS = {
  cycleTimeAvgHours: 24.5,
  leadTimeAvgHours: 48.2,
  throughputTotal: 42,
  wipTotal: 8,
};

const MOCK_VELOCITY = { projectId: '123', series: [], avgVelocity: 10 };
const MOCK_BURNDOWN = { projectId: '123', series: [], scopeTotal: 50, completedTotal: 30 };
const MOCK_TASKS_BY_USER = { projectId: '123', users: [] };
const MOCK_FORECAST = { p50: 3, p75: 5, p85: 6, p95: 8, tasksRemaining: 20 };
const MOCK_STAKEHOLDER = {
  projectId: '123',
  executiveSummary: 'Projeto ok',
  highlights: [],
  risks: [],
  nextActions: [],
  metricsSnapshot: {},
  generatedAt: '2026-05-10T12:00:00.000Z',
};

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: jest.Mocked<PrismaService>;
  let cache: jest.Mocked<TtlCacheService>;
  let dashboardsService: jest.Mocked<DashboardsService>;
  let analyticsService: jest.Mocked<AnalyticsService>;
  let forecastService: jest.Mocked<ForecastService>;
  let pdfGenerator: jest.Mocked<PdfGeneratorService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        {
          provide: PrismaService,
          useValue: {
            dProject: {
              findFirst: jest.fn(),
            },
            dTask: {
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: TtlCacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            getOrSet: jest.fn(),
          },
        },
        {
          provide: DashboardsService,
          useValue: {
            resolveProjectId: jest.fn(),
            getMetrics: jest.fn(),
            getVelocity: jest.fn(),
            getBurndown: jest.fn(),
            getTasksByUser: jest.fn(),
          },
        },
        {
          provide: AnalyticsService,
          useValue: {
            stakeholderReport: jest.fn(),
          },
        },
        {
          provide: ForecastService,
          useValue: {
            forecast: jest.fn(),
          },
        },
        {
          provide: PdfGeneratorService,
          useValue: {
            generate: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
    prisma = module.get(PrismaService);
    cache = module.get(TtlCacheService);
    dashboardsService = module.get(DashboardsService);
    analyticsService = module.get(AnalyticsService);
    forecastService = module.get(ForecastService);
    pdfGenerator = module.get(PdfGeneratorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveProjectId', () => {
    it('deve retornar BigInt quando projeto encontrado e org correta', async () => {
      (prisma.dProject.findFirst as jest.Mock).mockResolvedValue(MOCK_PROJECT);

      const result = await service.resolveProjectId('123', '456');

      expect(result).toBe(BigInt(123));
    });

    it('deve lancar NotFoundException para ID invalido', async () => {
      await expect(service.resolveProjectId('abc', '456')).rejects.toThrow(NotFoundException);
    });

    it('deve lancar NotFoundException quando projeto nao existe', async () => {
      (prisma.dProject.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.resolveProjectId('999', '456')).rejects.toThrow(NotFoundException);
    });

    it('deve lancar ForbiddenException quando org divergente (tenant isolation)', async () => {
      (prisma.dProject.findFirst as jest.Mock).mockResolvedValue({
        ...MOCK_PROJECT,
        idEstab: BigInt(999), // org diferente
      });

      await expect(service.resolveProjectId('123', '456')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('assembleReportData', () => {
    beforeEach(() => {
      (prisma.dProject.findFirst as jest.Mock).mockResolvedValue(MOCK_PROJECT);
      (dashboardsService.getMetrics as jest.Mock).mockResolvedValue(MOCK_METRICS);
      (dashboardsService.getVelocity as jest.Mock).mockResolvedValue(MOCK_VELOCITY);
      (dashboardsService.getBurndown as jest.Mock).mockResolvedValue(MOCK_BURNDOWN);
      (dashboardsService.getTasksByUser as jest.Mock).mockResolvedValue(MOCK_TASKS_BY_USER);
      (forecastService.forecast as jest.Mock).mockResolvedValue(MOCK_FORECAST);
      (analyticsService.stakeholderReport as jest.Mock).mockResolvedValue(MOCK_STAKEHOLDER);
    });

    it('deve montar payload com Promise.all e retornar dados completos', async () => {
      const result = await service.assembleReportData(BigInt(123), '456', {});

      expect(result.project.projectId).toBe('123');
      expect(result.project.projectName).toBe('Projeto Teste');
      expect(result.metrics).toBe(MOCK_METRICS);
      expect(result.velocity).toBe(MOCK_VELOCITY);
      expect(result.burndown).toBe(MOCK_BURNDOWN);
      expect(result.tasksByUser).toBe(MOCK_TASKS_BY_USER);
      expect(result.forecast).toBe(MOCK_FORECAST);
      expect(result.stakeholderSummary).toBe(MOCK_STAKEHOLDER);
      expect(result.warnings).toEqual([]);
    });

    it('nao deve falhar quando forecast lanca BadRequestException (historico insuficiente)', async () => {
      const badRequest = new Error('Sem histórico de throughput suficiente');
      badRequest.name = 'BadRequestException';
      (forecastService.forecast as jest.Mock).mockRejectedValue(badRequest);

      const result = await service.assembleReportData(BigInt(123), '456', {});

      expect(result.forecast).toBeNull();
      expect((result.warnings ?? []).length).toBeGreaterThan(0);
      expect((result.warnings ?? [])[0]).toContain('histórico insuficiente');
    });

    it('nao deve falhar quando analytics lanca erro (inclui warning)', async () => {
      (analyticsService.stakeholderReport as jest.Mock).mockRejectedValue(
        new Error('Service indisponível'),
      );

      const result = await service.assembleReportData(BigInt(123), '456', {
        includeStakeholderSummary: true,
      });

      expect(result.stakeholderSummary).toBeNull();
      expect((result.warnings ?? []).some((w) => w.includes('resumo executivo'))).toBe(true);
    });

    it('deve usar cache TTL de 5 minutos via getOrSet', async () => {
      const mockBuffer = Buffer.from('%PDF-1.4');
      (pdfGenerator.generate as jest.Mock).mockResolvedValue(mockBuffer);
      (cache.getOrSet as jest.Mock).mockImplementation(
        (_key: string, _ttl: number, factory: () => Promise<unknown>) => factory(),
      );
      (prisma.dProject.findFirst as jest.Mock)
        .mockResolvedValueOnce(MOCK_PROJECT) // resolveProjectId
        .mockResolvedValueOnce(MOCK_PROJECT); // assembleReportData

      await service.generateProjectPdf('123', '456', {});

      expect(cache.getOrSet).toHaveBeenCalledWith(
        expect.stringContaining('reports:pdf:org:456:project:123'),
        300_000, // 5 minutos
        expect.any(Function),
      );
    });

    it('nao deve incluir tasks quando includeTasks=false (default)', async () => {
      const result = await service.assembleReportData(BigInt(123), '456', { includeTasks: false });

      expect(result.tasks).toBeNull();
      expect(prisma.dTask.findMany).not.toHaveBeenCalled();
    });

    it('deve buscar tasks com limite 200 quando includeTasks=true', async () => {
      (prisma.dTask.findMany as jest.Mock).mockResolvedValue([
        { chave: BigInt(1), idStatus: BigInt(-444), idAssignee: null, criadoEm: new Date(), atualizadoEm: new Date(), dados: null },
      ]);

      const result = await service.assembleReportData(BigInt(123), '456', { includeTasks: true });

      expect(result.tasks).not.toBeNull();
      expect(prisma.dTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ idProject: BigInt(123), excluido: false }),
          take: 200,
        }),
      );
    });

    it('deve lancar ForbiddenException quando organizationId vazio', async () => {
      await expect(service.generateProjectPdf('123', '', {})).rejects.toThrow(ForbiddenException);
    });
  });
});
