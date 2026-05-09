import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { PrismaService } from '../prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';

/** Mock factory para PrismaService. */
const makePrismaMock = () => ({
  dUserGroup: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  dEntidade: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  dVincula: {
    create: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
  dEvento: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
});

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let jwtService: { sign: jest.Mock };
  let refreshTokenService: { generate: jest.Mock; validate: jest.Mock; rotate: jest.Mock; revoke: jest.Mock };
  let organizationsService: { create: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    jwtService = { sign: jest.fn().mockReturnValue('mock.jwt.token') };
    refreshTokenService = {
      generate: jest.fn().mockResolvedValue('mock-refresh-token'),
      validate: jest.fn(),
      rotate: jest.fn().mockResolvedValue('new-refresh-token'),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    organizationsService = {
      create: jest.fn().mockResolvedValue({
        id: '3',
        nome: "João Silva's Org",
        description: null,
        memberCount: 1,
        criadoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('900') } },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: OrganizationsService, useValue: organizationsService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('deve criar usuário e delegar criação de org ao OrganizationsService (happy path)', async () => {
      prisma.dUserGroup.findFirst.mockResolvedValue(null); // email disponível

      const mockUserGroup = { chave: BigInt(1), usuario: 'joao@test.com' };
      const mockEntidade = { chave: BigInt(2), nome: 'João Silva', email: 'joao@test.com' };

      // Transaction 1: cria DUserGroup + DEntidade + DEvento
      prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
        return fn({
          ...prisma,
          dUserGroup: { ...prisma.dUserGroup, create: jest.fn().mockResolvedValue(mockUserGroup) },
          dEntidade: {
            ...prisma.dEntidade,
            create: jest.fn().mockResolvedValueOnce(mockEntidade), // USER
          },
          dEvento: { create: jest.fn().mockResolvedValue({ chave: BigInt(5) }) },
        });
      });

      // Transaction 2 (OrganizationsService.create) já mockado no beforeEach

      const result = await service.register({
        name: 'João Silva',
        email: 'joao@test.com',
        password: 'senha123',
      });

      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.refreshToken).toBe('mock-refresh-token');
      expect(result.tokenType).toBe('Bearer');
      expect(result.user.email).toBe('joao@test.com');
      // OrganizationsService.create deve ter sido chamado com o nome da org
      expect(organizationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ nome: expect.stringContaining('Org') }),
        BigInt(2), // entidadeId do usuário
      );
    });

    it('deve lançar ConflictException se email já cadastrado', async () => {
      prisma.dUserGroup.findFirst.mockResolvedValue({ chave: BigInt(99) });

      await expect(
        service.register({ name: 'Duplicado', email: 'existente@test.com', password: 'senha123' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('deve autenticar com credenciais válidas (happy path)', async () => {
      const senhaHash = await bcrypt.hash('senha123', 12);
      const mockUserGroup = {
        chave: BigInt(1),
        usuario: 'joao@test.com',
        senha: senhaHash,
        excluido: false,
        ativo: true,
        entidades: [{ chave: BigInt(2), nome: 'João Silva' }],
      };

      prisma.dUserGroup.findFirst.mockResolvedValue(mockUserGroup);
      prisma.dVincula.findFirst.mockResolvedValue({
        idClasse: BigInt(-161),
        idLocEscritu: BigInt(3),
        locEscritu: { chave: BigInt(3), nome: 'Empresa ABC' },
      });
      prisma.dUserGroup.update.mockResolvedValue(mockUserGroup);
      prisma.dEvento.create.mockResolvedValue({ chave: BigInt(100) });

      const result = await service.login({ email: 'joao@test.com', password: 'senha123' });

      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.user.orgRole).toBe('ADMIN');
    });

    it('deve lançar UnauthorizedException se usuário não encontrado', async () => {
      prisma.dUserGroup.findFirst.mockResolvedValue(null);
      prisma.dEvento.create.mockResolvedValue({ chave: BigInt(100) });

      await expect(
        service.login({ email: 'inexistente@test.com', password: 'senha123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('deve lançar UnauthorizedException se senha incorreta', async () => {
      const senhaHash = await bcrypt.hash('outrasenha', 12);
      prisma.dUserGroup.findFirst.mockResolvedValue({
        chave: BigInt(1),
        usuario: 'joao@test.com',
        senha: senhaHash,
        excluido: false,
        ativo: true,
        entidades: [{ chave: BigInt(2), nome: 'João' }],
      });
      prisma.dEvento.create.mockResolvedValue({ chave: BigInt(100) });

      await expect(
        service.login({ email: 'joao@test.com', password: 'senhaerrada' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('deve rotacionar refresh token (happy path)', async () => {
      refreshTokenService.validate.mockResolvedValue(true);

      const mockUserGroup = {
        chave: BigInt(1),
        usuario: 'joao@test.com',
        entidades: [{ chave: BigInt(2), nome: 'João' }],
      };
      prisma.dUserGroup.findUnique.mockResolvedValue(mockUserGroup);
      prisma.dVincula.findFirst.mockResolvedValue({
        idClasse: BigInt(-161),
        idLocEscritu: BigInt(3),
      });

      const result = await service.refresh('valid-refresh-token', BigInt(1));

      expect(refreshTokenService.rotate).toHaveBeenCalledWith(BigInt(1));
      expect(result.refreshToken).toBe('new-refresh-token');
    });

    it('deve detectar reuse attack e revogar tokens', async () => {
      refreshTokenService.validate.mockResolvedValue(false);

      await expect(
        service.refresh('stolen-token', BigInt(1)),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshTokenService.revoke).toHaveBeenCalledWith(BigInt(1));
    });
  });

  describe('logout', () => {
    it('deve revogar refresh token no logout', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue({ chave: BigInt(2) });
      prisma.dEvento.create.mockResolvedValue({ chave: BigInt(100) });

      await service.logout(BigInt(1));

      expect(refreshTokenService.revoke).toHaveBeenCalledWith(BigInt(1));
    });
  });

  describe('getMe', () => {
    it('deve retornar perfil completo com ≤ 3 queries', async () => {
      const mockUserGroup = {
        chave: BigInt(1),
        usuario: 'joao@test.com',
        entidades: [{ chave: BigInt(2), nome: 'João Silva' }],
      };
      prisma.dUserGroup.findUnique.mockResolvedValue(mockUserGroup);
      prisma.dVincula.findFirst.mockResolvedValue({
        idClasse: BigInt(-161),
        idLocEscritu: BigInt(3),
        locEscritu: { chave: BigInt(3), nome: 'Empresa ABC' },
      });

      const result = await service.getMe(BigInt(1));

      expect(result.id).toBe('1');
      expect(result.entidadeId).toBe('2');
      expect(result.orgRole).toBe('ADMIN');
      // Verificar que usou no máximo 2 queries (findUnique + findFirst)
      expect(prisma.dUserGroup.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.dVincula.findFirst).toHaveBeenCalledTimes(1);
    });
  });
});
