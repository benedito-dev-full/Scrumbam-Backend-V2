import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { RoleResolverService } from '../../../auth/services/role-resolver.service';
import { AgentKeyService } from '../agent-key.service';
import { AgentInstallTokenService } from '../agent-install-token.service';

describe('AgentInstallTokenService', () => {
  let service: AgentInstallTokenService;
  let agentKeyService: { generateSecret: jest.Mock; hashSecret: jest.Mock };
  let roleResolver: { getProjectRole: jest.Mock; getOrgRole: jest.Mock };
  let prisma: { dTabela: { create: jest.Mock }; dProject: { findFirst: jest.Mock } };

  beforeEach(() => {
    agentKeyService = {
      generateSecret: jest.fn().mockReturnValue('plain-token'),
      hashSecret: jest.fn().mockReturnValue('h'.repeat(64)),
    };
    roleResolver = {
      getProjectRole: jest.fn(),
      getOrgRole: jest.fn(),
    };
    prisma = {
      dTabela: {
        create: jest.fn().mockResolvedValue({ chave: BigInt(99) }),
      },
      dProject: {
        findFirst: jest.fn(),
      },
    };
    service = new AgentInstallTokenService(
      prisma as unknown as PrismaService,
      {
        get: jest.fn((_key: string, fallback?: string) => fallback ?? '10'),
      } as unknown as ConfigService,
      roleResolver as unknown as RoleResolverService,
      agentKeyService as unknown as AgentKeyService,
    );
  });

  describe('createInstallToken', () => {
    it('cria token COM projectId valida RBAC e persiste idLocEscrituracao', async () => {
      prisma.dProject.findFirst.mockResolvedValue({
        chave: BigInt(7),
        idEstab: BigInt(100),
      });
      roleResolver.getProjectRole.mockResolvedValue('MANAGER');

      const result = await service.createInstallToken(BigInt(7), BigInt(2));

      expect(result.token).toBe('plain-token');
      expect(result.installTokenId).toBe(BigInt(99));
      expect(roleResolver.getProjectRole).toHaveBeenCalledWith(BigInt(2), BigInt(7));
      expect(prisma.dTabela.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idLocEscrituracao: BigInt(7),
            dEntidadeId: BigInt(2),
            dados: expect.objectContaining({
              projectId: '7',
              createdBy: '2',
              used: false,
            }),
          }),
        }),
      );
    });

    it('cria token SEM projectId (standalone) PULA RBAC e persiste idLocEscrituracao=null', async () => {
      const result = await service.createInstallToken(null, BigInt(2));

      expect(result.token).toBe('plain-token');
      expect(result.installTokenId).toBe(BigInt(99));
      expect(roleResolver.getProjectRole).not.toHaveBeenCalled();
      expect(roleResolver.getOrgRole).not.toHaveBeenCalled();
      expect(prisma.dProject.findFirst).not.toHaveBeenCalled();
      expect(prisma.dTabela.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idLocEscrituracao: null,
            dEntidadeId: BigInt(2),
            dados: expect.objectContaining({
              projectId: null,
              createdBy: '2',
              used: false,
            }),
          }),
        }),
      );
    });
  });

  describe('consumeInstallToken', () => {
    it('consome token uma unica vez e marca used=true', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            chave: BigInt(10),
            dEntidadeId: BigInt(2),
            idLocEscrituracao: BigInt(3),
            dados: { expiresAt: new Date(Date.now() + 60_000).toISOString(), used: false },
          },
        ]),
        dTabela: { update: jest.fn().mockResolvedValue({}) },
      };

      const result = await service.consumeInstallToken(
        tx as unknown as Prisma.TransactionClient,
        'plain-token',
      );

      expect(result).toEqual({
        tokenId: BigInt(10),
        projectId: BigInt(3),
        createdBy: BigInt(2),
        organizationId: null,
      });
      expect(tx.dTabela.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chave: BigInt(10) },
          data: expect.objectContaining({
            dados: expect.objectContaining({ used: true }),
          }),
        }),
      );
    });

    it('consome token standalone (idLocEscrituracao=null) e retorna projectId=null', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            chave: BigInt(11),
            dEntidadeId: BigInt(2),
            idLocEscrituracao: null,
            dados: { expiresAt: new Date(Date.now() + 60_000).toISOString(), used: false },
          },
        ]),
        dTabela: { update: jest.fn().mockResolvedValue({}) },
      };

      const result = await service.consumeInstallToken(
        tx as unknown as Prisma.TransactionClient,
        'plain-token',
      );

      expect(result).toEqual({
        tokenId: BigInt(11),
        projectId: null,
        createdBy: BigInt(2),
        organizationId: null,
      });
      expect(tx.dTabela.update).toHaveBeenCalled();
    });

    it('rejeita reutilizacao de token', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            chave: BigInt(10),
            dEntidadeId: BigInt(2),
            idLocEscrituracao: BigInt(3),
            dados: { expiresAt: new Date(Date.now() + 60_000).toISOString(), used: true },
          },
        ]),
        dTabela: { update: jest.fn() },
      };

      await expect(
        service.consumeInstallToken(tx as unknown as Prisma.TransactionClient, 'plain-token'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.dTabela.update).not.toHaveBeenCalled();
    });

    it('rejeita token expirado', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            chave: BigInt(10),
            dEntidadeId: BigInt(2),
            idLocEscrituracao: BigInt(3),
            dados: { expiresAt: new Date(Date.now() - 1_000).toISOString(), used: false },
          },
        ]),
        dTabela: { update: jest.fn() },
      };

      await expect(
        service.consumeInstallToken(tx as unknown as Prisma.TransactionClient, 'plain-token'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.dTabela.update).not.toHaveBeenCalled();
    });

    it('rejeita token sem dEntidadeId (audit createdBy obrigatorio)', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            chave: BigInt(10),
            dEntidadeId: null,
            idLocEscrituracao: BigInt(3),
            dados: { expiresAt: new Date(Date.now() + 60_000).toISOString(), used: false },
          },
        ]),
        dTabela: { update: jest.fn() },
      };

      await expect(
        service.consumeInstallToken(tx as unknown as Prisma.TransactionClient, 'plain-token'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.dTabela.update).not.toHaveBeenCalled();
    });
  });
});
