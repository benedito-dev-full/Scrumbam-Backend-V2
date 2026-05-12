import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { EventProducerService } from '../../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../../common/services/correlation-id.service';
import { RoleResolverService } from '../../../auth/services/role-resolver.service';
import { AUTOMATION_CLASS_IDS } from '../../constants/automation-class-ids';
import { AgentsService } from '../agents.service';
import { AgentInstallTokenService } from '../agent-install-token.service';
import { AgentKeyService } from '../agent-key.service';
import { AgentPortAllocatorService } from '../agent-port-allocator.service';

interface MockPrismaShape {
  dEntidade: { findFirst: jest.Mock };
  dVincula: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
  dProject: { findFirst: jest.Mock; findMany: jest.Mock };
}

function buildService(
  prismaMock: MockPrismaShape,
  roleResolverMock: Partial<Record<keyof RoleResolverService, jest.Mock>>,
  eventProducerMock: { addInternalEvent: jest.Mock },
): AgentsService {
  return new AgentsService(
    prismaMock as unknown as PrismaService,
    {} as AgentInstallTokenService,
    {} as AgentKeyService,
    {} as AgentPortAllocatorService,
    eventProducerMock as unknown as EventProducerService,
    {
      getOrGenerate: jest.fn().mockReturnValue('corr-test'),
    } as unknown as CorrelationIdService,
    roleResolverMock as unknown as RoleResolverService,
  );
}

function buildPrismaMock(): MockPrismaShape {
  return {
    dEntidade: { findFirst: jest.fn() },
    dVincula: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    dProject: { findFirst: jest.fn(), findMany: jest.fn() },
  };
}

describe('AgentsService.linkProject', () => {
  const AGENT_ID = BigInt(100);
  const PROJECT_ID = BigInt(123);
  const USER_ID = BigInt(42);
  const ORG_ID = BigInt(50);

  it('cria DVincula -185 quando nao existe e emite agent.project.linked', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue({ chave: AGENT_ID });
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue(null);
    prisma.dVincula.create.mockResolvedValue({ chave: BigInt(999) });

    const roleResolver = {
      getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
      getOrgRole: jest.fn(),
    };
    const eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
    const service = buildService(prisma, roleResolver, eventProducer);

    const result = await service.linkProject(AGENT_ID, PROJECT_ID, USER_ID);

    expect(result).toEqual({
      agentId: '100',
      projectId: '123',
      linked: true,
    });

    expect(prisma.dEntidade.findFirst).toHaveBeenCalledWith({
      where: {
        chave: AGENT_ID,
        idClasse: AUTOMATION_CLASS_IDS.AGENT,
        excluido: false,
      },
      select: { chave: true },
    });

    expect(prisma.dVincula.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT,
        idLocEscritu: PROJECT_ID,
        idEntidade: AGENT_ID,
        tipo: 'agent',
        metaDados: expect.objectContaining({
          linkedBy: '42',
        }),
      }),
    });

    expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'agent.project.linked',
      { agentId: '100', projectId: '123', linkedBy: '42' },
      'corr-test',
      { source: AgentsService.name },
    );
  });

  it('retorna alreadyLinked=true quando vinculo ativo ja existe (idempotente)', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue({ chave: AGENT_ID });
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue({ chave: BigInt(777) });

    const roleResolver = {
      getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
      getOrgRole: jest.fn(),
    };
    const eventProducer = { addInternalEvent: jest.fn() };
    const service = buildService(prisma, roleResolver, eventProducer);

    const result = await service.linkProject(AGENT_ID, PROJECT_ID, USER_ID);

    expect(result).toEqual({
      agentId: '100',
      projectId: '123',
      linked: true,
      alreadyLinked: true,
    });
    expect(prisma.dVincula.create).not.toHaveBeenCalled();
    expect(eventProducer.addInternalEvent).not.toHaveBeenCalled();
  });

  it('lanca NotFoundException quando agente nao existe', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue(null);

    const roleResolver = { getProjectRole: jest.fn(), getOrgRole: jest.fn() };
    const service = buildService(prisma, roleResolver, { addInternalEvent: jest.fn() });

    await expect(service.linkProject(AGENT_ID, PROJECT_ID, USER_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.dProject.findFirst).not.toHaveBeenCalled();
  });

  it('lanca NotFoundException quando projeto nao existe', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue({ chave: AGENT_ID });
    prisma.dProject.findFirst.mockResolvedValue(null);

    const roleResolver = { getProjectRole: jest.fn(), getOrgRole: jest.fn() };
    const service = buildService(prisma, roleResolver, { addInternalEvent: jest.fn() });

    await expect(service.linkProject(AGENT_ID, PROJECT_ID, USER_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.dVincula.findFirst).not.toHaveBeenCalled();
  });

  it('lanca ForbiddenException quando usuario nao e MANAGER nem ADMIN da org', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue({ chave: AGENT_ID });
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });

    const roleResolver = {
      getProjectRole: jest.fn().mockResolvedValue('MEMBER'),
      getOrgRole: jest.fn().mockResolvedValue('MEMBER'),
    };
    const service = buildService(prisma, roleResolver, { addInternalEvent: jest.fn() });

    await expect(service.linkProject(AGENT_ID, PROJECT_ID, USER_ID)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.dVincula.create).not.toHaveBeenCalled();
  });

  it('aceita ADMIN da org quando usuario nao tem role no projeto', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue({ chave: AGENT_ID });
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue(null);
    prisma.dVincula.create.mockResolvedValue({ chave: BigInt(998) });

    const roleResolver = {
      getProjectRole: jest.fn().mockResolvedValue(null),
      getOrgRole: jest.fn().mockResolvedValue('ADMIN'),
    };
    const eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
    const service = buildService(prisma, roleResolver, eventProducer);

    const result = await service.linkProject(AGENT_ID, PROJECT_ID, USER_ID);
    expect(result.linked).toBe(true);
    expect(prisma.dVincula.create).toHaveBeenCalled();
  });
});

