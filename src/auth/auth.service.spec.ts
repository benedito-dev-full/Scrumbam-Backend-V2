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
    findMany: jest.fn().mockResolvedValue([]),
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
  let refreshTokenService: {
    generate: jest.Mock;
    validate: jest.Mock;
    rotate: jest.Mock;
    revoke: jest.Mock;
  };
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
      prisma.$transaction.mockImplementation(
        async (fn: (tx: typeof prisma) => Promise<unknown>) => {
          return fn({
            ...prisma,
            dUserGroup: {
              ...prisma.dUserGroup,
              create: jest.fn().mockResolvedValue(mockUserGroup),
            },
            dEntidade: {
              ...prisma.dEntidade,
              create: jest.fn().mockResolvedValueOnce(mockEntidade), // USER
            },
            dEvento: { create: jest.fn().mockResolvedValue({ chave: BigInt(5) }) },
          });
        },
      );

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

    it('deve permitir login órfão (sem DVincula) e emitir JWT sem organizationId (ADR-V2-038)', async () => {
      const senhaHash = await bcrypt.hash('senha123', 12);
      const mockUserGroup = {
        chave: BigInt(1),
        usuario: 'orphan@test.com',
        senha: senhaHash,
        excluido: false,
        ativo: true,
        entidades: [{ chave: BigInt(2), nome: 'Orphan User' }],
      };

      prisma.dUserGroup.findFirst.mockResolvedValue(mockUserGroup);
      // Sem DVincula ativa → estado órfão.
      prisma.dVincula.findFirst.mockResolvedValue(null);
      prisma.dVincula.findMany.mockResolvedValue([]); // loadAvailableOrgs
      prisma.dUserGroup.update.mockResolvedValue(mockUserGroup);
      prisma.dEvento.create.mockResolvedValue({ chave: BigInt(100) });

      const result = await service.login({ email: 'orphan@test.com', password: 'senha123' });

      // Login sucede (200), tokens emitidos.
      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.refreshToken).toBe('mock-refresh-token');
      // JWT payload NÃO contém organizationId quando órfão.
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.not.objectContaining({ organizationId: expect.anything() }),
        expect.anything(),
      );
      // user.organizationId/Name/orgRole vêm como undefined.
      expect(result.user.organizationId).toBeUndefined();
      expect(result.user.organizationName).toBeUndefined();
      expect(result.user.orgRole).toBeUndefined();
      // DEvento -501 marca o login como órfão para audit.
      expect(prisma.dEvento.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            descricao: 'auth.login',
            metaDados: expect.objectContaining({
              action: 'login',
              email: 'orphan@test.com',
              orphan: true,
            }),
          }),
        }),
      );
    });

    it('NÃO marca orphan=true em DEvento quando user tem org (regressão zero)', async () => {
      const senhaHash = await bcrypt.hash('senha123', 12);
      const mockUserGroup = {
        chave: BigInt(1),
        usuario: 'joao@test.com',
        senha: senhaHash,
        excluido: false,
        ativo: true,
        entidades: [{ chave: BigInt(2), nome: 'João' }],
      };

      prisma.dUserGroup.findFirst.mockResolvedValue(mockUserGroup);
      prisma.dVincula.findFirst.mockResolvedValue({
        idClasse: BigInt(-161),
        idLocEscritu: BigInt(3),
        locEscritu: { chave: BigInt(3), nome: 'Org' },
      });
      prisma.dUserGroup.update.mockResolvedValue(mockUserGroup);
      prisma.dEvento.create.mockResolvedValue({ chave: BigInt(100) });

      await service.login({ email: 'joao@test.com', password: 'senha123' });

      // metaDados NÃO deve conter o campo `orphan` em login normal.
      const eventoCall = prisma.dEvento.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { data: { descricao: string } }).data.descricao === 'auth.login',
      );
      expect(eventoCall).toBeDefined();
      const metaDados = (eventoCall![0] as { data: { metaDados: Record<string, unknown> } }).data
        .metaDados;
      expect(metaDados.orphan).toBeUndefined();
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

      await expect(service.refresh('stolen-token', BigInt(1))).rejects.toThrow(
        UnauthorizedException,
      );

      expect(refreshTokenService.revoke).toHaveBeenCalledWith(BigInt(1));
    });

    it('deve emitir JWT órfão quando user perdeu todos os vínculos (ADR-V2-038)', async () => {
      refreshTokenService.validate.mockResolvedValue(true);

      const mockUserGroup = {
        chave: BigInt(1),
        usuario: 'orphan@test.com',
        entidades: [{ chave: BigInt(2), nome: 'Orphan' }],
      };
      prisma.dUserGroup.findUnique.mockResolvedValue(mockUserGroup);
      // Sem DVincula ativa → órfão.
      prisma.dVincula.findFirst.mockResolvedValue(null);
      prisma.dVincula.findMany.mockResolvedValue([]); // loadAvailableOrgs

      const result = await service.refresh('valid-refresh-token', BigInt(1));

      // Sucede com novo par de tokens — sem UnauthorizedException.
      expect(refreshTokenService.rotate).toHaveBeenCalledWith(BigInt(1));
      expect(result.refreshToken).toBe('new-refresh-token');
      // JWT payload SEM organizationId.
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.not.objectContaining({ organizationId: expect.anything() }),
        expect.anything(),
      );
      expect(result.user.organizationId).toBeUndefined();
      expect(result.user.orgRole).toBeUndefined();
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
      // ADR-V2-030: getMe agora usa findMany para popular availableOrgs.
      prisma.dVincula.findMany.mockResolvedValue([
        {
          idClasse: BigInt(-161),
          idLocEscritu: BigInt(3),
          locEscritu: { chave: BigInt(3), nome: 'Empresa ABC' },
        },
      ]);

      const result = await service.getMe(BigInt(1));

      expect(result.id).toBe('1');
      expect(result.entidadeId).toBe('2');
      expect(result.orgRole).toBe('ADMIN');
      // Org principal vem do primeiro DVincula (-161 antes de -162/-163).
      expect(result.organizationId).toBe('3');
      expect(result.organizationName).toBe('Empresa ABC');
      // availableOrgs[] inclui todas as orgs com vinculo ativo.
      expect(result.availableOrgs).toHaveLength(1);
      expect(result.availableOrgs?.[0].role).toBe('ADMIN');
      // ADR-V2-038 Etapa 3: user com org → isOrphan: false (regressão zero).
      expect(result.isOrphan).toBe(false);
      // Verificar que usou no máximo 2 queries (findUnique + findMany).
      expect(prisma.dUserGroup.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.dVincula.findMany).toHaveBeenCalledTimes(1);
    });

    it('retorna isOrphan=true e availableOrgs=[] para user órfão (ADR-V2-038)', async () => {
      const mockUserGroup = {
        chave: BigInt(1),
        usuario: 'orphan@test.com',
        entidades: [{ chave: BigInt(2), nome: 'Orphan User' }],
      };
      prisma.dUserGroup.findUnique.mockResolvedValue(mockUserGroup);
      // Sem vínculos ativos.
      prisma.dVincula.findMany.mockResolvedValue([]);

      const result = await service.getMe(BigInt(1));

      expect(result.id).toBe('1');
      expect(result.entidadeId).toBe('2');
      expect(result.email).toBe('orphan@test.com');
      expect(result.name).toBe('Orphan User');
      // Sem org → todos os campos de workspace undefined.
      expect(result.organizationId).toBeUndefined();
      expect(result.organizationName).toBeUndefined();
      expect(result.orgRole).toBeUndefined();
      expect(result.availableOrgs).toHaveLength(0);
      // FLAG canônica para o frontend.
      expect(result.isOrphan).toBe(true);
    });

    it('lista multiplas orgs em availableOrgs (ADR-V2-030)', async () => {
      const mockUserGroup = {
        chave: BigInt(1),
        usuario: 'multi@test.com',
        entidades: [{ chave: BigInt(2), nome: 'Multi User' }],
      };
      prisma.dUserGroup.findUnique.mockResolvedValue(mockUserGroup);
      prisma.dVincula.findMany.mockResolvedValue([
        {
          idClasse: BigInt(-161),
          idLocEscritu: BigInt(10),
          locEscritu: { chave: BigInt(10), nome: 'Org A' },
        },
        {
          idClasse: BigInt(-162),
          idLocEscritu: BigInt(20),
          locEscritu: { chave: BigInt(20), nome: 'Org B' },
        },
      ]);

      const result = await service.getMe(BigInt(1));

      expect(result.availableOrgs).toHaveLength(2);
      expect(result.availableOrgs?.[0]).toEqual({
        id: '10',
        nome: 'Org A',
        role: 'ADMIN',
      });
      expect(result.availableOrgs?.[1]).toEqual({
        id: '20',
        nome: 'Org B',
        role: 'MEMBER',
      });
      // Org default = primeira (ADMIN antes).
      expect(result.organizationId).toBe('10');
      // Tem 2 orgs → não é órfão (regressão zero).
      expect(result.isOrphan).toBe(false);
    });
  });

  describe('issueSessionForUser', () => {
    it('emite JWT órfão quando user não tem vínculos e não há preferredOrgId (ADR-V2-038)', async () => {
      const mockUserGroup = {
        chave: BigInt(1),
        usuario: 'invited@test.com',
        entidades: [{ chave: BigInt(2), nome: 'Invited' }],
      };
      prisma.dUserGroup.findUnique.mockResolvedValue(mockUserGroup);
      // findFirst chamado pelo branch `preferred ?? ...` quando preferredOrgId
      // é undefined: o ramo `preferred` curto-circuita para null, e o `??`
      // dispara a query padrão de DVincula que retorna null.
      prisma.dVincula.findFirst.mockResolvedValue(null);
      prisma.dVincula.findMany.mockResolvedValue([]); // loadAvailableOrgs

      const result = await service.issueSessionForUser(BigInt(1));

      // Sucede com par de tokens — NÃO joga UnauthorizedException.
      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.refreshToken).toBe('mock-refresh-token');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.not.objectContaining({ organizationId: expect.anything() }),
        expect.anything(),
      );
      expect(result.user.organizationId).toBeUndefined();
      expect(result.user.orgRole).toBeUndefined();
    });
  });

  describe('switchOrg', () => {
    const mockUserGroup = {
      chave: BigInt(1),
      usuario: 'multi@test.com',
      entidades: [{ chave: BigInt(2), nome: 'Multi User' }],
    };

    it('emite novo par de tokens quando user tem DVincula ativo na org alvo', async () => {
      prisma.dUserGroup.findUnique.mockResolvedValue(mockUserGroup);
      prisma.dVincula.findFirst.mockResolvedValueOnce({
        idClasse: BigInt(-162),
        idLocEscritu: BigInt(20),
        locEscritu: { chave: BigInt(20), nome: 'Org B' },
      });
      // loadAvailableOrgs (chamado dentro de buildAuthResponse).
      prisma.dVincula.findMany.mockResolvedValue([]);
      prisma.dEvento.create.mockResolvedValue({ chave: BigInt(99) });

      const result = await service.switchOrg(BigInt(1), BigInt(20));

      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(result.user.organizationId).toBe('20');
      expect(result.user.organizationName).toBe('Org B');
      expect(result.user.orgRole).toBe('MEMBER');
      // Refresh rotacionado (nao gerado).
      expect(refreshTokenService.rotate).toHaveBeenCalledWith(BigInt(1));
      expect(refreshTokenService.generate).not.toHaveBeenCalled();
      // Audit DEvento -501 com action='org.switch'.
      expect(prisma.dEvento.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            descricao: 'auth.org.switch',
            metaDados: expect.objectContaining({ action: 'org.switch' }),
          }),
        }),
      );
    });

    it('lanca ForbiddenException quando user nao tem DVincula ativo na org alvo', async () => {
      prisma.dUserGroup.findUnique.mockResolvedValue(mockUserGroup);
      prisma.dVincula.findFirst.mockResolvedValueOnce(null); // membership inexistente

      await expect(service.switchOrg(BigInt(1), BigInt(99))).rejects.toThrow(
        /membro desta organizacao/i,
      );
      // NUNCA emitir token sem validar membership.
      expect(refreshTokenService.rotate).not.toHaveBeenCalled();
      expect(jwtService.sign).not.toHaveBeenCalled();
    });
  });
});
