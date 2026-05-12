import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { SeedBootstrapService } from './seed-bootstrap.service';
import { ProjectMembersService } from './project-members.service';
import { PrismaService } from '../prisma.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: jest.Mocked<{
    dProject: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    dVincula: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      groupBy: jest.Mock;
    };
    dTask: {
      updateMany: jest.Mock;
      groupBy: jest.Mock;
    };
    dTabela: {
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  }>;
  let seedBootstrap: jest.Mocked<{ seedProject: jest.Mock }>;
  let projectMembers: jest.Mocked<{
    createManagerLink: jest.Mock;
    getMembers: jest.Mock;
    addMember: jest.Mock;
    updateMember: jest.Mock;
    removeMember: jest.Mock;
  }>;
  let eventProducer: jest.Mocked<{ addInternalEvent: jest.Mock }>;
  let correlationIdService: jest.Mocked<{ getOrGenerate: jest.Mock }>;

  const mockProject = {
    chave: BigInt(1),
    idClasse: BigInt(-153),
    nome: 'Test Project',
    descricao: null,
    idEstab: null,
    dados: { prefix: 'DEV', automationEnabled: false },
    excluido: false,
    criadoEm: new Date('2026-05-09T00:00:00Z'),
    atualizadoEm: new Date('2026-05-09T00:00:00Z'),
  };

  beforeEach(async () => {
    const prismaMock = {
      dProject: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      dVincula: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        groupBy: jest.fn(),
      },
      dTask: {
        updateMany: jest.fn(),
        groupBy: jest.fn(),
      },
      dTabela: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const seedBootstrapMock = { seedProject: jest.fn().mockResolvedValue(10) };
    const projectMembersMock = {
      createManagerLink: jest.fn().mockResolvedValue(undefined),
      getMembers: jest.fn(),
      addMember: jest.fn(),
      updateMember: jest.fn(),
      removeMember: jest.fn(),
    };
    const eventProducerMock = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
    const correlationIdMock = { getOrGenerate: jest.fn().mockReturnValue('test-corr-id') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: SeedBootstrapService, useValue: seedBootstrapMock },
        { provide: ProjectMembersService, useValue: projectMembersMock },
        { provide: EventProducerService, useValue: eventProducerMock },
        { provide: CorrelationIdService, useValue: correlationIdMock },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
    prisma = module.get(PrismaService) as typeof prisma;
    seedBootstrap = module.get(SeedBootstrapService) as typeof seedBootstrap;
    projectMembers = module.get(ProjectMembersService) as typeof projectMembers;
    eventProducer = module.get(EventProducerService) as typeof eventProducer;
    correlationIdService = module.get(CorrelationIdService) as typeof correlationIdService;
    void correlationIdService; // referenciado para evitar TS warn
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create()', () => {
    it('deve criar DProject + DVincula MANAGER + seed statuses + sprint em transaction', async () => {
      // Arrange
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          dProject: {
            create: jest.fn().mockResolvedValue(mockProject),
            findFirst: jest.fn().mockResolvedValue(null), // sem colisão de slug
          },
          dVincula: { create: jest.fn().mockResolvedValue({ chave: BigInt(1) }) },
        };
        return fn(txMock);
      });

      // Act
      const result = await service.create({ nome: 'Test Project', prefix: 'DEV' }, BigInt(100));

      // Assert
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // createManagerLink chamado dentro da transaction
      expect(projectMembers.createManagerLink).toHaveBeenCalledWith(
        expect.anything(), // tx
        expect.any(BigInt), // projectId
        BigInt(100), // userEntidadeId
      );
      // seedProject chamado dentro da transaction
      expect(seedBootstrap.seedProject).toHaveBeenCalledWith(
        expect.anything(), // tx
        expect.any(BigInt), // projectId
      );
      expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
        'project.created',
        expect.objectContaining({ nome: 'Test Project', userId: '100' }),
        'test-corr-id',
        expect.objectContaining({ source: 'ProjectsService' }),
      );
      expect(result.nome).toBe('Test Project');
      expect(result.memberCount).toBe(1);
    });

    it('deve usar prefix "DEV" como default quando não fornecido', async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          dProject: {
            create: jest.fn().mockResolvedValue(mockProject),
            findFirst: jest.fn().mockResolvedValue(null),
          },
        };
        return fn(txMock);
      });

      const result = await service.create({ nome: 'Test' }, BigInt(100));

      expect(result.prefix).toBe('DEV');
    });
  });

  describe('findMany()', () => {
    it('deve retornar lista vazia quando usuário não tem projetos', async () => {
      prisma.dVincula.findMany.mockResolvedValue([]);

      const result = await service.findMany(BigInt(100));

      expect(result.items).toHaveLength(0);
      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.nextCursor).toBeNull();
    });

    it('deve paginar com cursor corretamente', async () => {
      const vinculos = [{ idLocEscritu: BigInt(1) }, { idLocEscritu: BigInt(2) }];
      // findMany é chamado: (1) roles do user, (2) batch team links (após findMany de projects).
      prisma.dVincula.findMany
        .mockResolvedValueOnce(vinculos) // roles user
        .mockResolvedValueOnce([]); // team links batch (nenhum projeto tem team)
      prisma.dProject.findMany.mockResolvedValue([mockProject]);
      prisma.dVincula.groupBy.mockResolvedValue([
        { idLocEscritu: BigInt(1), _count: { chave: 2 } },
      ]);

      const result = await service.findMany(BigInt(100), { limit: 1 });

      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).toBe('1');
      // teamId resolvido como null quando não há vínculo -182.
      expect(result.items[0]?.teamId).toBeNull();
    });

    it('deve filtrar por teamId e retornar vazio quando time não tem projetos (ADR-V2-029)', async () => {
      // 1ª chamada de findMany: resolução dos projectIds do time (vazio).
      prisma.dVincula.findMany.mockResolvedValueOnce([]);

      const result = await service.findMany(BigInt(100), { teamId: '999' });

      expect(result.items).toHaveLength(0);
      expect(result.pagination.hasMore).toBe(false);
      // Apenas 1 query feita (a do time), sem buscar roles do user.
      expect(prisma.dVincula.findMany).toHaveBeenCalledTimes(1);
    });

    it('deve intersectar projectIds do time com membership do user (ADR-V2-029)', async () => {
      prisma.dVincula.findMany
        // 1) projectIds do time: project 1, 2
        .mockResolvedValueOnce([{ idEntidade: BigInt(1) }, { idEntidade: BigInt(2) }])
        // 2) roles do user (apenas projeto 1)
        .mockResolvedValueOnce([{ idLocEscritu: BigInt(1) }])
        // 3) team links batch
        .mockResolvedValueOnce([{ idEntidade: BigInt(1), idLocEscritu: BigInt(200) }]);
      prisma.dProject.findMany.mockResolvedValue([mockProject]);
      prisma.dVincula.groupBy.mockResolvedValue([
        { idLocEscritu: BigInt(1), _count: { chave: 1 } },
      ]);

      const result = await service.findMany(BigInt(100), { teamId: '200', limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].teamId).toBe('200');
      // 3 chamadas: time, user-roles, team-links batch.
      expect(prisma.dVincula.findMany).toHaveBeenCalledTimes(3);
    });

    it('deve manter filtro teamId combinado com cursor na 2ª página (regressão review Task 19)', async () => {
      // Bug detectado em review: spreads consecutivos com a mesma chave
      // (`idLocEscritu`) faziam o segundo (cursor) sobrescrever o primeiro
      // (teamProjectIds). Este teste prova que ambos os filtros coexistem.
      prisma.dVincula.findMany
        // 1) projectIds do time: 1, 2, 3
        .mockResolvedValueOnce([
          { idEntidade: BigInt(1) },
          { idEntidade: BigInt(2) },
          { idEntidade: BigInt(3) },
        ])
        // 2) roles do user (paginadas após cursor)
        .mockResolvedValueOnce([{ idLocEscritu: BigInt(2) }])
        // 3) team links batch
        .mockResolvedValueOnce([{ idEntidade: BigInt(2), idLocEscritu: BigInt(200) }]);
      prisma.dProject.findMany.mockResolvedValue([{ ...mockProject, chave: BigInt(2) }]);
      prisma.dVincula.groupBy.mockResolvedValue([
        { idLocEscritu: BigInt(2), _count: { chave: 1 } },
      ]);

      await service.findMany(BigInt(100), { teamId: '200', cursor: '3', limit: 20 });

      // Verifica que a 2ª chamada (roles do user) contém AMBOS os filtros
      // (`in: [...]` e `lt: ...`) no mesmo objeto idLocEscritu.
      const userRolesCall = prisma.dVincula.findMany.mock.calls[1][0];
      expect(userRolesCall.where.idLocEscritu).toEqual({
        in: [BigInt(1), BigInt(2), BigInt(3)],
        lt: BigInt(3),
      });
    });
  });

  describe('findOne()', () => {
    it('deve retornar projeto quando usuário é membro e teamId=null (órfão)', async () => {
      prisma.dProject.findFirst.mockResolvedValue(mockProject);
      // findFirst é chamado paralelo: (1) vinculo membership, (2) teamLink.
      prisma.dVincula.findFirst
        .mockResolvedValueOnce({ chave: BigInt(1) }) // membership
        .mockResolvedValueOnce(null); // teamLink null
      prisma.dVincula.count.mockResolvedValue(3);

      const result = await service.findOne('1', BigInt(100));

      expect(result.id).toBe('1');
      expect(result.memberCount).toBe(3);
      expect(result.teamId).toBeNull();
    });

    it('deve retornar teamId quando projeto tem vínculo -182 ativo (ADR-V2-029)', async () => {
      prisma.dProject.findFirst.mockResolvedValue(mockProject);
      prisma.dVincula.findFirst
        .mockResolvedValueOnce({ chave: BigInt(1) }) // membership
        .mockResolvedValueOnce({ idLocEscritu: BigInt(200) }); // teamLink ativo
      prisma.dVincula.count.mockResolvedValue(3);

      const result = await service.findOne('1', BigInt(100));

      expect(result.teamId).toBe('200');
    });

    it('deve lançar NotFoundException quando projeto não encontrado', async () => {
      prisma.dProject.findFirst.mockResolvedValue(null);
      prisma.dVincula.findFirst
        .mockResolvedValueOnce({ chave: BigInt(1) })
        .mockResolvedValueOnce(null);

      await expect(service.findOne('999', BigInt(100))).rejects.toThrow(NotFoundException);
    });

    it('deve lançar ForbiddenException quando usuário não é membro', async () => {
      prisma.dProject.findFirst.mockResolvedValue(mockProject);
      prisma.dVincula.findFirst
        .mockResolvedValueOnce(null) // não é membro
        .mockResolvedValueOnce(null);

      await expect(service.findOne('1', BigInt(999))).rejects.toThrow(ForbiddenException);
    });
  });

  describe('create() — vínculo de team (ADR-V2-029)', () => {
    it('deve criar DVincula -182 quando teamId fornecido (LEAD do time)', async () => {
      const txVinculaCreate = jest.fn().mockResolvedValue({ chave: BigInt(99) });
      const txEntidadeFindFirst = jest
        .fn()
        // 1) team existe e está na mesma org
        .mockResolvedValueOnce({ chave: BigInt(200), idEstab: BigInt(50) });
      const txVinculaFindFirst = jest
        .fn()
        // 1) membership LEAD do time
        .mockResolvedValueOnce({ metaDados: { cargo: 'LEAD' } });
      const projWithOrg = { ...mockProject, idEstab: BigInt(50) };

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          dProject: {
            create: jest.fn().mockResolvedValue(projWithOrg),
            findFirst: jest.fn().mockResolvedValue(null), // sem colisão de slug
          },
          dVincula: {
            create: txVinculaCreate,
            findFirst: txVinculaFindFirst,
          },
          dEntidade: { findFirst: txEntidadeFindFirst },
        };
        return fn(txMock);
      });

      const result = await service.create({ nome: 'P', orgId: '50', teamId: '200' }, BigInt(100));

      expect(txVinculaCreate).toHaveBeenCalledWith({
        data: {
          idClasse: BigInt(-182),
          idLocEscritu: BigInt(200),
          idEntidade: BigInt(1),
        },
      });
      // project.team.linked emitido APÓS commit
      expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
        'project.team.linked',
        expect.objectContaining({ teamId: '200', previousTeamId: null }),
        'test-corr-id',
        expect.objectContaining({ source: 'ProjectsService' }),
      );
      expect(result.teamId).toBe('200');
    });

    it('deve REJEITAR cross-org (time de outra org) — ForbiddenException', async () => {
      const projWithOrg = { ...mockProject, idEstab: BigInt(50) };

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          dProject: {
            create: jest.fn().mockResolvedValue(projWithOrg),
            findFirst: jest.fn().mockResolvedValue(null),
          },
          dVincula: { create: jest.fn(), findFirst: jest.fn() },
          dEntidade: {
            findFirst: jest
              .fn()
              // team existe MAS está em outra org (idEstab=999, projeto=50)
              .mockResolvedValueOnce({ chave: BigInt(200), idEstab: BigInt(999) }),
          },
        };
        return fn(txMock);
      });

      await expect(
        service.create({ nome: 'P', orgId: '50', teamId: '200' }, BigInt(100)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar NotFoundException quando teamId não existe', async () => {
      const projWithOrg = { ...mockProject, idEstab: BigInt(50) };
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          dProject: {
            create: jest.fn().mockResolvedValue(projWithOrg),
            findFirst: jest.fn().mockResolvedValue(null),
          },
          dVincula: { create: jest.fn(), findFirst: jest.fn() },
          dEntidade: { findFirst: jest.fn().mockResolvedValueOnce(null) },
        };
        return fn(txMock);
      });

      await expect(
        service.create({ nome: 'P', orgId: '50', teamId: '999' }, BigInt(100)),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve criar projeto órfão quando teamId omitido (teamId=null no response)', async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          dProject: {
            create: jest.fn().mockResolvedValue(mockProject),
            findFirst: jest.fn().mockResolvedValue(null),
          },
          dVincula: { create: jest.fn() },
        };
        return fn(txMock);
      });

      const result = await service.create({ nome: 'P' }, BigInt(100));

      expect(result.teamId).toBeNull();
      // project.team.linked NÃO foi emitido
      const linkedCalls = eventProducer.addInternalEvent.mock.calls.filter(
        (c) => c[0] === 'project.team.linked',
      );
      expect(linkedCalls).toHaveLength(0);
    });
  });

  describe('update() — vínculo de team (ADR-V2-029)', () => {
    it('deve reatribuir time (X→Y) com soft-delete antigo + create novo', async () => {
      // requireManagerRole: findFirst MANAGER (1ª call)
      // previousTeamLink: findFirst (-182) (2ª call) — retorna existing
      prisma.dVincula.findFirst
        .mockResolvedValueOnce({ chave: BigInt(99) }) // manager
        .mockResolvedValueOnce({ chave: BigInt(77), idLocEscritu: BigInt(200) }); // previous link
      const projWithOrg = { ...mockProject, idEstab: BigInt(50) };
      prisma.dProject.findFirst.mockResolvedValue(projWithOrg);
      prisma.dVincula.count.mockResolvedValue(1);

      const txUpdateLink = jest.fn().mockResolvedValue({ chave: BigInt(77) });
      const txCreateLink = jest.fn().mockResolvedValue({ chave: BigInt(78) });
      const txUpdateProject = jest.fn().mockResolvedValue(projWithOrg);
      const txEntidadeFindFirst = jest
        .fn()
        .mockResolvedValueOnce({ chave: BigInt(201), idEstab: BigInt(50) });
      const txVinculaFindFirst = jest.fn().mockResolvedValueOnce({ metaDados: { cargo: 'LEAD' } });

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn({
          dProject: { update: txUpdateProject },
          dVincula: {
            update: txUpdateLink,
            create: txCreateLink,
            findFirst: txVinculaFindFirst,
          },
          dEntidade: { findFirst: txEntidadeFindFirst },
        });
      });

      const result = await service.update('1', { teamId: '201' }, BigInt(100));

      expect(txUpdateLink).toHaveBeenCalledWith({
        where: { chave: BigInt(77) },
        data: { excluido: true },
      });
      expect(txCreateLink).toHaveBeenCalledWith({
        data: {
          idClasse: BigInt(-182),
          idLocEscritu: BigInt(201),
          idEntidade: BigInt(1),
        },
      });
      expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
        'project.team.linked',
        expect.objectContaining({ teamId: '201', previousTeamId: '200' }),
        'test-corr-id',
        expect.objectContaining({ source: 'ProjectsService' }),
      );
      expect(result.teamId).toBe('201');
    });

    it('deve desvincular (X→null) com soft-delete e emitir project.team.unlinked', async () => {
      prisma.dVincula.findFirst
        .mockResolvedValueOnce({ chave: BigInt(99) }) // manager
        .mockResolvedValueOnce({ chave: BigInt(77), idLocEscritu: BigInt(200) });
      prisma.dProject.findFirst.mockResolvedValue(mockProject);
      prisma.dVincula.count.mockResolvedValue(1);

      const txUpdateLink = jest.fn().mockResolvedValue({ chave: BigInt(77) });
      const txCreateLink = jest.fn();
      const txUpdateProject = jest.fn().mockResolvedValue(mockProject);

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn({
          dProject: { update: txUpdateProject },
          dVincula: { update: txUpdateLink, create: txCreateLink, findFirst: jest.fn() },
        });
      });

      const result = await service.update('1', { teamId: null }, BigInt(100));

      expect(txUpdateLink).toHaveBeenCalledWith({
        where: { chave: BigInt(77) },
        data: { excluido: true },
      });
      expect(txCreateLink).not.toHaveBeenCalled();
      expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
        'project.team.unlinked',
        expect.objectContaining({ teamId: null, previousTeamId: '200' }),
        'test-corr-id',
        expect.objectContaining({ source: 'ProjectsService' }),
      );
      expect(result.teamId).toBeNull();
    });

    it('deve REJEITAR update por não-MANAGER (ForbiddenException antes de mutação)', async () => {
      prisma.dVincula.findFirst.mockResolvedValueOnce(null); // não é MANAGER

      await expect(service.update('1', { teamId: '200' }, BigInt(999))).rejects.toThrow(
        ForbiddenException,
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('deve manter teamId quando dto não envia o campo (no-op)', async () => {
      prisma.dVincula.findFirst.mockResolvedValueOnce({ chave: BigInt(99) }); // manager
      prisma.dProject.findFirst.mockResolvedValue(mockProject);
      prisma.dVincula.count.mockResolvedValue(1);
      // findFirst final para resolver teamId atual (vínculo ativo no projeto)
      prisma.dVincula.findFirst.mockResolvedValueOnce({ idLocEscritu: BigInt(200) });

      const txUpdateProject = jest.fn().mockResolvedValue(mockProject);
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn({
          dProject: { update: txUpdateProject },
          dVincula: { update: jest.fn(), create: jest.fn(), findFirst: jest.fn() },
        });
      });

      const result = await service.update('1', { nome: 'Novo' }, BigInt(100));

      expect(result.teamId).toBe('200');
      // Nenhum evento de team emitido
      const linkedCalls = eventProducer.addInternalEvent.mock.calls.filter(
        (c) => c[0] === 'project.team.linked' || c[0] === 'project.team.unlinked',
      );
      expect(linkedCalls).toHaveLength(0);
    });
  });

  describe('create() — slug derivation (ADR-V2-030, Sub-tarefa 2.3)', () => {
    it('deve gerar dados.slug a partir do nome (slugify simples)', async () => {
      const txProjectCreate = jest.fn().mockResolvedValue(mockProject);
      const txProjectFindFirst = jest.fn().mockResolvedValue(null); // sem colisão
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn({
          dProject: { create: txProjectCreate, findFirst: txProjectFindFirst },
          dVincula: { create: jest.fn() },
        });
      });

      await service.create({ nome: 'Scrumban Backend V2' }, BigInt(100));

      // Verifica que dados.slug foi persistido no create
      expect(txProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dados: expect.objectContaining({ slug: 'scrumban-backend-v2' }),
          }),
        }),
      );
    });

    it('deve adicionar sufixo -2 quando slug base colide com projeto existente', async () => {
      const txProjectCreate = jest.fn().mockResolvedValue(mockProject);
      // 1ª findFirst (candidato base "scrumban-backend-v2"): colisão.
      // 2ª findFirst (candidato "scrumban-backend-v2-2"): livre.
      const txProjectFindFirst = jest
        .fn()
        .mockResolvedValueOnce({ chave: BigInt(99) })
        .mockResolvedValueOnce(null);
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn({
          dProject: { create: txProjectCreate, findFirst: txProjectFindFirst },
          dVincula: { create: jest.fn() },
        });
      });

      await service.create({ nome: 'Scrumban Backend V2' }, BigInt(100));

      expect(txProjectFindFirst).toHaveBeenCalledTimes(2);
      expect(txProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dados: expect.objectContaining({ slug: 'scrumban-backend-v2-2' }),
          }),
        }),
      );
    });

    it('deve escalar para -3 quando -2 também colide (cascata)', async () => {
      const txProjectCreate = jest.fn().mockResolvedValue(mockProject);
      const txProjectFindFirst = jest
        .fn()
        .mockResolvedValueOnce({ chave: BigInt(99) }) // base colide
        .mockResolvedValueOnce({ chave: BigInt(100) }) // -2 colide
        .mockResolvedValueOnce(null); // -3 livre
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn({
          dProject: { create: txProjectCreate, findFirst: txProjectFindFirst },
          dVincula: { create: jest.fn() },
        });
      });

      await service.create({ nome: 'Foo' }, BigInt(100));

      expect(txProjectCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dados: expect.objectContaining({ slug: 'foo-3' }),
          }),
        }),
      );
    });

    it('deve aplicar fallback untitled-* quando nome só de símbolos', async () => {
      const txProjectCreate = jest.fn().mockResolvedValue(mockProject);
      const txProjectFindFirst = jest.fn().mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn({
          dProject: { create: txProjectCreate, findFirst: txProjectFindFirst },
          dVincula: { create: jest.fn() },
        });
      });

      await service.create({ nome: '!!!!!!' }, BigInt(100));

      const createCallArg = txProjectCreate.mock.calls[0][0];
      const slugUsed = createCallArg.data.dados.slug as string;
      expect(slugUsed).toMatch(/^untitled-[a-z0-9]+$/);
    });
  });

  describe('onModuleInit() — backfill idempotente (Sub-tarefa 2.3)', () => {
    it('deve gerar slug para projetos com dados.slug ausente (idempotente)', async () => {
      // 1ª invocação: retorna 2 projetos pendentes.
      // 2ª invocação: retorna 0 (nada mais a fazer).
      prisma.dProject.findMany
        .mockResolvedValueOnce([
          { chave: BigInt(10), nome: 'Project Alpha', dados: { prefix: 'DEV' } },
          { chave: BigInt(11), nome: 'Project Beta', dados: null },
        ])
        .mockResolvedValueOnce([]);
      // Para cada deriveUniqueSlug (1 lookup por projeto, sem colisão): null.
      prisma.dProject.findFirst.mockResolvedValue(null);
      prisma.dProject.update.mockResolvedValue({});

      await service.onModuleInit();

      expect(prisma.dProject.update).toHaveBeenCalledTimes(2);
      // Primeiro projeto: merge com dados existente preservando prefix.
      expect(prisma.dProject.update).toHaveBeenNthCalledWith(1, {
        where: { chave: BigInt(10) },
        data: { dados: { prefix: 'DEV', slug: 'project-alpha' } },
      });
      // Segundo projeto: dados era null, vira objeto novo apenas com slug.
      expect(prisma.dProject.update).toHaveBeenNthCalledWith(2, {
        where: { chave: BigInt(11) },
        data: { dados: { slug: 'project-beta' } },
      });
    });

    it('deve ser no-op quando rodado 2× (idempotência)', async () => {
      // 1ª chamada de onModuleInit: 1 projeto.
      // 2ª chamada: nada (slug já preenchido).
      prisma.dProject.findMany
        .mockResolvedValueOnce([{ chave: BigInt(10), nome: 'P', dados: null }])
        .mockResolvedValueOnce([]) // fim do loop do 1º run
        .mockResolvedValueOnce([]); // 2º run não acha nada
      prisma.dProject.findFirst.mockResolvedValue(null);
      prisma.dProject.update.mockResolvedValue({});

      await service.onModuleInit();
      await service.onModuleInit();

      // Apenas 1 update no total (não duplicou).
      expect(prisma.dProject.update).toHaveBeenCalledTimes(1);
    });

    it('deve continuar processamento quando 1 projeto falha (log warn, não aborta)', async () => {
      prisma.dProject.findMany
        .mockResolvedValueOnce([
          { chave: BigInt(10), nome: 'A', dados: null },
          { chave: BigInt(11), nome: 'B', dados: null },
        ])
        .mockResolvedValueOnce([]);
      prisma.dProject.findFirst.mockResolvedValue(null);
      // Update do projeto 10 falha; 11 funciona.
      prisma.dProject.update
        .mockRejectedValueOnce(new Error('simulated_db_error'))
        .mockResolvedValueOnce({});

      await expect(service.onModuleInit()).resolves.toBeUndefined();

      expect(prisma.dProject.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('delete()', () => {
    it('deve fazer soft-delete em cascade (DVincula + DTask + DProject)', async () => {
      // Simular requireManagerRole — primeiro findFirst para MANAGER check
      prisma.dVincula.findFirst.mockResolvedValue({ chave: BigInt(1) });
      prisma.dProject.findFirst.mockResolvedValue({ chave: BigInt(1), nome: 'Test' });

      const updateManyVinculos = jest.fn().mockResolvedValue({ count: 2 });
      const updateManyTasks = jest.fn().mockResolvedValue({ count: 5 });
      const updateProject = jest.fn().mockResolvedValue(mockProject);

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn({
          dVincula: { updateMany: updateManyVinculos },
          dTask: { updateMany: updateManyTasks },
          dProject: { update: updateProject },
        });
      });

      await service.delete('1', BigInt(100));

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(updateManyVinculos).toHaveBeenCalledWith({
        where: { idLocEscritu: BigInt(1), excluido: false },
        data: { excluido: true },
      });
      expect(updateManyTasks).toHaveBeenCalledWith({
        where: { idProject: BigInt(1), excluido: false },
        data: { excluido: true },
      });
      expect(updateProject).toHaveBeenCalledWith({
        where: { chave: BigInt(1) },
        data: { excluido: true },
      });
      expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
        'project.deleted',
        expect.objectContaining({ nome: 'Test', projectId: '1' }),
        'test-corr-id',
        expect.objectContaining({ source: 'ProjectsService' }),
      );
    });
  });
});
