import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma.service';
import { RoleResolverService } from '../../../auth/services/role-resolver.service';
import { AgentKeyService } from '../agent-key.service';
import { AgentInstallTokenService } from '../agent-install-token.service';

describe('AgentInstallTokenService', () => {
  let service: AgentInstallTokenService;
  let agentKeyService: { generateSecret: jest.Mock; hashSecret: jest.Mock };

  beforeEach(() => {
    agentKeyService = {
      generateSecret: jest.fn().mockReturnValue('plain-token'),
      hashSecret: jest.fn().mockReturnValue('h'.repeat(64)),
    };
    service = new AgentInstallTokenService(
      {} as PrismaService,
      { get: jest.fn((_key: string, fallback?: string) => fallback ?? '10') } as unknown as ConfigService,
      {} as RoleResolverService,
      agentKeyService as unknown as AgentKeyService,
    );
  });

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

    const result = await service.consumeInstallToken(tx as any, 'plain-token');

    expect(result).toEqual({
      tokenId: BigInt(10),
      projectId: BigInt(3),
      createdBy: BigInt(2),
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

    await expect(service.consumeInstallToken(tx as any, 'plain-token')).rejects.toBeInstanceOf(
      ConflictException,
    );
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

    await expect(service.consumeInstallToken(tx as any, 'plain-token')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.dTabela.update).not.toHaveBeenCalled();
  });
});
