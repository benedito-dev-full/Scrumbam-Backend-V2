import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

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
    dTabela: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
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
    it('aceita convite valido, cria usuario e auto-login', async () => {
      const raw = 'valid-token';
      const hash = createHash('sha256').update(raw).digest('hex');
      const future = new Date(Date.now() + 60_000).toISOString();

      const txClient = {
        dEntidade: { findFirst: jest.fn(), create: jest.fn() },
        dUserGroup: { create: jest.fn() },
        dVincula: { create: jest.fn() },
        dTabela: { findMany: jest.fn(), update: jest.fn() },
      };
      txClient.dTabela.findMany.mockResolvedValue([
        {
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
          },
        },
      ]);
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
      expect(authMock.issueSessionForUser).toHaveBeenCalledWith(BigInt(900));
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
        expect.objectContaining({ inviteId: '555', newUserId: '901', role: 'MEMBER' }),
        'corr-1',
        expect.anything(),
      );
    });

    it('rejeita com NotFoundException para token invalido', async () => {
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

    it('rejeita com ConflictException se email virou user entre GET e POST (race)', async () => {
      const raw = 'race-token';
      const hash = createHash('sha256').update(raw).digest('hex');
      const future = new Date(Date.now() + 60_000).toISOString();
      const txClient = {
        dEntidade: { findFirst: jest.fn(), create: jest.fn() },
        dUserGroup: { create: jest.fn() },
        dVincula: { create: jest.fn() },
        dTabela: {
          findMany: jest.fn().mockResolvedValue([
            {
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
              },
            },
          ]),
          update: jest.fn(),
        },
      };
      // user JA existe (race)
      txClient.dEntidade.findFirst.mockImplementation(
        (args: { where: Record<string, unknown> }) => {
          if (args.where.idClasse === BigInt(-150)) {
            return Promise.resolve({ chave: BigInt(42) });
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
});
