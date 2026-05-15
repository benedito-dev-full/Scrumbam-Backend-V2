import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { EventProducerService } from '../../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../../common/services/correlation-id.service';
import { RoleResolverService } from '../../../auth/services/role-resolver.service';
import { RemoteExecutionClient } from '../../runtime/remote-execution-client';
import { ProvisionService } from '../provision.service';

interface MockPrisma {
  dEntidade: { findFirst: jest.Mock };
  dProject: { findFirst: jest.Mock };
  dVincula: { findFirst: jest.Mock; update: jest.Mock };
}

function buildPrismaMock(): MockPrisma {
  return {
    dEntidade: { findFirst: jest.fn() },
    dProject: { findFirst: jest.fn() },
    dVincula: { findFirst: jest.fn(), update: jest.fn() },
  };
}

function buildService(deps: {
  prisma: MockPrisma;
  remoteClient: { dispatch: jest.Mock };
  eventProducer: { addInternalEvent: jest.Mock };
  roleResolver: Partial<Record<keyof RoleResolverService, jest.Mock>>;
}): ProvisionService {
  return new ProvisionService(
    deps.prisma as unknown as PrismaService,
    deps.remoteClient as unknown as RemoteExecutionClient,
    deps.eventProducer as unknown as EventProducerService,
    {
      getOrGenerate: jest.fn().mockReturnValue('corr-provision'),
    } as unknown as CorrelationIdService,
    deps.roleResolver as unknown as RoleResolverService,
  );
}

const AGENT_ID = BigInt(900);
const PROJECT_ID = BigInt(20);
const ORG_ID = BigInt(50);
const USER_ID = BigInt(42);
const LINK_ID = BigInt(1000);
const TUNNEL_PORT = 20900;
const PROJECT_SLUG = 'dinpayz-backend';
const REPO_URL = 'git@github.com:org/repo.git';

function baseProject(overrides: Record<string, unknown> = {}) {
  return {
    chave: PROJECT_ID,
    idEstab: ORG_ID,
    repoUrl: REPO_URL,
    dados: {},
    ...overrides,
  };
}

function baseLink(metaOverrides: Record<string, unknown> = {}) {
  return {
    chave: LINK_ID,
    metaDados: {
      projectSlug: PROJECT_SLUG,
      deployKeyPub: 'ssh-ed25519 AAAA',
      ...metaOverrides,
    },
  };
}

function baseAgent(dadosOverrides: Record<string, unknown> = {}) {
  return {
    chave: AGENT_ID,
    dados: {
      tunnelPort: TUNNEL_PORT,
      agentCommandSecretEncrypted: 'encrypted-secret',
      ...dadosOverrides,
    },
  };
}

