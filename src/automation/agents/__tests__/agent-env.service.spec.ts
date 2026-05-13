import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { EventProducerService } from '../../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../../common/services/correlation-id.service';
import { RoleResolverService } from '../../../auth/services/role-resolver.service';
import { RemoteExecutionClient } from '../../runtime/remote-execution-client';
import { AgentEnvService } from '../agent-env.service';

interface MockPrisma {
  dEntidade: { findFirst: jest.Mock; update: jest.Mock };
  dProject: { findFirst: jest.Mock };
}

function buildPrismaMock(): MockPrisma {
  return {
    dEntidade: { findFirst: jest.fn(), update: jest.fn() },
    dProject: { findFirst: jest.fn() },
  };
}

function buildService(deps: {
  prisma: MockPrisma;
  remoteClient: { dispatch: jest.Mock };
  eventProducer: { addInternalEvent: jest.Mock };
  roleResolver: Partial<Record<keyof RoleResolverService, jest.Mock>>;
}): AgentEnvService {
  return new AgentEnvService(
    deps.prisma as unknown as PrismaService,
    deps.remoteClient as unknown as RemoteExecutionClient,
    deps.eventProducer as unknown as EventProducerService,
    {
      getOrGenerate: jest.fn().mockReturnValue('corr-test'),
    } as unknown as CorrelationIdService,
    deps.roleResolver as unknown as RoleResolverService,
  );
}

const AGENT_ID = BigInt(32);
const PROJECT_ID = BigInt(20);
const ORG_ID = BigInt(50);
const USER_ID = BigInt(42);
const TUNNEL_PORT = 20032;

function baseAgent(idLocEscritu: bigint = PROJECT_ID, dados: Record<string, unknown> = {}) {
  return {
    chave: AGENT_ID,
    idLocEscritu,
    dados: {
      tunnelPort: TUNNEL_PORT,
      agentCommandSecretEncrypted: 'encrypted-secret',
      ...dados,
    },
  };
}

