import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { EventProducerService } from '../../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../../common/services/correlation-id.service';
import { RoleResolverService } from '../../../auth/services/role-resolver.service';
import { RemoteExecutionClient } from '../../runtime/remote-execution-client';
import { DeployKeyService } from '../deploy-key.service';

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
}): DeployKeyService {
  return new DeployKeyService(
    deps.prisma as unknown as PrismaService,
    deps.remoteClient as unknown as RemoteExecutionClient,
    deps.eventProducer as unknown as EventProducerService,
    {
      getOrGenerate: jest.fn().mockReturnValue('corr-deploy-key'),
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
const PUBLIC_KEY = 'ssh-ed25519 AAAAC3Nz... scrumban-agent@dinpayz-backend';
const FINGERPRINT = 'SHA256:abcd1234deadbeef';

function baseLink(metaOverrides: Record<string, unknown> = {}) {
  return {
    chave: LINK_ID,
    metaDados: {
      projectSlug: PROJECT_SLUG,
      repoUrl: 'git@github.com:org/repo.git',
      defaultBranch: 'main',
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

describe('DeployKeyService.generateDeployKey', () => {
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
      service.generateDeployKey(PROJECT_ID, AGENT_ID, undefined, USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403 quando usuario nao e MANAGER do projeto nem ADMIN da org', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });

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
      service.generateDeployKey(PROJECT_ID, AGENT_ID, undefined, USER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 quando vinculo project-agent nao encontrado', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue(null);

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
      service.generateDeployKey(PROJECT_ID, AGENT_ID, undefined, USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('Conflict quando vinculo sem projectSlug em metaDados', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue({
      chave: LINK_ID,
      metaDados: { repoUrl: 'git@github.com:org/repo.git' },
    });

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
      service.generateDeployKey(PROJECT_ID, AGENT_ID, undefined, USER_ID),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('ServiceUnavailable quando agent dados sem tunnelPort', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue(baseLink());
    prisma.dEntidade.findFirst.mockResolvedValue({
      chave: AGENT_ID,
      dados: { agentCommandSecretEncrypted: 'encrypted-secret' },
    });

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
      service.generateDeployKey(PROJECT_ID, AGENT_ID, undefined, USER_ID),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('ServiceUnavailable quando ack do agent invalido (sem publicKey)', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue(baseLink());
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());

    const dispatch = jest.fn().mockResolvedValue({ accepted: true, fingerprint: FINGERPRINT });

    const service = buildService({
      prisma,
      remoteClient: { dispatch },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    await expect(
      service.generateDeployKey(PROJECT_ID, AGENT_ID, undefined, USER_ID),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('dispatch GENERATE_DEPLOY_KEY + persiste metaDados + emite evento APOS persistencia (preservando campos existentes)', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue(
      baseLink({ repoUrl: 'git@github.com:org/repo.git', defaultBranch: 'develop' }),
    );
    prisma.dVincula.update.mockResolvedValue({});
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());

    const dispatch = jest.fn().mockResolvedValue({
      accepted: true,
      publicKey: PUBLIC_KEY,
      fingerprint: FINGERPRINT,
      alreadyExisted: false,
    });
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

    const result = await service.generateDeployKey(PROJECT_ID, AGENT_ID, undefined, USER_ID);

    expect(dispatch).toHaveBeenCalledWith(
      'GENERATE_DEPLOY_KEY',
      { projectSlug: PROJECT_SLUG, comment: `scrumban-agent@${PROJECT_SLUG}` },
      expect.objectContaining({
        agent: expect.objectContaining({
          agentId: AGENT_ID.toString(),
          tunnelPort: TUNNEL_PORT,
          agentCommandSecretEncrypted: 'encrypted-secret',
        }),
        correlationId: 'corr-deploy-key',
      }),
    );

    const updateCall = prisma.dVincula.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ chave: LINK_ID });
    expect(updateCall.data.metaDados).toEqual(
      expect.objectContaining({
        projectSlug: PROJECT_SLUG,
        repoUrl: 'git@github.com:org/repo.git',
        defaultBranch: 'develop',
        deployKeyPub: PUBLIC_KEY,
        deployKeyFingerprint: FINGERPRINT,
        lastDeployKeyGeneratedAt: expect.any(String),
      }),
    );

    expect(callOrder).toEqual(['update', 'event']);
    expect(addInternalEvent).toHaveBeenCalledWith(
      'project.deploy-key.generated',
      expect.objectContaining({
        projectId: PROJECT_ID.toString(),
        agentId: AGENT_ID.toString(),
        userId: USER_ID.toString(),
        projectSlug: PROJECT_SLUG,
        fingerprint: FINGERPRINT,
        alreadyExisted: false,
      }),
      'corr-deploy-key',
      expect.objectContaining({ source: 'DeployKeyService' }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        publicKey: PUBLIC_KEY,
        fingerprint: FINGERPRINT,
        alreadyExisted: false,
        sshConfigSnippet: expect.stringContaining(`Host github.com-${PROJECT_SLUG}`),
        instructions: expect.arrayContaining([expect.stringContaining('Add deploy key')]),
      }),
    );
  });

  it('comment customizado prevalece sobre o derivado de projectSlug', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue(baseLink());
    prisma.dVincula.update.mockResolvedValue({});
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());

    const dispatch = jest.fn().mockResolvedValue({
      accepted: true,
      publicKey: PUBLIC_KEY,
      fingerprint: FINGERPRINT,
      alreadyExisted: false,
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

    await service.generateDeployKey(PROJECT_ID, AGENT_ID, 'custom-comment@host', USER_ID);

    expect(dispatch).toHaveBeenCalledWith(
      'GENERATE_DEPLOY_KEY',
      { projectSlug: PROJECT_SLUG, comment: 'custom-comment@host' },
      expect.anything(),
    );
  });

  it('idempotencia: alreadyExisted=true do agent reflete na resposta sem regerar', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue(baseLink());
    prisma.dVincula.update.mockResolvedValue({});
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());

    const dispatch = jest.fn().mockResolvedValue({
      accepted: true,
      publicKey: PUBLIC_KEY,
      fingerprint: FINGERPRINT,
      alreadyExisted: true,
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

    const result = await service.generateDeployKey(PROJECT_ID, AGENT_ID, undefined, USER_ID);

    expect(result.alreadyExisted).toBe(true);
  });

  it('autoriza via ADMIN da org quando user nao e MANAGER do projeto', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue(baseLink());
    prisma.dVincula.update.mockResolvedValue({});
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());

    const dispatch = jest.fn().mockResolvedValue({
      accepted: true,
      publicKey: PUBLIC_KEY,
      fingerprint: FINGERPRINT,
      alreadyExisted: false,
    });

    const service = buildService({
      prisma,
      remoteClient: { dispatch },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue(null),
        getOrgRole: jest.fn().mockResolvedValue('ADMIN'),
      },
    });

    await expect(
      service.generateDeployKey(PROJECT_ID, AGENT_ID, undefined, USER_ID),
    ).resolves.toBeDefined();
  });
});

describe('DeployKeyService.getDeployKey', () => {
  it('403 quando usuario nao e membro do projeto nem ADMIN da org', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue(null),
        getOrgRole: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(service.getDeployKey(PROJECT_ID, AGENT_ID, USER_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404 quando metaDados sem deploy key persistida (nunca gerada)', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue({
      chave: LINK_ID,
      metaDados: { projectSlug: PROJECT_SLUG },
    });

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MEMBER'),
        getOrgRole: jest.fn(),
      },
    });

    await expect(service.getDeployKey(PROJECT_ID, AGENT_ID, USER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('happy path: retorna metaDados persistido SEM outbound', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue(
      baseLink({
        deployKeyPub: PUBLIC_KEY,
        deployKeyFingerprint: FINGERPRINT,
        lastDeployKeyGeneratedAt: '2026-05-13T18:50:00.000Z',
      }),
    );

    const dispatch = jest.fn();
    const service = buildService({
      prisma,
      remoteClient: { dispatch },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('VIEWER'),
        getOrgRole: jest.fn(),
      },
    });

    const result = await service.getDeployKey(PROJECT_ID, AGENT_ID, USER_ID);

    expect(dispatch).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        publicKey: PUBLIC_KEY,
        fingerprint: FINGERPRINT,
        generatedAt: '2026-05-13T18:50:00.000Z',
        alreadyExisted: true,
      }),
    );
  });
});

describe('DeployKeyService.revokeDeployKey', () => {
  it('403 quando usuario nao e MANAGER projeto nem ADMIN org', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MEMBER'),
        getOrgRole: jest.fn().mockResolvedValue('MEMBER'),
      },
    });

    await expect(service.revokeDeployKey(PROJECT_ID, AGENT_ID, USER_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404 quando vinculo nao encontrado', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue(null);

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    await expect(service.revokeDeployKey(PROJECT_ID, AGENT_ID, USER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('apaga 3 campos da deploy key + grava revokedAt + preserva projectSlug/repoUrl + emite evento APOS persistencia', async () => {
    const prisma = buildPrismaMock();
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue(
      baseLink({
        deployKeyPub: PUBLIC_KEY,
        deployKeyFingerprint: FINGERPRINT,
        lastDeployKeyGeneratedAt: '2026-05-13T18:50:00.000Z',
      }),
    );
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
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    const result = await service.revokeDeployKey(PROJECT_ID, AGENT_ID, USER_ID);

    const updateCall = prisma.dVincula.update.mock.calls[0][0];
    const meta = updateCall.data.metaDados as Record<string, unknown>;
    expect(meta.deployKeyPub).toBeUndefined();
    expect(meta.deployKeyFingerprint).toBeUndefined();
    expect(meta.lastDeployKeyGeneratedAt).toBeUndefined();
    expect(meta.deployKeyRevokedAt).toEqual(expect.any(String));
    expect(meta.projectSlug).toBe(PROJECT_SLUG);
    expect(meta.repoUrl).toBe('git@github.com:org/repo.git');

    expect(callOrder).toEqual(['update', 'event']);
    expect(addInternalEvent).toHaveBeenCalledWith(
      'project.deploy-key.revoked',
      expect.objectContaining({
        projectId: PROJECT_ID.toString(),
        agentId: AGENT_ID.toString(),
        userId: USER_ID.toString(),
      }),
      'corr-deploy-key',
      expect.objectContaining({ source: 'DeployKeyService' }),
    );

    expect(result).toEqual({ revoked: true, revokedAt: expect.any(String) });
  });
});
