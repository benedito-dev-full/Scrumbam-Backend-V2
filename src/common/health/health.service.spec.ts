import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';
import { PrismaService } from '../../prisma.service';

describe('HealthService', () => {
  let service: HealthService;
  let mockPrisma: Partial<PrismaService>;
  let mockConfig: Partial<ConfigService>;

  beforeEach(async () => {
    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    mockConfig = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: string) => {
        const values: Record<string, string> = {
          EMAIL_MOCK: 'true',
          EMAIL_PROVIDER: 'smtp',
          SMTP_HOST: 'localhost',
        };
        return values[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: ConfigService,
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  describe('checkDb', () => {
    it('deve retornar ok quando Prisma conecta', async () => {
      const result = await service.checkDb();

      expect(result.status).toBe('ok');
      expect(result.latencyMs).toBeDefined();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it("deve retornar 'degraded' quando Redis não está configurado", async () => {
      // mockConfig.get retorna undefined para REDIS_URL (não está nas values)
      const result = await service.getStatus();

      expect(['ok', 'degraded']).toContain(result.status);
      expect(result.checks.db).toBeDefined();
      expect(result.checks.redis).toBeDefined();
      expect(result.checks.email).toBeDefined();

      // Redis não configurado → degraded
      expect(result.checks.redis.status).toBe('degraded');
    });

    it("deve retornar 'ok' quando DB conecta e email está em mock", async () => {
      const result = await service.getStatus();

      expect(result.checks.db.status).toBe('ok');
      expect(result.checks.email.status).toBe('ok');

      // Status geral deve ser degraded (redis não configurado) ou ok
      expect(['ok', 'degraded']).toContain(result.status);
    });
  });
});