describe('AgentEnvService.setEnv', () => {
  it('rejeita DTO vazio com BadRequestException', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    await expect(service.setEnv(AGENT_ID, {}, USER_ID)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 quando agente nao existe', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue(null);

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: { getProjectRole: jest.fn(), getOrgRole: jest.fn() },
    });

    await expect(
      service.setEnv(AGENT_ID, { githubToken: 'ghp_xxx_with_enough_chars' }, USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403 quando usuario nao e MANAGER projeto nem ADMIN org', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue(null),
        getOrgRole: jest.fn().mockResolvedValue('MEMBER'),
      },
    });

    await expect(
      service.setEnv(AGENT_ID, { githubToken: 'ghp_xxx_with_enough_chars' }, USER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('dispatch SET_ENV outbound + persiste envStatus + emite agent.env.updated', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dEntidade.update.mockResolvedValue({});

    const remoteClient = {
      dispatch: jest.fn().mockResolvedValue({
        accepted: true,
        varsWritten: ['GITHUB_TOKEN', 'ANTHROPIC_API_KEY'],
        restartScheduled: true,
      }),
    };
    const eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };

    const service = buildService({
      prisma,
      remoteClient,
      eventProducer,
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    const result = await service.setEnv(
      AGENT_ID,
      {
        githubToken: 'ghp_abcdef1234567890',
        anthropicApiKey: 'sk-ant-api03-xxxxxxxxxxxx',
      },
      USER_ID,
    );

    expect(result.hasGithubToken).toBe(true);
    expect(result.hasAnthropicKey).toBe(true);
    expect(result.lastEnvUpdatedAt).toEqual(expect.any(String));

    // dispatch chamado com SET_ENV + payload correto
    expect(remoteClient.dispatch).toHaveBeenCalledWith(
      'SET_ENV',
      {
        vars: {
          GITHUB_TOKEN: 'ghp_abcdef1234567890',
          ANTHROPIC_API_KEY: 'sk-ant-api03-xxxxxxxxxxxx',
        },
        restartAfter: true,
      },
      expect.objectContaining({
        agent: expect.objectContaining({
          agentId: '32',
          tunnelPort: TUNNEL_PORT,
          agentCommandSecretEncrypted: 'encrypted-secret',
        }),
        correlationId: 'corr-test',
      }),
    );

    // Persiste envStatus em DEntidade.dados
    expect(prisma.dEntidade.update).toHaveBeenCalledWith({
      where: { chave: AGENT_ID },
      data: {
        dados: expect.objectContaining({
          envStatus: expect.objectContaining({
            hasGithubToken: true,
            hasAnthropicKey: true,
            lastEnvUpdatedAt: expect.any(String),
          }),
        }),
      },
    });

    // Evento emitido APOS persistencia
    expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'agent.env.updated',
      expect.objectContaining({
        agentId: '32',
        userId: '42',
        varsKeys: expect.arrayContaining(['GITHUB_TOKEN', 'ANTHROPIC_API_KEY']),
        restartScheduled: true,
      }),
      'corr-test',
      { source: AgentEnvService.name },
    );
  });

  it('NUNCA persiste plaintext em dados (apenas envStatus boolean + timestamp)', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dEntidade.update.mockResolvedValue({});

    const remoteClient = {
      dispatch: jest.fn().mockResolvedValue({ accepted: true, restartScheduled: true }),
    };

    const service = buildService({
      prisma,
      remoteClient,
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    const rawToken = 'ghp_SUPER_SECRET_TOKEN_NEVER_PERSIST';
    await service.setEnv(AGENT_ID, { githubToken: rawToken }, USER_ID);

    // CRITICA: verifica que NENHUM update do prisma contem plaintext do token
    const updateCalls = prisma.dEntidade.update.mock.calls;
    for (const call of updateCalls) {
      const serialized = JSON.stringify(call, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      );
      expect(serialized).not.toContain(rawToken);
    }

    // Tambem verifica payload do dispatch — o token PRECISA estar no outbound
    // (e o que o agente vai escrever), mas NUNCA no update do DB.
    const dispatchCalls = remoteClient.dispatch.mock.calls;
    const dispatchSerialized = JSON.stringify(dispatchCalls);
    expect(dispatchSerialized).toContain(rawToken); // confirma que o token VAI para o agente
  });

  it('idempotencia: setEnv 2x mantem hasGithubToken=true (OR-merge)', async () => {
    const prisma = buildPrismaMock();
    // Primeiro setEnv ja gravou envStatus.hasGithubToken=true previamente.
    prisma.dEntidade.findFirst.mockResolvedValue(
      baseAgent(PROJECT_ID, {
        envStatus: {
          hasGithubToken: true,
          hasAnthropicKey: false,
          lastEnvUpdatedAt: '2026-05-13T10:00:00Z',
        },
      }),
    );
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dEntidade.update.mockResolvedValue({});

    const remoteClient = {
      dispatch: jest.fn().mockResolvedValue({ accepted: true, restartScheduled: true }),
    };

    const service = buildService({
      prisma,
      remoteClient,
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    // Segunda chamada: so anthropicApiKey. Espera hasGithubToken continuar true.
    const result = await service.setEnv(
      AGENT_ID,
      { anthropicApiKey: 'sk-ant-api03-yyyy' },
      USER_ID,
    );

    expect(result.hasGithubToken).toBe(true);
    expect(result.hasAnthropicKey).toBe(true);
  });

  it('503 quando dispatch falha (agente offline)', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });

    const remoteClient = {
      dispatch: jest.fn().mockRejectedValue(new ServiceUnavailableException('agent offline')),
    };

    const service = buildService({
      prisma,
      remoteClient,
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    await expect(
      service.setEnv(AGENT_ID, { githubToken: 'ghp_xxx_with_enough_chars' }, USER_ID),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    // Persistencia NAO foi feita
    expect(prisma.dEntidade.update).not.toHaveBeenCalled();
  });

  it('503 quando ACK !accepted', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });

    const remoteClient = {
      dispatch: jest.fn().mockResolvedValue({ accepted: false, errorCode: 'IO_ERROR' }),
    };

    const service = buildService({
      prisma,
      remoteClient,
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    await expect(
      service.setEnv(AGENT_ID, { githubToken: 'ghp_xxx_with_enough_chars' }, USER_ID),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('AgentEnvService.getEnvStatus', () => {
  it('le envStatus de dados sem outbound', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue(
      baseAgent(PROJECT_ID, {
        envStatus: {
          hasGithubToken: true,
          hasAnthropicKey: false,
          lastEnvUpdatedAt: '2026-05-13T18:00:00Z',
        },
      }),
    );

    const remoteClient = { dispatch: jest.fn() };
    const service = buildService({
      prisma,
      remoteClient,
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: { getProjectRole: jest.fn(), getOrgRole: jest.fn() },
    });

    const result = await service.getEnvStatus(AGENT_ID, USER_ID);

    expect(result).toEqual({
      hasGithubToken: true,
      hasAnthropicKey: false,
      lastEnvUpdatedAt: '2026-05-13T18:00:00Z',
    });
    expect(remoteClient.dispatch).not.toHaveBeenCalled();
  });

  it('retorna defaults quando envStatus nunca foi gravado', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: { getProjectRole: jest.fn(), getOrgRole: jest.fn() },
    });

    const result = await service.getEnvStatus(AGENT_ID, USER_ID);

    expect(result).toEqual({
      hasGithubToken: false,
      hasAnthropicKey: false,
      lastEnvUpdatedAt: null,
    });
  });

  it('404 quando agente nao existe', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue(null);

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: { getProjectRole: jest.fn(), getOrgRole: jest.fn() },
    });

    await expect(service.getEnvStatus(AGENT_ID, USER_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AgentEnvService.setGitBot', () => {
  it('dispatch SET_ENV com GIT_BOT_NAME/EMAIL + persiste dados + emite evento', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dEntidade.update.mockResolvedValue({});

    const remoteClient = {
      dispatch: jest
        .fn()
        .mockResolvedValue({ accepted: true, varsWritten: ['GIT_BOT_NAME', 'GIT_BOT_EMAIL'] }),
    };
    const eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };

    const service = buildService({
      prisma,
      remoteClient,
      eventProducer,
      roleResolver: {
        getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
        getOrgRole: jest.fn(),
      },
    });

    const result = await service.setGitBot(
      AGENT_ID,
      { name: 'Scrumban Bot', email: 'bot@scrumban.app' },
      USER_ID,
    );

    expect(result.name).toBe('Scrumban Bot');
    expect(result.email).toBe('bot@scrumban.app');
    expect(result.updatedAt).toEqual(expect.any(String));

    expect(remoteClient.dispatch).toHaveBeenCalledWith(
      'SET_ENV',
      {
        vars: { GIT_BOT_NAME: 'Scrumban Bot', GIT_BOT_EMAIL: 'bot@scrumban.app' },
        restartAfter: true,
      },
      expect.objectContaining({ agent: expect.objectContaining({ agentId: '32' }) }),
    );

    expect(prisma.dEntidade.update).toHaveBeenCalledWith({
      where: { chave: AGENT_ID },
      data: {
        dados: expect.objectContaining({
          gitBotName: 'Scrumban Bot',
          gitBotEmail: 'bot@scrumban.app',
          gitBotUpdatedAt: expect.any(String),
        }),
      },
    });

    expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'agent.gitbot.updated',
      expect.objectContaining({
        agentId: '32',
        userId: '42',
        name: 'Scrumban Bot',
        email: 'bot@scrumban.app',
      }),
      'corr-test',
      { source: AgentEnvService.name },
    );
  });

  it('403 quando usuario nao tem permissao', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue(baseAgent());
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

    await expect(
      service.setGitBot(AGENT_ID, { name: 'Bot', email: 'bot@x.com' }, USER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AgentEnvService — autorizacao (standalone agent)', () => {
  it('permite mutacao quando agent.idLocEscritu === userId (standalone, instalador)', async () => {
    const prisma = buildPrismaMock();
    // Standalone: idLocEscritu aponta para o usuario que instalou
    prisma.dEntidade.findFirst
      .mockResolvedValueOnce(baseAgent(USER_ID)) // 1a chamada: findAgentOrThrow
      .mockResolvedValueOnce({ chave: USER_ID, idClasse: BigInt(-150) }); // 2a: tentativa via idLocEscritu como org
    prisma.dProject.findFirst.mockResolvedValue(null); // nao e projeto
    prisma.dEntidade.update.mockResolvedValue({});

    const remoteClient = {
      dispatch: jest.fn().mockResolvedValue({ accepted: true }),
    };

    const service = buildService({
      prisma,
      remoteClient,
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn(),
        getOrgRole: jest.fn().mockResolvedValue(null),
      },
    });

    const result = await service.setEnv(
      AGENT_ID,
      { githubToken: 'ghp_xxx_with_enough_chars' },
      USER_ID,
    );

    expect(result.hasGithubToken).toBe(true);
    expect(remoteClient.dispatch).toHaveBeenCalled();
  });

  it('403 quando agent.idLocEscritu = outro userId (nao e o instalador)', async () => {
    const prisma = buildPrismaMock();
    const OTHER_USER_ID = BigInt(999);
    prisma.dEntidade.findFirst
      .mockResolvedValueOnce(baseAgent(OTHER_USER_ID))
      .mockResolvedValueOnce({ chave: OTHER_USER_ID, idClasse: BigInt(-150) });
    prisma.dProject.findFirst.mockResolvedValue(null);

    const service = buildService({
      prisma,
      remoteClient: { dispatch: jest.fn() },
      eventProducer: { addInternalEvent: jest.fn() },
      roleResolver: {
        getProjectRole: jest.fn(),
        getOrgRole: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(
      service.setEnv(AGENT_ID, { githubToken: 'ghp_xxx_with_enough_chars' }, USER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
