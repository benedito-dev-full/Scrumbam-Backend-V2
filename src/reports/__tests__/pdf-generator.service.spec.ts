import { Test, TestingModule } from '@nestjs/testing';
import { PdfGeneratorService } from '../pdf-generator.service';
import { ProjectReportDataDto } from '../dto/project-report-data.dto';

const FULL_DATA: ProjectReportDataDto = {
  project: { projectId: '123', projectName: 'Projeto Teste', orgId: '456' },
  period: {
    from: '2026-04-01T00:00:00.000Z',
    to: '2026-04-30T23:59:59.999Z',
    days: 30,
  },
  generatedAt: '2026-05-10T12:00:00.000Z',
  metrics: {
    cycleTimeAvgHours: 24.5,
    leadTimeAvgHours: 48.2,
    throughputTotal: 42,
    wipTotal: 8,
  },
  velocity: {
    projectId: '123',
    avgVelocity: 10,
    series: [
      { label: 'Sprint 1', sprintId: '1', completed: 10, planned: 12 },
      { label: 'Sprint 2', sprintId: '2', completed: 8, planned: 10 },
    ],
  },
  burndown: {
    projectId: '123',
    scopeTotal: 50,
    completedTotal: 30,
    series: [
      { date: '2026-04-01', plannedRemaining: 50, actualRemaining: 50 },
      { date: '2026-04-15', plannedRemaining: 25, actualRemaining: 22 },
      { date: '2026-04-30', plannedRemaining: 0, actualRemaining: 20 },
    ],
  },
  tasksByUser: {
    projectId: '123',
    users: [
      { userId: '1', userName: 'Alice', total: 15, byStatus: { DONE: 10, EXECUTING: 5 } },
      { userId: '2', userName: 'Bob', total: 8, byStatus: { DONE: 5, INBOX: 3 } },
    ],
  },
  forecast: {
    projectId: '123',
    tasksRemaining: 20,
    p50: 3,
    p75: 5,
    p85: 6,
    p95: 8,
    method: 'bootstrap-resample',
  },
  stakeholderSummary: {
    projectId: '123',
    executiveSummary: 'O projeto está progredindo bem com 30 tasks concluídas no período.',
    highlights: ['42 tasks entregues', 'Cycle time médio de 24.5h'],
    risks: ['WIP elevado (8 tasks em paralelo)'],
    nextActions: ['Reduzir WIP para máximo 5 tasks em paralelo'],
  },
  tasks: null,
  warnings: [],
};

const EMPTY_DATA: ProjectReportDataDto = {
  project: { projectId: '999', projectName: 'Projeto Sem Dados', orgId: '456' },
  period: { from: '2026-04-01T00:00:00.000Z', to: '2026-04-30T23:59:59.999Z', days: 30 },
  generatedAt: '2026-05-10T12:00:00.000Z',
  metrics: null,
  velocity: null,
  burndown: null,
  tasksByUser: null,
  forecast: null,
  stakeholderSummary: null,
  tasks: null,
  warnings: ['forecast: histórico insuficiente para cálculo.'],
};

describe('PdfGeneratorService', () => {
  let service: PdfGeneratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PdfGeneratorService],
    }).compile();

    service = module.get<PdfGeneratorService>(PdfGeneratorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('deve gerar Buffer nao vazio para dados completos', async () => {
    const buffer = await service.generate(FULL_DATA);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('buffer deve comecar com assinatura PDF (%PDF)', async () => {
    const buffer = await service.generate(FULL_DATA);
    const header = buffer.slice(0, 4).toString('ascii');

    expect(header).toBe('%PDF');
  });

  it('nao deve crashar com dados parciais (todos os campos opcionais null)', async () => {
    await expect(service.generate(EMPTY_DATA)).resolves.toBeInstanceOf(Buffer);
  });

  it('buffer com dados parciais tambem deve comecar com %PDF', async () => {
    const buffer = await service.generate(EMPTY_DATA);
    const header = buffer.slice(0, 4).toString('ascii');

    expect(header).toBe('%PDF');
  });

  it('deve gerar buffer valido com warnings no relatorio', async () => {
    const dataWithWarnings: ProjectReportDataDto = {
      ...EMPTY_DATA,
      warnings: ['forecast: histórico insuficiente.', 'métricas: não disponível.'],
    };

    const buffer = await service.generate(dataWithWarnings);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('deve tratar series grandes sem crashar (velocity com 50 sprints)', async () => {
    const bigSeries = Array.from({ length: 50 }, (_, i) => ({
      label: `Sprint ${i + 1}`,
      sprintId: String(i + 1),
      completed: Math.floor(Math.random() * 15),
      planned: 15,
    }));

    const dataWithBigSeries: ProjectReportDataDto = {
      ...FULL_DATA,
      velocity: { ...FULL_DATA.velocity, series: bigSeries },
    };

    const buffer = await service.generate(dataWithBigSeries);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('deve tratar nome de projeto muito longo sem crashar', async () => {
    const longNameData: ProjectReportDataDto = {
      ...FULL_DATA,
      project: {
        ...FULL_DATA.project,
        projectName: 'A'.repeat(200),
      },
    };

    const buffer = await service.generate(longNameData);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('deve gerar PDF com tasks incluidas', async () => {
    const dataWithTasks: ProjectReportDataDto = {
      ...FULL_DATA,
      tasks: [
        { taskId: '1', idStatus: '-444', idAssignee: '10', identifier: 'DEV-1', criadoEm: '2026-04-01T10:00:00.000Z' },
        { taskId: '2', idStatus: '-443', idAssignee: '11', identifier: 'DEV-2', criadoEm: '2026-04-02T10:00:00.000Z' },
      ],
    };

    const buffer = await service.generate(dataWithTasks);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
