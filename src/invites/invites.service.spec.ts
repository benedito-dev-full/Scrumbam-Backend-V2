import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';

import { InvitesService } from './invites.service';
import { PrismaService } from '../prisma.service';
import { EmailService } from '../email/email.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';
import { AuthService } from '../auth/auth.service';

/**
 * Testes unitarios do InvitesService (ADR-V2-028).
 *
 * Cobre os caminhos principais: criar com sucesso, ADMIN ausente,
 * email ja membro, anti-enumeracao no GET, race no accept e fluxo
 * completo de aceite com auto-login.
 */
describe('InvitesService', () => {
  let service: InvitesService;
  let prismaMock: {
    dEntidade: { findFirst: jest.Mock };
    dVincula: { findFirst: jest.Mock; create: jest.Mock };
    dTabela: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    dUserGroup: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let emailMock: { sendTemplate: jest.Mock };
  let eventMock: { addInternalEvent: jest.Mock };
  let authMock: { issueSessionForUser: jest.Mock };

  beforeEach(async () => {
    prismaMock = {
      dEntidade: { findFirst: jest.fn() },
      dVincula: { findFirst: jest.fn(), create: jest.fn() },
      dTabela: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      dUserGroup: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    emailMock = { sendTemplate: jest.fn().mockResolvedValue({ id: 'msg-1' }) };
    eventMock = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
    authMock = {
      issueSessionForUser: jest.fn().mockResolvedValue({
        accessToken: 'jwt',
        refreshToken: 'refresh',
        expiresIn: 900,
        tokenType: 'Bearer',
        user: { id: '1', entidadeId: '2', email: 'x@y.com', name: 'Maria' },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EmailService, useValue: emailMock },
        { provide: EventProducerService, useValue: eventMock },
        {
          provide: CorrelationIdService,
          useValue: { getOrGenerate: () => 'corr-1' },
        },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: string) => d ?? 'http://localhost:3000' },
        },
        { provide: AuthService, useValue: authMock },
      ],
    }).compile();

    service = module.get(InvitesService);
  });

  describe('createInvite', () => {
    const setupBasicMocks = (overrides?: {
      org?: object | null;
      inviterVinculo?: object | null;
      inviterEntidade?: object | null;
    }) => {
      // Promise.all retorna em ordem: [org, inviterVinculo, inviterEntidade]
      prismaMock.dEntidade.findFirst.mockImplementation(
        (args: { where: Record<string, unknown> }) => {
          // org (idClasse=-152)
          if (args.where.idClasse === BigInt(-152)) {
            return Promise.resolve(
              overrides?.org === null
                ? null
                : (overrides?.org ?? { chave: BigInt(100), nome: 'Acme' }),
            );
          }
          // inviter (idClasse=-150)
          if (args.where.idClasse === BigInt(-150) && args.where.chave === BigInt(7)) {
            return Promise.resolve(
              overrides?.inviterEntidade === null
                ? null
                : (overrides?.inviterEntidade ?? { chave: BigInt(7), nome: 'Joao Admin' }),
            );
          }
          // existingUser by email — default none
          return Promise.resolve(null);
        },
      );
      prismaMock.dVincula.findFirst.mockResolvedValue(
        overrides?.inviterVinculo === null
          ? null
          : (overrides?.inviterVinculo ?? { chave: BigInt(999) }),
      );
      prismaMock.dTabela.findMany.mockResolvedValue([]); // sem pendentes
      prismaMock.dTabela.create.mockResolvedValue({ chave: BigInt(555) });
    };

    it('cria convite com sucesso e dispara email fire-and-forget', async () => {
      setupBasicMocks();

      const result = await service.createInvite(
        '100',
        { email: 'novo@x.com', role: 'MEMBER' },
        BigInt(7),
      );

      expect(result.id).toBe('555');
      expect(result.email).toBe('novo@x.com');
      expect(result.role).toBe('MEMBER');
      expect(prismaMock.dTabela.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idClasse: BigInt(-476),
            nome: 'novo@x.com',
            idLocEscrituracao: BigInt(100),
            dEntidadeId: BigInt(7),
            metaDados: expect.objectContaining({
              tokenHash: expect.any(String),
              role: 'MEMBER',
              status: 'PENDING',
            }),
          }),
        }),
      );
      expect(eventMock.addInternalEvent).toHaveBeenCalledWith(
        'invite.sent',
        expect.objectContaining({ inviteId: '555', email: 'novo@x.com', role: 'MEMBER' }),
        'corr-1',
        expect.anything(),
      );
      // sendTemplate eh fire-and-forget: aguardar microtask
      await new Promise((r) => setImmediate(r));
      expect(emailMock.sendTemplate).toHaveBeenCalledWith(
        'invite',
        expect.objectContaining({
          inviterName: 'Joao Admin',
          orgName: 'Acme',
          inviteUrl: expect.stringContaining('/invite?token='),
        }),
        'novo@x.com',
      );
    });

    it('rejeita com NotFoundException se org nao existe', async () => {
      setupBasicMocks({ org: null });
      await expect(
        service.createInvite('100', { email: 'a@b.com', role: 'MEMBER' }, BigInt(7)),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejeita com ForbiddenException se inviter nao e ADMIN', async () => {
      setupBasicMocks({ inviterVinculo: null });
      await expect(
        service.createInvite('100', { email: 'a@b.com', role: 'MEMBER' }, BigInt(7)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejeita com ConflictException se email ja e membro da org', async () => {
      setupBasicMocks();
      // override: existingUser encontrado + vinculo ativo
      prismaMock.dEntidade.findFirst.mockImplementation(
        (args: { where: Record<string, unknown> }) => {
          if (args.where.idClasse === BigInt(-152)) {
            return Promise.resolve({ chave: BigInt(100), nome: 'Acme' });
          }
          if (args.where.idClasse === BigInt(-150) && args.where.chave === BigInt(7)) {
            return Promise.resolve({ chave: BigInt(7), nome: 'Joao Admin' });
          }
          // existingUser por email
          if (args.where.email) {
            return Promise.resolve({ chave: BigInt(42) });
          }
          return Promise.resolve(null);
        },
      );
      // ADMIN vinculo encontrado, depois membership do alvo encontrado:
      prismaMock.dVincula.findFirst
        .mockResolvedValueOnce({ chave: BigInt(999) }) // inviter ADMIN
        .mockResolvedValueOnce({ chave: BigInt(123) }); // target ja e membro

      await expect(
        service.createInvite('100', { email: 'ja@member.com', role: 'MEMBER' }, BigInt(7)),
      ).rejects.toThrow(ConflictException);
    });

    it('rejeita com ConflictException se ja existe convite pendente nao expirado', async () => {
      setupBasicMocks();
      const future = new Date(Date.now() + 86_400_000).toISOString();
      prismaMock.dTabela.findMany.mockResolvedValue([
        {
          chave: BigInt(777),
          metaDados: {
            tokenHash: 'old',
            role: 'MEMBER',
            expiresAt: future,
            usedAt: null,
            status: 'PENDING',
            invitedByUserId: '7',
          },
        },
      ]);

      await expect(
        service.createInvite('100', { email: 'novo@x.com', role: 'MEMBER' }, BigInt(7)),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getInviteByToken (anti-enumeracao)', () => {
    it('retorna info publica sanitizada para token valido', async () => {
      const raw = 'abcdef123';
      const hash = createHash('sha256').update(raw).digest('hex');
      const future = new Date(Date.now() + 60_000).toISOString();
      prismaMock.dTabela.findMany.mockResolvedValue([
        {
          chave: BigInt(555),
          idClasse: BigInt(-476),
          nome: 'convidado@x.com',
          idLocEscrituracao: BigInt(100),
          dEntidadeId: BigInt(7),
          metaDados: {
            tokenHash: hash,
            role: 'MEMBER',
            expiresAt: future,
            usedAt: null,
            status: 'PENDING',
            invitedByUserId: '7',
          },
        },
      ]);
      prismaMock.dEntidade.findFirst.mockImplementation(
        (args: { where: Record<string, unknown> }) => {
          if (args.where.idClasse === BigInt(-152)) {
            return Promise.resolve({ nome: 'Acme' });
          }
          return Promise.resolve({ nome: 'Joao Admin' });
        },
      );

      const info = await service.getInviteByToken(raw);

      expect(info.orgName).toBe('Acme');
      expect(info.inviterName).toBe('Joao Admin');
      expect(info.email).toBe('convidado@x.com');
      expect(info.role).toBe('MEMBER');
      expect(info.expiresAt).toBe(future);
      // Garantir que nao vaza tokenHash ou inviteId interno
      expect((info as unknown as Record<string, unknown>).tokenHash).toBeUndefined();
      expect((info as unknown as Record<string, unknown>).inviteId).toBeUndefined();
    });

    it('retorna 404 generico para token inexistente (anti-enumeracao)', async () => {
      prismaMock.dTabela.findMany.mockResolvedValue([]);
      await expect(service.getInviteByToken('inexistente')).rejects.toThrow(NotFoundException);
    });

    it('retorna 404 generico para token expirado', async () => {
      const raw = 'expirado';
      const hash = createHash('sha256').update(raw).digest('hex');
      const past = new Date(Date.now() - 60_000).toISOString();
      prismaMock.dTabela.findMany.mockResolvedValue([
        {
          chave: BigInt(1),
          idLocEscrituracao: BigInt(100),
          dEntidadeId: BigInt(7),
          nome: 'a@b.com',
          metaDados: {
            tokenHash: hash,
            role: 'MEMBER',
            expiresAt: past,
            usedAt: null,
            status: 'PENDING',
            invitedByUserId: '7',
          },
        },
      ]);
      await expect(service.getInviteByToken(raw)).rejects.toThrow(NotFoundException);
    });

    it('retorna 404 generico para token ja usado', async () => {
      const raw = 'usado';
      const hash = createHash('sha256').update(raw).digest('hex');
      const future = new Date(Date.now() + 60_000).toISOString();
      prismaMock.dTabela.findMany.mockResolvedValue([
        {
          chave: BigInt(1),
          idLocEscrituracao: BigInt(100),
          dEntidadeId: BigInt(7),
          nome: 'a@b.com',
          metaDados: {
            tokenHash: hash,
            role: 'MEMBER',
            expiresAt: future,
            usedAt: new Date().toISOString(),
            status: 'ACCEPTED',
            invitedByUserId: '7',
          },
        },
      ]);
      await expect(service.getInviteByToken(raw)).rejects.toThrow(NotFoundException);
    });

    it('retorna 404 generico para token vazio (anti-enumeracao)', async () => {
      await expect(service.getInviteByToken('')).rejects.toThrow(NotFoundException);
    });
  });

  describe('acceptInvite', () => {
    it('aceita convite valido (new_user), cria usuario e auto-login', async () => {
      const raw = 'valid-token';
      const hash = createHash('sha256').update(raw).digest('hex');
      const future = new Date(Date.now() + 60_000).toISOString();

      const inviteRow = {
        chave: BigInt(555),
        idLocEscrituracao: BigInt(100),
        dEntidadeId: BigInt(7),
        nome: 'novo@x.com',
        metaDados: {
          tokenHash: hash,
          role: 'MEMBER',
          expiresAt: future,
          usedAt: null,
          status: 'PENDING',
          invitedByUserId: '7',
          flow: 'new_user',
        },
      };
      // Pre-resolve do flow (chama this.prisma.dTabela.findMany fora da tx).
      prismaMock.dTabela.findMany.mockResolvedValue([inviteRow]);

      const txClient = {
        dEntidade: { findFirst: jest.fn(), create: jest.fn() },
        dUserGroup: { create: jest.fn() },
        dVincula: { create: jest.fn() },
        dTabela: { findMany: jest.fn().mockResolvedValue([inviteRow]), update: jest.fn() },
      };
      txClient.dEntidade.findFirst.mockImplementation(
        (args: { where: Record<string, unknown> }) => {
          if (args.where.idClasse === BigInt(-150)) return Promise.resolve(null); // sem user
          if (args.where.idClasse === BigInt(-152)) {
            return Promise.resolve({ chave: BigInt(100) });
          }
          return Promise.resolve(null);
        },
      );
      txClient.dUserGroup.create.mockResolvedValue({ chave: BigInt(900) });
      txClient.dEntidade.create.mockResolvedValue({ chave: BigInt(901) });
      txClient.dVincula.create.mockResolvedValue({ chave: BigInt(902) });
      txClient.dTabela.update.mockResolvedValue({});

      prismaMock.$transaction.mockImplementation(
        async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient),
      );

      const result = await service.acceptInvite(raw, { name: 'Maria', password: 'senha123' });

      expect(result.accessToken).toBe('jwt');
      expect(result.refreshToken).toBe('refresh');
      expect(result.redirectTo).toBe('/intentions');
      // issueSessionForUser agora recebe (userGroupId, preferredOrgId).
      expect(authMock.issueSessionForUser).toHaveBeenCalledWith(BigInt(900), BigInt(100));
      expect(txClient.dVincula.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idClasse: BigInt(-162), // MEMBER
            idLocEscritu: BigInt(100),
            idEntidade: BigInt(901),
          }),
        }),
      );
      expect(txClient.dTabela.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metaDados: expect.objectContaining({ status: 'ACCEPTED', usedAt: expect.any(String) }),
          }),
        }),
      );
      expect(eventMock.addInternalEvent).toHaveBeenCalledWith(
        'invite.accepted',
        expect.objectContaining({
          inviteId: '555',
          newUserId: '901',
          role: 'MEMBER',
          flow: 'new_user',
        }),
        'corr-1',
        expect.anything(),
      );
    });

    it('merge flow (existing_user): cria APENAS DVincula, sem DUserGroup nem DEntidade', async () => {
      const raw = 'merge-token';
      const hash = createHash('sha256').update(raw).digest('hex');
      const future = new Date(Date.now() + 60_000).toISOString();

      const inviteRow = {
        chave: BigInt(700),
        idLocEscrituracao: BigInt(200),
        dEntidadeId: BigInt(7),
        nome: 'b@test.com',
        metaDados: {
          tokenHash: hash,
          role: 'MEMBER',
          expiresAt: future,
          usedAt: null,
          status: 'PENDING',
          invitedByUserId: '7',
          flow: 'existing_user',
          targetUserId: '42',
        },
      };
      prismaMock.dTabela.findMany.mockResolvedValue([inviteRow]);

      const txClient = {
        dEntidade: { findFirst: jest.fn(), create: jest.fn() },
        dUserGroup: { create: jest.fn() },
        dVincula: { findFirst: jest.fn(), create: jest.fn() },
        dTabela: { findMany: jest.fn().mockResolvedValue([inviteRow]), update: jest.fn() },
      };
      txClient.dEntidade.findFirst.mockImplementation(
        (args: { where: Record<string, unknown> }) => {
          // org check
          if (args.where.idClasse === BigInt(-152)) {
            return Promise.resolve({ chave: BigInt(200) });
          }
          // target user lookup (chave=42, idClasse=-150)
          if (args.where.idClasse === BigInt(-150) && args.where.chave === BigInt(42)) {
            return Promise.resolve({
              chave: BigInt(42),
              dUserGroupId: BigInt(99),
              email: 'b@test.com',
            });
          }
          return Promise.resolve(null);
        },
      );
      // race-safe: ainda nao e membro desta org
      txClient.dVincula.findFirst.mockResolvedValue(null);
      txClient.dVincula.create.mockResolvedValue({ chave: BigInt(800) });
      txClient.dTabela.update.mockResolvedValue({});

      prismaMock.$transaction.mockImplementation(
        async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient),
      );

      const result = await service.acceptInvite(raw, {});

      expect(result.redirectTo).toBe('/intentions');
      // CRITICAL: NUNCA criar DUserGroup nem DEntidade no merge flow.
      expect(txClient.dUserGroup.create).not.toHaveBeenCalled();
      expect(txClient.dEntidade.create).not.toHaveBeenCalled();
      // DVincula criada com idEntidade do user existente, nao um novo.
      expect(txClient.dVincula.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idClasse: BigInt(-162),
            idLocEscritu: BigInt(200),
            idEntidade: BigInt(42),
            metaDados: expect.objectContaining({ mergedFromInvite: true }),
          }),
        }),
      );
      // Auto-login usa o dUserGroupId do user existente + prefere a org mergeada.
      expect(authMock.issueSessionForUser).toHaveBeenCalledWith(BigInt(99), BigInt(200));
      expect(eventMock.addInternalEvent).toHaveBeenCalledWith(
        'invite.accepted.merge',
        expect.objectContaining({ flow: 'existing_user' }),
        'corr-1',
        expect.anything(),
      );
    });

    it('merge flow: re-check de race (user ja virou membro da org alvo entre createInvite e accept)', async () => {
      const raw = 'merge-race';
      const hash = createHash('sha256').update(raw).digest('hex');
      const future = new Date(Date.now() + 60_000).toISOString();

      const inviteRow = {
        chave: BigInt(701),
        idLocEscrituracao: BigInt(200),
        dEntidadeId: BigInt(7),
        nome: 'race@test.com',
        metaDados: {
          tokenHash: hash,
          role: 'MEMBER',
          expiresAt: future,
          usedAt: null,
          status: 'PENDING',
          invitedByUserId: '7',
          flow: 'existing_user',
          targetUserId: '42',
        },
      };
      prismaMock.dTabela.findMany.mockResolvedValue([inviteRow]);

      const txClient = {
        dEntidade: { findFirst: jest.fn(), create: jest.fn() },
        dUserGroup: { create: jest.fn() },
        dVincula: { findFirst: jest.fn(), create: jest.fn() },
        dTabela: { findMany: jest.fn().mockResolvedValue([inviteRow]), update: jest.fn() },
      };
      txClient.dEntidade.findFirst.mockImplementation(
        (args: { where: Record<string, unknown> }) => {
          if (args.where.idClasse === BigInt(-152)) {
            return Promise.resolve({ chave: BigInt(200) });
          }
          if (args.where.idClasse === BigInt(-150) && args.where.chave === BigInt(42)) {
            return Promise.resolve({
              chave: BigInt(42),
              dUserGroupId: BigInt(99),
              email: 'race@test.com',
            });
          }
          return Promise.resolve(null);
        },
      );
      // RACE: ja existe DVincula na org alvo — outro admin pode ter adicionado.
      txClient.dVincula.findFirst.mockResolvedValue({ chave: BigInt(123) });

      prismaMock.$transaction.mockImplementation(
        async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient),
      );

      await expect(service.acceptInvite(raw, {})).rejects.toThrow(ConflictException);
      expect(txClient.dVincula.create).not.toHaveBeenCalled();
    });

    it('rejeita com NotFoundException para token invalido', async () => {
      // Pre-resolve no service usa this.prisma.dTabela.findMany — vazio.
      prismaMock.dTabela.findMany.mockResolvedValue([]);
      const txClient = {
        dEntidade: { findFirst: jest.fn() },
        dUserGroup: { create: jest.fn() },
        dVincula: { create: jest.fn() },
        dTabela: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      };
      prismaMock.$transaction.mockImplementation(
        async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient),
      );

      await expect(
        service.acceptInvite('invalido', { name: 'x', password: 'senha123' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('new_user flow: rejeita com ConflictException se email virou user entre GET e POST (race)', async () => {
      const raw = 'race-token';
      const hash = createHash('sha256').update(raw).digest('hex');
      const future = new Date(Date.now() + 60_000).toISOString();

      const inviteRow = {
        chave: BigInt(1),
        idLocEscrituracao: BigInt(100),
        dEntidadeId: BigInt(7),
        nome: 'race@x.com',
        metaDados: {
          tokenHash: hash,
          role: 'MEMBER',
          expiresAt: future,
          usedAt: null,
          status: 'PENDING',
          invitedByUserId: '7',
          flow: 'new_user',
        },
      };
      prismaMock.dTabela.findMany.mockResolvedValue([inviteRow]);

      const txClient = {
        dEntidade: { findFirst: jest.fn(), create: jest.fn() },
        dUserGroup: { create: jest.fn() },
        dVincula: { create: jest.fn() },
        dTabela: {
          findMany: jest.fn().mockResolvedValue([inviteRow]),
          update: jest.fn(),
        },
      };
      // user JA existe (race)
      txClient.dEntidade.findFirst.mockImplementation(
        (args: { where: Record<string, unknown> }) => {
          if (args.where.idClasse === BigInt(-150)) {
            return Promise.resolve({ chave: BigInt(42) });
          }
          if (args.where.idClasse === BigInt(-152)) {
            return Promise.resolve({ chave: BigInt(100) });
          }
          return Promise.resolve(null);
        },
      );
      prismaMock.$transaction.mockImplementation(
        async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient),
      );

      await expect(
        service.acceptInvite(raw, { name: 'Maria', password: 'senha123' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('cancelInvite', () => {
    /**
     * Helper para montar um DTabela INVITE_TOKEN consistente. Customizavel via
     * overrides — usado pelos 7 casos abaixo.
     */
    const buildInviteRow = (overrides?: {
      chave?: bigint;
      orgId?: bigint;
      email?: string;
      status?: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
      role?: 'MEMBER' | 'VIEWER';
    }) => ({
      chave: overrides?.chave ?? BigInt(789),
      idClasse: BigInt(-476),
      nome: overrides?.email ?? 'pendente@x.com',
      idLocEscrituracao: overrides?.orgId ?? BigInt(100),
      criadoEm: new Date('2026-05-10T12:00:00.000Z'),
      metaDados: {
        tokenHash: 'hashvalue',
        role: overrides?.role ?? 'MEMBER',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        usedAt: null,
        status: overrides?.status ?? 'PENDING',
        invitedByUserId: '7',
      },
    });

    /**
     * Configura o mock do Promise.all([org, requesterVinculo, invite]).
     * Como cancelInvite usa findFirst (e nao findMany como create), preparamos
     * dEntidade.findFirst para responder org E dTabela.findFirst para responder invite.
     */
    const setupCancelMocks = (overrides?: {
      org?: object | null;
      requesterVinculo?: object | null;
      invite?: object | null;
    }) => {
      prismaMock.dEntidade.findFirst.mockImplementation(
        (args: { where: Record<string, unknown> }) => {
          if (args.where.idClasse === BigInt(-152)) {
            return Promise.resolve(
              overrides?.org === null
                ? null
                : (overrides?.org ?? { chave: BigInt(100), nome: 'Acme' }),
            );
          }
          return Promise.resolve(null);
        },
      );
      prismaMock.dVincula.findFirst.mockResolvedValue(
        overrides?.requesterVinculo === null
          ? null
          : (overrides?.requesterVinculo ?? { chave: BigInt(999) }),
      );
      prismaMock.dTabela.findFirst.mockResolvedValue(
        overrides?.invite === null ? null : (overrides?.invite ?? buildInviteRow()),
      );
      prismaMock.dTabela.delete.mockReset();
      prismaMock.dTabela.delete.mockResolvedValue({ chave: BigInt(789) });
    };

    it('cancela invite PENDING com sucesso, emite evento ANTES do delete e retorna 200', async () => {
      setupCancelMocks();

      // Captura ordem das chamadas para garantir que evento e emitido ANTES do delete.
      const callOrder: string[] = [];
      eventMock.addInternalEvent.mockImplementation(async () => {
        callOrder.push('event');
      });
      prismaMock.dTabela.delete.mockImplementation(async () => {
        callOrder.push('delete');
        return { chave: BigInt(789) };
      });

      const result = await service.cancelInvite('100', '789', BigInt(7));

      expect(result.id).toBe('789');
      expect(result.revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // Ordem critica: evento emitido ANTES do delete (Risco #1 do plano).
      expect(callOrder).toEqual(['event', 'delete']);

      expect(eventMock.addInternalEvent).toHaveBeenCalledWith(
        'invite.revoked',
        expect.objectContaining({
          inviteId: '789',
          orgId: '100',
          orgName: 'Acme',
          email: 'pendente@x.com',
          role: 'MEMBER',
          actorUserId: '7',
          originalInviterUserId: '7',
          previousStatus: 'PENDING',
        }),
        'corr-1',
        expect.anything(),
      );
      expect(prismaMock.dTabela.delete).toHaveBeenCalledWith({
        where: { chave: BigInt(789) },
      });
    });

    it('rejeita com ForbiddenException se caller nao e ADMIN', async () => {
      setupCancelMocks({ requesterVinculo: null });

      await expect(service.cancelInvite('100', '789', BigInt(7))).rejects.toThrow(
        ForbiddenException,
      );
      expect(eventMock.addInternalEvent).not.toHaveBeenCalled();
      expect(prismaMock.dTabela.delete).not.toHaveBeenCalled();
    });

    it('rejeita com NotFoundException se org nao existe', async () => {
      setupCancelMocks({ org: null });

      await expect(service.cancelInvite('100', '789', BigInt(7))).rejects.toThrow(
        NotFoundException,
      );
      expect(eventMock.addInternalEvent).not.toHaveBeenCalled();
    });

    it('rejeita com NotFoundException se invite nao existe (mesma mensagem que outra org)', async () => {
      setupCancelMocks({ invite: null });

      await expect(service.cancelInvite('100', '789', BigInt(7))).rejects.toThrow(
        NotFoundException,
      );
      expect(eventMock.addInternalEvent).not.toHaveBeenCalled();
      expect(prismaMock.dTabela.delete).not.toHaveBeenCalled();
    });

    it('rejeita com NotFoundException se invite pertence a outra org (cross-tenant isolation)', async () => {
      // Tenant-isolation: a query do invite ja filtra por idLocEscrituracao,
      // entao um invite de outra org retorna null no findFirst — mesmo caminho
      // do "inexistente". Aqui validamos que a query inclui o filtro correto.
      setupCancelMocks({ invite: null });

      await expect(service.cancelInvite('100', '789', BigInt(7))).rejects.toThrow(
        NotFoundException,
      );
      // Garante que tenant-isolation foi aplicado na query do invite.
      expect(prismaMock.dTabela.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            chave: BigInt(789),
            idClasse: BigInt(-476),
            idLocEscrituracao: BigInt(100), // tenant-isolation (Risco #4)
            excluido: false,
          }),
        }),
      );
    });

    it('rejeita com ConflictException se invite ja foi ACCEPTED', async () => {
      setupCancelMocks({ invite: buildInviteRow({ status: 'ACCEPTED' }) });

      await expect(service.cancelInvite('100', '789', BigInt(7))).rejects.toThrow(
        ConflictException,
      );
      expect(eventMock.addInternalEvent).not.toHaveBeenCalled();
      expect(prismaMock.dTabela.delete).not.toHaveBeenCalled();
    });

    it('idempotente para status EXPIRED: cancela com previousStatus="EXPIRED"', async () => {
      setupCancelMocks({ invite: buildInviteRow({ status: 'EXPIRED' }) });

      const result = await service.cancelInvite('100', '789', BigInt(7));

      expect(result.id).toBe('789');
      expect(eventMock.addInternalEvent).toHaveBeenCalledWith(
        'invite.revoked',
        expect.objectContaining({ previousStatus: 'EXPIRED' }),
        'corr-1',
        expect.anything(),
      );
      expect(prismaMock.dTabela.delete).toHaveBeenCalledWith({
        where: { chave: BigInt(789) },
      });
    });

    it('trata Prisma P2025 (race: ja deletado por outro request) como sucesso idempotente', async () => {
      setupCancelMocks();

      const p2025 = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: 'test',
      });
      prismaMock.dTabela.delete.mockReset();
      prismaMock.dTabela.delete.mockRejectedValue(p2025);

      const result = await service.cancelInvite('100', '789', BigInt(7));

      // Evento foi emitido + delete falhou com P2025 → retorna sucesso.
      expect(result.id).toBe('789');
      expect(result.revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(eventMock.addInternalEvent).toHaveBeenCalled();
    });

    it('rejeita com BadRequestException se orgId/inviteId nao sao BigInt validos', async () => {
      // Nenhum mock de Prisma deve ser chamado — falha no parse.
      await expect(service.cancelInvite('not-a-bigint', '789', BigInt(7))).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaMock.dEntidade.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('listPendingInvitesForEmail (Etapa 4 orphan-workspace)', () => {
    /**
     * Helper que monta um DTabela INVITE_TOKEN com defaults seguros.
     * Customizavel via overrides — usado pelos cenarios abaixo.
     */
    const buildInviteRow = (overrides?: {
      chave?: bigint;
      orgId?: bigint;
      email?: string;
      status?: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
      role?: 'MEMBER' | 'VIEWER';
      usedAt?: string | null;
      expiresAtOffsetMs?: number; // default: +1 dia
      flow?: 'new_user' | 'existing_user';
      targetUserId?: string;
    }) => ({
      chave: overrides?.chave ?? BigInt(42),
      idClasse: BigInt(-476),
      nome: overrides?.email ?? 'user@x.com',
      idLocEscrituracao: overrides?.orgId ?? BigInt(100),
      criadoEm: new Date('2026-05-10T12:00:00.000Z'),
      metaDados: {
        tokenHash: 'SUPER-SECRET-HASH-NEVER-EXPOSE',
        role: overrides?.role ?? 'MEMBER',
        expiresAt: new Date(
          Date.now() + (overrides?.expiresAtOffsetMs ?? 86_400_000),
        ).toISOString(),
        usedAt: overrides?.usedAt ?? null,
        status: overrides?.status ?? 'PENDING',
        invitedByUserId: '7',
        flow: overrides?.flow ?? 'new_user',
        targetUserId: overrides?.targetUserId,
      },
    });

    /**
     * Setup dos mocks: dTabela.findMany retorna os candidatos por email;
     * dEntidade.findMany retorna as orgs ativas (batch lookup do orgName).
     */
    const setupMocks = (
      invites: ReturnType<typeof buildInviteRow>[],
      orgs?: { chave: bigint; nome: string }[],
    ) => {
      prismaMock.dTabela.findMany.mockReset();
      prismaMock.dTabela.findMany.mockResolvedValue(invites);
      prismaMock.dEntidade.findFirst.mockReset();
      // dEntidade.findMany não existia no mock — precisamos adicionar.
      // Como o service usa findMany para batch lookup das orgs, precisamos
      // mocká-lo. O mock atual de dEntidade só tem findFirst — adicionamos
      // findMany on-demand neste describe.
      (prismaMock.dEntidade as unknown as { findMany?: jest.Mock }).findMany = jest
        .fn()
        .mockResolvedValue(orgs ?? [{ chave: BigInt(100), nome: 'Acme Corp' }]);
    };

    it('retorna apenas convites PENDING + nao-expirados (caminho feliz)', async () => {
      setupMocks([buildInviteRow()]);

      const result = await service.listPendingInvitesForEmail('user@x.com');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        inviteId: '42',
        orgId: '100',
        orgName: 'Acme Corp',
        role: 'MEMBER',
        expiresAt: expect.any(String),
      });
    });

    it('FILTRA convites EXPIRED (status === "EXPIRED")', async () => {
      setupMocks([buildInviteRow({ status: 'EXPIRED' })]);
      const result = await service.listPendingInvitesForEmail('user@x.com');
      expect(result).toEqual([]);
    });

    it('FILTRA convites com expiresAt no passado (validacao temporal)', async () => {
      // Mesmo com status PENDING, se a data ja passou, deve ser filtrado.
      setupMocks([buildInviteRow({ status: 'PENDING', expiresAtOffsetMs: -1000 })]);
      const result = await service.listPendingInvitesForEmail('user@x.com');
      expect(result).toEqual([]);
    });

    it('FILTRA convites ACCEPTED (usedAt preenchido)', async () => {
      setupMocks([buildInviteRow({ status: 'ACCEPTED', usedAt: '2026-05-12T10:00:00.000Z' })]);
      const result = await service.listPendingInvitesForEmail('user@x.com');
      expect(result).toEqual([]);
    });

    it('FILTRA convites REVOKED', async () => {
      setupMocks([buildInviteRow({ status: 'REVOKED' })]);
      const result = await service.listPendingInvitesForEmail('user@x.com');
      expect(result).toEqual([]);
    });

    it('FILTRA convites cuja org foi soft-deleted (ou nao existe mais)', async () => {
      // Invite valido (PENDING + nao-expirado), MAS dEntidade.findMany retorna
      // [] (org soft-deleted). Service deve skipar — anti-leak (user nao deve
      // ver convite para org que nao existe mais).
      setupMocks([buildInviteRow()], []);
      const result = await service.listPendingInvitesForEmail('user@x.com');
      expect(result).toEqual([]);
    });

    it('normaliza email para lowercase antes da query (case-insensitive)', async () => {
      setupMocks([buildInviteRow()]);

      await service.listPendingInvitesForEmail('USER@X.COM');

      expect(prismaMock.dTabela.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            idClasse: BigInt(-476),
            nome: 'user@x.com', // <-- lowercase
            excluido: false,
          }),
        }),
      );
    });

    it('NAO expoe tokenHash, flow, targetUserId, invitedByUserId, email (resposta sanitizada)', async () => {
      setupMocks([
        buildInviteRow({
          flow: 'existing_user',
          targetUserId: '999',
        }),
      ]);

      const result = await service.listPendingInvitesForEmail('user@x.com');

      expect(result).toHaveLength(1);
      const invite = result[0] as unknown as Record<string, unknown>;

      // Whitelist: apenas estes 5 campos podem aparecer.
      expect(Object.keys(invite).sort()).toEqual(
        ['expiresAt', 'inviteId', 'orgId', 'orgName', 'role'].sort(),
      );

      // Defesa explicita contra leak de campos sensiveis.
      expect(invite.tokenHash).toBeUndefined();
      expect(invite.flow).toBeUndefined();
      expect(invite.targetUserId).toBeUndefined();
      expect(invite.invitedByUserId).toBeUndefined();
      expect(invite.email).toBeUndefined();
      expect(invite.usedAt).toBeUndefined();
      expect(invite.status).toBeUndefined();
    });

    it('retorna [] quando nenhum convite encontrado (early return — nao chama dEntidade.findMany)', async () => {
      prismaMock.dTabela.findMany.mockReset();
      prismaMock.dTabela.findMany.mockResolvedValue([]);
      const findManyOrgs = jest.fn();
      (prismaMock.dEntidade as unknown as { findMany?: jest.Mock }).findMany = findManyOrgs;

      const result = await service.listPendingInvitesForEmail('vazio@x.com');

      expect(result).toEqual([]);
      // Early return — nao deve chamar a segunda query.
      expect(findManyOrgs).not.toHaveBeenCalled();
    });

    it('batch lookup: 1 query unica de orgs com IN (...) mesmo com varios convites', async () => {
      setupMocks(
        [
          buildInviteRow({ chave: BigInt(1), orgId: BigInt(100) }),
          buildInviteRow({ chave: BigInt(2), orgId: BigInt(200) }),
          buildInviteRow({ chave: BigInt(3), orgId: BigInt(100) }), // duplicada — dedupe
        ],
        [
          { chave: BigInt(100), nome: 'Acme' },
          { chave: BigInt(200), nome: 'Beta' },
        ],
      );

      const result = await service.listPendingInvitesForEmail('user@x.com');

      expect(result).toHaveLength(3);
      // ZERO N+1: apenas 1 chamada a dEntidade.findMany (batch IN).
      const findManyOrgs = (prismaMock.dEntidade as unknown as { findMany: jest.Mock }).findMany;
      expect(findManyOrgs).toHaveBeenCalledTimes(1);
      expect(findManyOrgs).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            chave: { in: expect.arrayContaining([BigInt(100), BigInt(200)]) },
            idClasse: BigInt(-152),
            excluido: false,
          }),
        }),
      );
    });
  });
});
