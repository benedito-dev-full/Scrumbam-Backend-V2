import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { RoleResolverService } from '../../../auth/services/role-resolver.service';
import { AUTOMATION_CLASS_IDS } from '../../constants/automation-class-ids';
import { AgentTunnelService } from '../../agents/agent-tunnel.service';
import { ProjectAgentLinkService } from '../project-agent-link.service';

function buildService(overrides?: {
  projectRole?: 'MANAGER' | 'MEMBER' | 'VIEWER' | null;
  orgRole?: 'ADMIN' | 'MEMBER' | 'VIEWER' | null;
  tx?: Record<string, unknown>;
  prisma?: Record<string, unknown>;
  probe?: jest.Mock;
}) {
  const tx = overrides?.tx ?? {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([]),
    dEntidade: {
      findFirst: jest.fn().mockResolvedValue({ chave: BigInt(900) }),
    },
    dProject: {
      findUnique: jest.fn().mockResolvedValue({ nome: 'Dinpayz Backend' }),
    },
    dVincula: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        chave: BigInt(1000),
        idEntidade: BigInt(900),
        tipo: 'primary',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    dProject: {
      findFirst: jest.fn().mockResolvedValue({ chave: BigInt(20), idEstab: BigInt(10) }),
    },
    dVincula: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides?.prisma,
  } as unknown as PrismaService;

  const roleResolver = {
    getProjectRole: jest.fn().mockResolvedValue(overrides?.projectRole ?? 'MANAGER'),
    getOrgRole: jest.fn().mockResolvedValue(overrides?.orgRole ?? null),
  } as unknown as RoleResolverService;

  const agentTunnelService = {
    probe:
      overrides?.probe ??
      jest.fn().mockResolvedValue({
        tunnelOk: true,
        host: '127.0.0.1',
        port: 20000,
        latencyMs: 5,
      }),
  } as unknown as AgentTunnelService;

  return {
    service: new ProjectAgentLinkService(prisma, roleResolver, agentTunnelService),
    prisma,
    roleResolver,
    agentTunnelService,
    tx,
  };
}

describe('ProjectAgentLinkService', () => {
  it('garante primary unico sob lock transacional ao vincular primary', async () => {
    const { service, tx } = buildService();

    const result = await service.linkAgent(BigInt(20), BigInt(900), 'primary', BigInt(42));

    expect(result).toEqual({
      projectId: '20',
      agentId: '900',
      tipo: 'primary',
      linkId: '1000',
    });
    const txMocks = tx as unknown as {
      $executeRaw: jest.Mock;
      dVincula: { updateMany: jest.Mock; create: jest.Mock };
    };
    expect(txMocks.$executeRaw).toHaveBeenCalled();
    expect(txMocks.dVincula.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT,
          idLocEscritu: BigInt(20),
          idEntidade: { not: BigInt(900) },
          tipo: 'primary',
          excluido: false,
        }),
        data: { tipo: 'secondary' },
      }),
    );
  });

  it('permite multiplos secondary sem demover primary existente', async () => {
    const { service, tx } = buildService();

    await service.linkAgent(BigInt(20), BigInt(900), 'secondary', BigInt(42));

    const txMocks = tx as unknown as {
      dVincula: { updateMany: jest.Mock; create: jest.Mock };
    };
    expect(txMocks.dVincula.updateMany).not.toHaveBeenCalled();
    expect(txMocks.dVincula.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipo: 'secondary',
          idLocEscritu: BigInt(20),
          idEntidade: BigInt(900),
        }),
      }),
    );
  });

  it('bloqueia unlink quando existe execution ativa para project/agent', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ chave: BigInt(777) }]),
      dVincula: {
        findFirst: jest.fn().mockResolvedValue({ chave: BigInt(1000) }),
        update: jest.fn(),
      },
    };
    const { service } = buildService({ tx });

    await expect(service.unlinkAgent(BigInt(20), BigInt(900), BigInt(42))).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.dVincula.update).not.toHaveBeenCalled();
  });

  it('combina vinculo, dados do agent e probe no status sem N+1 de agent', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        chave: BigInt(1000),
        tipo: 'primary',
        entidade: {
          chave: BigInt(900),
          nome: 'vps-01',
          dados: {
            statusCode: AUTOMATION_CLASS_IDS.AGENT_STATUS_ONLINE.toString(),
            lastSeen: '2026-05-11T10:00:00.000Z',
            agentVersion: '1.0.0',
            claudeVersion: '2.0.0',
            tunnelPort: 20000,
          },
        },
      },
    ]);
    const probe = jest.fn().mockResolvedValue({
      tunnelOk: true,
      host: '127.0.0.1',
      port: 20000,
      latencyMs: 4,
    });
    const { service } = buildService({
      prisma: {
        dVincula: { findMany },
      },
      probe,
    });

    const result = await service.getStatus(BigInt(20), BigInt(42));

    expect(result.agents).toEqual([
      expect.objectContaining({
        linkId: '1000',
        agentId: '900',
        tipo: 'primary',
        statusCode: '-510',
        lastSeen: '2026-05-11T10:00:00.000Z',
        version: '1.0.0',
        claudeVersion: '2.0.0',
        tunnelPort: 20000,
        tunnelOk: true,
        tunnelLatencyMs: 4,
      }),
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          entidade: expect.objectContaining({
            select: expect.objectContaining({ dados: true }),
          }),
        }),
      }),
    );
    expect(probe).toHaveBeenCalledWith(20000);
  });
});
