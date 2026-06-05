import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { RefreshTokenService } from './refresh-token.service';
import { PrismaService } from '../../prisma.service';

const makePrismaMock = () => ({
  dUserGroup: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
});

const makeConfigMock = (refreshTokenExpiryDays?: string) => ({
  get: jest.fn((key: string) => {
    if (key === 'REFRESH_TOKEN_EXPIRY_DAYS') {
      return refreshTokenExpiryDays;
    }
    return undefined;
  }),
});

const DAY_MS = 24 * 60 * 60 * 1000;

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let config: ReturnType<typeof makeConfigMock>;

  /** Recria o módulo com um valor específico (ou ausente) da env. */
  const buildService = async (refreshTokenExpiryDays?: string) => {
    prisma = makePrismaMock();
    config = makeConfigMock(refreshTokenExpiryDays);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<RefreshTokenService>(RefreshTokenService);
  };

  beforeEach(async () => {
    await buildService('7');
  });

  describe('generate', () => {
    it('deve gerar token e salvar hash + expiresAt no futuro', async () => {
      prisma.dUserGroup.findUnique.mockResolvedValue({ dados: {} });
      prisma.dUserGroup.update.mockResolvedValue({});

      const before = Date.now();
      const token = await service.generate(BigInt(1));
      const after = Date.now();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(32);

      const updateCall = prisma.dUserGroup.update.mock.calls[0][0];
      const dados = updateCall.data.dados;
      expect(dados.refreshTokenHash).toEqual(expect.any(String));
      expect(typeof dados.refreshTokenExpiresAt).toBe('string');

      // expiresAt ≈ now + 7 dias
      const expiresAtMs = new Date(dados.refreshTokenExpiresAt).getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 7 * DAY_MS - 1000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + 7 * DAY_MS + 1000);
    });

    it('deve usar default 7 dias quando env ausente', async () => {
      await buildService(undefined);
      prisma.dUserGroup.findUnique.mockResolvedValue({ dados: {} });
      prisma.dUserGroup.update.mockResolvedValue({});

      const before = Date.now();
      await service.generate(BigInt(1));

      const dados = prisma.dUserGroup.update.mock.calls[0][0].data.dados;
      const expiresAtMs = new Date(dados.refreshTokenExpiresAt).getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 7 * DAY_MS - 1000);
    });

    it('deve usar default e logar warn quando env inválida', async () => {
      await buildService('not-a-number');
      prisma.dUserGroup.findUnique.mockResolvedValue({ dados: {} });
      prisma.dUserGroup.update.mockResolvedValue({});

      const warnSpy = jest
        .spyOn((service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
        .mockImplementation(() => undefined);

      const before = Date.now();
      await service.generate(BigInt(1));

      expect(warnSpy).toHaveBeenCalled();
      const dados = prisma.dUserGroup.update.mock.calls[0][0].data.dados;
      const expiresAtMs = new Date(dados.refreshTokenExpiresAt).getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 7 * DAY_MS - 1000);
    });

    it('deve usar default e logar warn quando env <= 0', async () => {
      await buildService('0');
      prisma.dUserGroup.findUnique.mockResolvedValue({ dados: {} });
      prisma.dUserGroup.update.mockResolvedValue({});

      const warnSpy = jest
        .spyOn((service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
        .mockImplementation(() => undefined);

      await service.generate(BigInt(1));

      expect(warnSpy).toHaveBeenCalled();
    });

    it('deve usar default e logar warn quando env negativa', async () => {
      await buildService('-5');
      prisma.dUserGroup.findUnique.mockResolvedValue({ dados: {} });
      prisma.dUserGroup.update.mockResolvedValue({});

      const warnSpy = jest
        .spyOn((service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
        .mockImplementation(() => undefined);

      const before = Date.now();
      await service.generate(BigInt(1));

      expect(warnSpy).toHaveBeenCalled();
      const updateCall = prisma.dUserGroup.update.mock.calls[0][0];
      const expiresAtMs = new Date(
        (updateCall.data.dados as { refreshTokenExpiresAt: string }).refreshTokenExpiresAt,
      ).getTime();
      // Caiu no default 7 dias (nunca expiry negativo/imediato).
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 7 * DAY_MS - 1000);
    });

    it('deve rejeitar valor lixo tipo "7abc" (não aceita parseInt leniente)', async () => {
      await buildService('7abc');
      prisma.dUserGroup.findUnique.mockResolvedValue({ dados: {} });
      prisma.dUserGroup.update.mockResolvedValue({});

      const warnSpy = jest
        .spyOn((service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
        .mockImplementation(() => undefined);

      const before = Date.now();
      await service.generate(BigInt(1));

      // '7abc' NÃO vira 7 — vira default (com warn), provando o guard de formato.
      expect(warnSpy).toHaveBeenCalled();
      const updateCall = prisma.dUserGroup.update.mock.calls[0][0];
      const expiresAtMs = new Date(
        (updateCall.data.dados as { refreshTokenExpiresAt: string }).refreshTokenExpiresAt,
      ).getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 7 * DAY_MS - 1000);
    });
  });

  describe('validate', () => {
    it("deve retornar 'valid' para token fresco (não expirado)", async () => {
      const plaintext = 'valid-token-plaintext';
      const hash = createHash('sha256').update(plaintext).digest('hex');
      const futureExpiry = new Date(Date.now() + 7 * DAY_MS).toISOString();

      prisma.dUserGroup.findUnique.mockResolvedValue({
        dados: { refreshTokenHash: hash, refreshTokenExpiresAt: futureExpiry },
      });

      const result = await service.validate(plaintext, BigInt(1));
      expect(result).toBe('valid');
    });

    it("deve retornar 'expired' para token com expiresAt no passado", async () => {
      const plaintext = 'old-token-plaintext';
      const hash = createHash('sha256').update(plaintext).digest('hex');
      const pastExpiry = new Date(Date.now() - 1000).toISOString();

      prisma.dUserGroup.findUnique.mockResolvedValue({
        dados: { refreshTokenHash: hash, refreshTokenExpiresAt: pastExpiry },
      });

      const result = await service.validate(plaintext, BigInt(1));
      expect(result).toBe('expired');
    });

    it("deve retornar 'expired' para registro legado sem expiresAt", async () => {
      const plaintext = 'legacy-token-plaintext';
      const hash = createHash('sha256').update(plaintext).digest('hex');

      prisma.dUserGroup.findUnique.mockResolvedValue({
        dados: { refreshTokenHash: hash },
      });

      const result = await service.validate(plaintext, BigInt(1));
      expect(result).toBe('expired');
    });

    it("deve retornar 'invalid' para hash errado", async () => {
      prisma.dUserGroup.findUnique.mockResolvedValue({
        dados: { refreshTokenHash: 'otherhash', refreshTokenExpiresAt: new Date().toISOString() },
      });

      const result = await service.validate('wrong-token', BigInt(1));
      expect(result).toBe('invalid');
    });

    it("deve retornar 'invalid' se token foi revogado (sem hash)", async () => {
      prisma.dUserGroup.findUnique.mockResolvedValue({ dados: {} });

      const result = await service.validate('any-token', BigInt(1));
      expect(result).toBe('invalid');
    });
  });

  describe('revoke', () => {
    it('deve limpar refreshTokenHash E refreshTokenExpiresAt do banco', async () => {
      prisma.dUserGroup.findUnique.mockResolvedValue({
        dados: {
          refreshTokenHash: 'somehash',
          refreshTokenExpiresAt: new Date().toISOString(),
          mcpKeyHash: 'mcphash',
        },
      });
      prisma.dUserGroup.update.mockResolvedValue({});

      await service.revoke(BigInt(1));

      const updateCall = prisma.dUserGroup.update.mock.calls[0][0];
      expect(updateCall.data.dados).not.toHaveProperty('refreshTokenHash');
      expect(updateCall.data.dados).not.toHaveProperty('refreshTokenExpiresAt');
      // mcpKeyHash deve ser preservado
      expect(updateCall.data.dados).toHaveProperty('mcpKeyHash', 'mcphash');
    });
  });
});