describe('AgentsService.unlinkProject', () => {
  const AGENT_ID = BigInt(100);
  const PROJECT_ID = BigInt(123);
  const USER_ID = BigInt(42);
  const ORG_ID = BigInt(50);
  const LINK_ID = BigInt(777);

  it('faz soft-delete (excluido=true) e emite agent.project.unlinked', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue({ chave: AGENT_ID });
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue({ chave: LINK_ID });
    prisma.dVincula.update.mockResolvedValue({ chave: LINK_ID });

    const roleResolver = {
      getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
      getOrgRole: jest.fn(),
    };
    const eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
    const service = buildService(prisma, roleResolver, eventProducer);

    const result = await service.unlinkProject(AGENT_ID, PROJECT_ID, USER_ID);

    expect(result).toEqual({
      agentId: '100',
      projectId: '123',
      unlinked: true,
    });

    expect(prisma.dVincula.update).toHaveBeenCalledWith({
      where: { chave: LINK_ID },
      data: { excluido: true },
    });

    expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'agent.project.unlinked',
      { agentId: '100', projectId: '123', unlinkedBy: '42' },
      'corr-test',
      { source: AgentsService.name },
    );
  });

  it('lanca NotFoundException quando agente nao existe', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue(null);

    const roleResolver = { getProjectRole: jest.fn(), getOrgRole: jest.fn() };
    const service = buildService(prisma, roleResolver, { addInternalEvent: jest.fn() });

    await expect(service.unlinkProject(AGENT_ID, PROJECT_ID, USER_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.dVincula.update).not.toHaveBeenCalled();
  });

  it('lanca NotFoundException quando vinculo ativo nao existe', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue({ chave: AGENT_ID });
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });
    prisma.dVincula.findFirst.mockResolvedValue(null);

    const roleResolver = {
      getProjectRole: jest.fn().mockResolvedValue('MANAGER'),
      getOrgRole: jest.fn(),
    };
    const service = buildService(prisma, roleResolver, { addInternalEvent: jest.fn() });

    await expect(service.unlinkProject(AGENT_ID, PROJECT_ID, USER_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.dVincula.update).not.toHaveBeenCalled();
  });

  it('lanca ForbiddenException quando RBAC falha', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue({ chave: AGENT_ID });
    prisma.dProject.findFirst.mockResolvedValue({ chave: PROJECT_ID, idEstab: ORG_ID });

    const roleResolver = {
      getProjectRole: jest.fn().mockResolvedValue(null),
      getOrgRole: jest.fn().mockResolvedValue('MEMBER'),
    };
    const service = buildService(prisma, roleResolver, { addInternalEvent: jest.fn() });

    await expect(service.unlinkProject(AGENT_ID, PROJECT_ID, USER_ID)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.dVincula.findFirst).not.toHaveBeenCalled();
    expect(prisma.dVincula.update).not.toHaveBeenCalled();
  });
});