describe('ProvisionService.provision', () => {
  it('404 quando projeto nao existe', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue(null);

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: { getProjectRole: jest.fn(), getOrgRole: jest.fn() },
    });

    await expect(
      service.provision(PROJECT_ID, AGENT_ID, undefined, USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403 quando usuario nao e MANAGER do projeto nem ADMIN da org', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue(baseProject());

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MEMBER'),
        getOrgRole: jest.fn().mockResolvedValue('MEMBER'),
      },
    });

    await expect(
      service.provision(PROJECT_ID, AGENT_ID, undefined, USER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('400 quando projeto nao tem repoUrl nem dados.gitRepo legado', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue(baseProject({ repoUrl: null, dados: {} }));

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    await expect(
      service.provision(PROJECT_ID, AGENT_ID, undefined, USER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 quando repoUrl do banco falha na whitelist defensiva', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue(
      baseProject({ repoUrl: 'https://evil.example.com/org/repo' }),
    );

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    await expect(
      service.provision(PROJECT_ID, AGENT_ID, undefined, USER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('usa fallback dados.gitRepo quando coluna repoUrl ainda esta null', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue(
      baseProject({ repoUrl: null, dados: { gitRepo: REPO_URL } }),
    );
    prisma.dVincula.findFirst.mockResolvedValue(baseLink());
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());
    prisma.dVincula.update.mockResolvedValue({});

    const dispatch = jest.fn().mockResolvedValue({
      accepted: true,
      alreadyExisted: false,
      projectPath: `/home/dev-benedito/projetos/${PROJECT_SLUG}`,
      currentBranch: 'main',
      headCommitSha: 'a'.repeat(40),
      usedSshKey: true,
    });

    const service = buildService({
      prisma,
      remoteClient: { dispatch },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    await service.provision(PROJECT_ID, AGENT_ID, undefined, USER_ID);

    expect(dispatch).toHaveBeenCalledWith(
      'PROVISION_PROJECT',
      expect.objectContaining({ repoUrl: REPO_URL }),
      expect.anything(),
    );
  });

  it('409 quando vinculo existe sem projectSlug valido', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue(baseProject());
    prisma.dVincula.findFirst.mockResolvedValue(baseLink({ projectSlug: '../escape' }));

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    await expect(
      service.provision(PROJECT_ID, AGENT_ID, undefined, USER_ID),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('ServiceUnavailable quando agent dados sem tunnelPort', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue(baseProject());
    prisma.dVincula.findFirst.mockResolvedValue(baseLink());
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent({ tunnelPort: undefined }));

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    await expect(
      service.provision(PROJECT_ID, AGENT_ID, undefined, USER_ID),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('dispatch PROVISION_PROJECT + persiste metaDados + emite evento APOS persistencia', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue(baseProject());
    prisma.dVincula.findFirst.mockResolvedValue(baseLink({ defaultBranch: 'develop' }));
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());

    const ack = {
      accepted: true,
      alreadyExisted: false,
      projectPath: `/home/dev-benedito/projetos/${PROJECT_SLUG}`,
      currentBranch: 'main',
      headCommitSha: 'b'.repeat(40),
      usedSshKey: true,
    };
    const dispatch = jest.fn().mockResolvedValue(ack);
    const addInternalEvent = jest.fn().mockResolvedValue(undefined);

    const callOrder: string[] = [];
    prisma.dVincula.update.mockImplementation(async () => {
      callOrder.push('update');
      return {};
    });
    addInternalEvent.mockImplementation(async () => {
      callOrder.push('event');
    });

    const service = buildService({
      prisma,
      remoteClient: { dispatch },
      eventProducer: { addInternalEvent },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    const result = await service.provision(PROJECT_ID, AGENT_ID, undefined, USER_ID);

    expect(dispatch).toHaveBeenCalledWith(
      'PROVISION_PROJECT',
      {
        projectSlug: PROJECT_SLUG,
        repoUrl: REPO_URL,
        useSshKey: true,
        baseDir: '/home/dev-benedito/projetos',
        depth: 1,
        timeoutSec: 60,
      },
      expect.objectContaining({
        agent: expect.objectContaining({
          agentId: AGENT_ID.toString(),
          tunnelPort: TUNNEL_PORT,
          agentCommandSecretEncrypted: 'encrypted-secret',
        }),
        correlationId: 'corr-provision',
      }),
    );

    const updateCall = prisma.dVincula.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ chave: LINK_ID });
    expect(updateCall.data.metaDados).toEqual(
      expect.objectContaining({
        projectSlug: PROJECT_SLUG,
        defaultBranch: 'develop',
        repoUrl: REPO_URL,
        lastProvisionedAt: expect.any(String),
        lastProvisionAlreadyExisted: false,
        lastProvisionHeadSha: ack.headCommitSha,
        lastProvisionBranch: 'main',
        lastProvisionProjectPath: ack.projectPath,
        lastProvisionUsedSshKey: true,
      }),
    );

    expect(callOrder).toEqual(['update', 'event']);
    expect(addInternalEvent).toHaveBeenCalledWith(
      'project.provisioned',
      expect.objectContaining({
        projectId: PROJECT_ID.toString(),
        agentId: AGENT_ID.toString(),
        userId: USER_ID.toString(),
        projectSlug: PROJECT_SLUG,
        repoUrl: REPO_URL,
        alreadyExisted: false,
      }),
      'corr-provision',
      expect.objectContaining({ source: 'ProvisionService' }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        projectSlug: PROJECT_SLUG,
        projectPath: ack.projectPath,
        alreadyExisted: false,
        currentBranch: 'main',
        headCommitSha: ack.headCommitSha,
        usedSshKey: true,
      }),
    );
  });

  it('C2: 409 quando useSshKey=true mas metaDados.deployKeyPub esta ausente', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue(baseProject());
    // Vinculo sem deployKeyPub
    prisma.dVincula.findFirst.mockResolvedValue({
      chave: LINK_ID,
      metaDados: { projectSlug: PROJECT_SLUG },
    });
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());

    const dispatch = jest.fn();
    const service = buildService({
      prisma,
      remoteClient: { dispatch },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    // useSshKey=true (default quando undefined)
    await expect(service.provision(PROJECT_ID, AGENT_ID, true, USER_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );

    // Mensagem acionavel deve mencionar deploy key e o endpoint para gera-la
    await expect(service.provision(PROJECT_ID, AGENT_ID, true, USER_ID)).rejects.toThrow(
      /deploy key/i,
    );

    // Nao deve disparar ao agente quando bloqueia pre-dispatch
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('C2: useSshKey=false NAO exige deployKeyPub (segue para dispatch)', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue(baseProject());
    // Vinculo sem deployKeyPub (apenas projectSlug)
    prisma.dVincula.findFirst.mockResolvedValue({
      chave: LINK_ID,
      metaDados: { projectSlug: PROJECT_SLUG },
    });
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());
    prisma.dVincula.update.mockResolvedValue({});

    const dispatch = jest.fn().mockResolvedValue({
      accepted: true,
      alreadyExisted: false,
      projectPath: `/home/dev-benedito/projetos/${PROJECT_SLUG}`,
      currentBranch: 'main',
      headCommitSha: 'd'.repeat(40),
      usedSshKey: false,
    });

    const service = buildService({
      prisma,
      remoteClient: { dispatch },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    await expect(service.provision(PROJECT_ID, AGENT_ID, false, USER_ID)).resolves.toEqual(
      expect.objectContaining({ usedSshKey: false }),
    );

    expect(dispatch).toHaveBeenCalled();
  });

  it('C3: 504 GatewayTimeout quando agente reporta errorCode=CLONE_TIMEOUT', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue(baseProject());
    prisma.dVincula.findFirst.mockResolvedValue(baseLink());
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());

    const dispatch = jest.fn().mockResolvedValue({
      accepted: false,
      errorCode: 'CLONE_TIMEOUT',
      message: 'git clone excedeu 60s',
    });

    const service = buildService({
      prisma,
      remoteClient: { dispatch },
      eventProducer: { addInternalEvent: jest.fn().mockResolvedValue(undefined) },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    await expect(
      service.provision(PROJECT_ID, AGENT_ID, undefined, USER_ID),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('C4: 503 quando headCommitSha do ACK nao bate regex de SHA-1 (40 hex)', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue(baseProject());
    prisma.dVincula.findFirst.mockResolvedValue(baseLink());
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());

    const dispatch = jest.fn().mockResolvedValue({
      accepted: true,
      alreadyExisted: false,
      projectPath: `/home/dev-benedito/projetos/${PROJECT_SLUG}`,
      currentBranch: 'main',
      headCommitSha: 'malformed', // nao bate /^[a-f0-9]{40}$/
      usedSshKey: true,
    });

    const service = buildService({
      prisma,
      remoteClient: { dispatch },
      eventProducer: { addInternalEvent: jest.fn().mockResolvedValue(undefined) },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    await expect(
      service.provision(PROJECT_ID, AGENT_ID, undefined, USER_ID),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    // Garante que NAO persistiu DVincula com lixo no metaDados
    expect(prisma.dVincula.update).not.toHaveBeenCalled();
  });

  it.each([
    ['empty string', ''],
    ['HEAD ref', 'HEAD'],
    ['too short (8 hex)', 'deadbeef'],
  ])(
    'C4: 503 quando headCommitSha=%s nao bate regex de SHA-1 (40 hex)',
    async (_label, invalidSha) => {
      const prisma = buildPrismaMock();
      prisma.dProject.findFirst.mockResolvedValue(baseProject());
      prisma.dVincula.findFirst.mockResolvedValue(baseLink());
      prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());

      const dispatch = jest.fn().mockResolvedValue({
        accepted: true,
        alreadyExisted: false,
        projectPath: `/home/dev-benedito/projetos/${PROJECT_SLUG}`,
        currentBranch: 'main',
        headCommitSha: invalidSha,
        usedSshKey: true,
      });

      const service = buildService({
        prisma,
        remoteClient: { dispatch },
        eventProducer: { addInternalEvent: jest.fn().mockResolvedValue(undefined) },
        roleResolver: {
          getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
          getOrgRole: jest.fn(),
        },
      });

      await expect(
        service.provision(PROJECT_ID, AGENT_ID, undefined, USER_ID),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(prisma.dVincula.update).not.toHaveBeenCalled();
    },
  );

  it('useSshKey=false no body e repassado ao agent', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue(baseProject());
    prisma.dVincula.findFirst.mockResolvedValue(baseLink());
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());
    prisma.dVincula.update.mockResolvedValue({});

    const dispatch = jest.fn().mockResolvedValue({
      accepted: true,
      alreadyExisted: true,
      projectPath: `/home/dev-benedito/projetos/${PROJECT_SLUG}`,
      currentBranch: 'main',
      headCommitSha: 'c'.repeat(40),
      usedSshKey: false,
    });

    const service = buildService({
      prisma,
      remoteClient: { dispatch },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    const result = await service.provision(PROJECT_ID, AGENT_ID, false, USER_ID);

    expect(dispatch.mock.calls[0][1]).toEqual(expect.objectContaining({ useSshKey: false }));
    expect(result.usedSshKey).toBe(false);
  });
});
