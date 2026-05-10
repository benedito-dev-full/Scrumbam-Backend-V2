import { Test, TestingModule } from '@nestjs/testing';
import { WipAgeService } from '../wip-age.service';
import { PrismaService } from '../../../prisma.service';

const mockPrisma = {
  dTask: {
    findMany: jest.fn(),
  },
  dTabela: {
    findMany: jest.fn().mockResolvedValue([]),
  },
};

describe('WipAgeService', () => {
  let service: WipAgeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WipAgeService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WipAgeService>(WipAgeService);
    jest.clearAllMocks();
    mockPrisma.dTabela.findMany.mockResolvedValue([]);
    await service.loadStatusCodes();
  });

  it('deve retornar total=0 para projeto sem tasks', async () => {
    mockPrisma.dTask.findMany.mockResolvedValue([]);

    const result = await service.calculate(BigInt(1));

    expect(result.total).toBe(0);
    expect(result.byStatus).toHaveLength(0);
    expect(result.calculatedAt).toBeDefined();
  });

  it('deve agrupar tasks por status', async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    mockPrisma.dTask.findMany.mockResolvedValue([
      { idStatus: BigInt(-441), criadoEm: oneHourAgo, dados: {} }, // INBOX
      { idStatus: BigInt(-441), criadoEm: oneHourAgo, dados: {} }, // INBOX
      { idStatus: BigInt(-443), criadoEm: oneHourAgo, dados: {} }, // EXECUTING
    ]);

    const result = await service.calculate(BigInt(1));

    expect(result.total).toBe(3);
    expect(result.byStatus).toHaveLength(2);

    const inbox = result.byStatus.find((s) => s.statusCode === 'INBOX');
    expect(inbox).toBeDefined();
    expect(inbox!.count).toBe(2);

    const executing = result.byStatus.find((s) => s.statusCode === 'EXECUTING');
    expect(executing).toBeDefined();
    expect(executing!.count).toBe(1);
  });

  it('deve usar executingAt para tasks EXECUTING', async () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);

    mockPrisma.dTask.findMany.mockResolvedValue([
      {
        idStatus: BigInt(-443), // EXECUTING
        criadoEm: fourHoursAgo, // criadoEm: 4h atrás
        dados: {
          telemetry: { executingAt: twoHoursAgo.toISOString() }, // executingAt: 2h atrás
        },
      },
    ]);

    const result = await service.calculate(BigInt(1));

    // Deve usar executingAt (2h), não criadoEm (4h)
    expect(result.byStatus[0].avgAgeHours).toBeCloseTo(2, 0);
    expect(result.byStatus[0].maxAgeHours).toBeCloseTo(2, 0);
  });

  it('deve usar criadoEm para tasks INBOX', async () => {
    const now = new Date();
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

    mockPrisma.dTask.findMany.mockResolvedValue([
      {
        idStatus: BigInt(-441), // INBOX
        criadoEm: threeHoursAgo,
        dados: {},
      },
    ]);

    const result = await service.calculate(BigInt(1));

    expect(result.byStatus[0].avgAgeHours).toBeCloseTo(3, 0);
  });

  it('deve retornar statusCode do fallback para IDs desconhecidos', () => {
    const code = service.getStatusCode(BigInt(-444));
    expect(code).toBe('DONE');
  });

  it('deve calcular maxAgeHours como o maior valor do grupo', async () => {
    const now = new Date();
    const oneH = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    const tenH = new Date(now.getTime() - 10 * 60 * 60 * 1000);

    mockPrisma.dTask.findMany.mockResolvedValue([
      { idStatus: BigInt(-441), criadoEm: oneH, dados: {} },
      { idStatus: BigInt(-441), criadoEm: tenH, dados: {} },
    ]);

    const result = await service.calculate(BigInt(1));
    const inbox = result.byStatus.find((s) => s.statusCode === 'INBOX')!;
    expect(inbox.maxAgeHours).toBeGreaterThan(inbox.avgAgeHours);
    expect(inbox.maxAgeHours).toBeCloseTo(10, 0);
  });
});