describe('AgentsService.listAgentProjects', () => {
  const AGENT_ID = BigInt(100);
  const USER_ID = BigInt(42);

  it('retorna projetos vinculados com nome e idEstab (ZERO N+1)', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue({ chave: AGENT_ID });
    prisma.dVincula.findMany.mockResolvedValue([
      { idLocEscritu: BigInt(123) },
      { idLocEscritu: BigInt(124) },
    ]);
    prisma.dProject.findMany.mockResolvedValue([
      { chave: BigInt(123), nome: 'Backend', idEstab: BigInt(50) },
      { chave: BigInt(124), nome: 'Frontend', idEstab: BigInt(50) },
    ]);

    const service = buildService(
      prisma,
      { getProjectRole: jest.fn(), getOrgRole: jest.fn() },
      { addInternalEvent: jest.fn() },
    );

    const result = await service.listAgentProjects(AGENT_ID, USER_ID);

    expect(result).toEqual({
      agentId: '100',
      projects: [
        { projectId: '123', nome: 'Backend', idEstab: '50' },
        { projectId: '124', nome: 'Frontend', idEstab: '50' },
      ],
    });

    // ZERO N+1: 1 query findFirst (agente) + 1 findMany (vinculos) + 1 findMany (projetos) = 3 queries fixas
    expect(prisma.dVincula.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.dProject.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.dProject.findMany).toHaveBeenCalledWith({
      where: {
        chave: { in: [BigInt(123), BigInt(124)] },
        excluido: false,
      },
      select: { chave: true, nome: true, idEstab: true },
    });
  });

  it('retorna projects vazio para agente standalone sem vinculos', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue({ chave: AGENT_ID });
    prisma.dVincula.findMany.mockResolvedValue([]);

    const service = buildService(
      prisma,
      { getProjectRole: jest.fn(), getOrgRole: jest.fn() },
      { addInternalEvent: jest.fn() },
    );

    const result = await service.listAgentProjects(AGENT_ID, USER_ID);

    expect(result).toEqual({ agentId: '100', projects: [] });
    // Skip query de DProject quando nao ha vinculos (otimizacao)
    expect(prisma.dProject.findMany).not.toHaveBeenCalled();
  });

  it('lanca NotFoundException quando agente nao existe', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue(null);

    const service = buildService(
      prisma,
      { getProjectRole: jest.fn(), getOrgRole: jest.fn() },
      { addInternalEvent: jest.fn() },
    );

    await expect(service.listAgentProjects(AGENT_ID, USER_ID)).rejects.toThrow(NotFoundException);
    expect(prisma.dVincula.findMany).not.toHaveBeenCalled();
  });

  it('mapeia idEstab null corretamente quando projeto nao tem org', async () => {
    const prisma = buildPrismaMock();
    prisma.dEntidade.findFirst.mockResolvedValue({ chave: AGENT_ID });
    prisma.dVincula.findMany.mockResolvedValue([{ idLocEscritu: BigInt(125) }]);
    prisma.dProject.findMany.mockResolvedValue([
      { chave: BigInt(125), nome: 'Projeto Orfao', idEstab: null },
    ]);

    const service = buildService(
      prisma,
      { getProjectRole: jest.fn(), getOrgRole: jest.fn() },
      { addInternalEvent: jest.fn() },
    );

    const result = await service.listAgentProjects(AGENT_ID, USER_ID);
    expect(result.projects[0]).toEqual({
      projectId: '125',
      nome: 'Projeto Orfao',
      idEstab: null,
    });
  });
});
