import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { SeedBootstrapService } from './seed-bootstrap.service';
import { ProjectMembersService } from './project-members.service';
import { PrismaService } from '../prisma.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';
import { ProjectRefService } from './project-ref.service';
import { BUILTIN_COLUMN_ORDER } from '../tasks/table-fields/builtin-columns';

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
    $queryRaw: jest.Mock;
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
      $queryRaw: jest.fn(),
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
    // ADR-V2-058/059: espelho -158. ensureEntidadeRef devolve um refId (E) fixo;
    // resolveEntidadeRef/resolveProjectId fazem passthrough nos testes.
    const projectRefMock = {
      // Espelho devolve a própria chave do projeto nos testes (E=P), de modo
      // que as asserções de idEntidade/idLocEscritu legadas continuem válidas.
      ensureEntidadeRef: jest.fn((_tx: unknown, proj: { chave: bigint }) =>
        Promise.resolve(proj.chave),
      ),
      ensureEntidadeRefById: jest.fn((id: bigint) => Promise.resolve(id)),
      resolveEntidadeRef: jest.fn((id: bigint) => Promise.resolve(id)),
      resolveProjectId: jest.fn((id: bigint) => Promise.resolve(id)),
      // Passthrough legacy-safe: handle É o projectId nos testes.
      resolveEntidadeRefs: jest.fn((ids: bigint[]) =>
        Promise.resolve(new Map(ids.map((id) => [id.toString(), id]))),
      ),
      refsToProjectIds: jest.fn((handles: Array<bigint | null>) =>
        Promise.resolve(
          Array.from(
            new Set(handles.filter((h): h is bigint => h !== null).map((h) => h.toString())),
          ),
        ),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: SeedBootstrapService, useValue: seedBootstrapMock },
        { provide: ProjectMembersService, useValue: projectMembersMock },
        { provide: EventProducerService, useValue: eventProducerMock },
        { provide: CorrelationIdService, useValue: correlationIdMock },
        { provide: ProjectRefService, useValue: projectRefMock },
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
    it('deve criar LIST (idClasse=-352) + DVincula MANAGER + seed statuses + sprint em transaction', async () => {
      // Arrange — projeto do tipo LIST: mock retorna idClasse=-352 para que a
      // condição `proj.idClasse === ID_CLASSE_LIST` no service seja verdadeira
      // e seedBootstrap.seedProject seja chamado.
      const listProject = { ...mockProject, idClasse: BigInt(-352) };
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          dProject: {
            create: jest.fn().mockResolvedValue(listProject),
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
      // seedProject DEVE ser chamado para LIST (idClasse=-352)
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

    it('deve criar SPACE (idClasse=-350) sem chamar seedBootstrap', async () => {
      // SPACE é contêiner estrutural — NÃO deve receber seed de statuses/sprint.
      // Mock retorna idClasse=-350 → condição ID_CLASSE_LIST falha → seedBootstrap não chamado.
      const spaceProject = { ...mockProject, idClasse: BigInt(-350) };
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          dProject: {
            create: jest.fn().mockResolvedValue(spaceProject),
            findFirst: jest.fn().mockResolvedValue(null),
          },
          dVincula: { create: jest.fn().mockResolvedValue({ chave: BigInt(1) }) },
        };
        return fn(txMock);
      });

      await service.create({ nome: 'My Space' }, BigInt(100));

      expect(seedBootstrap.seedProject).not.toHaveBeenCalled();
    });

    it('deve criar FOLDER (idClasse=-351) sem chamar seedBootstrap', async () => {
      // FOLDER é contêiner estrutural — NÃO deve receber seed de statuses/sprint.
      // Mock retorna idClasse=-351 → condição ID_CLASSE_LIST falha → seedBootstrap não chamado.
      const folderProject = { ...mockProject, idClasse: BigInt(-351) };
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          dProject: {
            create: jest.fn().mockResolvedValue(folderProject),
            findFirst: jest.fn().mockResolvedValue(null),
          },
          dVincula: { create: jest.fn().mockResolvedValue({ chave: BigInt(1) }) },
        };
        return fn(txMock);
      });

      await service.create({ nome: 'My Folder' }, BigInt(100));

      expect(seedBootstrap.seedProject).not.toHaveBeenCalled();
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
      // 4 chamadas: time, user-roles, team-links batch, folder-links batch
      // (ADR-V2-FOLDERS-001 adicionou resolveFolderIdsForProjects).
      expect(prisma.dVincula.findMany).toHaveBeenCalledTimes(4);
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

    it('deve completar tableFields de LIST legada com as 7 builtin no GET', async () => {
      prisma.dProject.findFirst.mockResolvedValue({
        ...mockProject,
        idClasse: BigInt(-352),
        tableFields: null,
      });
      prisma.dVincula.findFirst
        .mockResolvedValueOnce({ chave: BigInt(1) })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prisma.dVincula.count.mockResolvedValue(1);

      const result = await service.findOne('1', BigInt(100));

      expect(result.tableFields?.columns.map((column) => column.key)).toEqual(BUILTIN_COLUMN_ORDER);
      expect(result.tableFields?.columns.every((column) => column.builtin === true)).toBe(true);
    });

    it('deve devolver builtin mais custom sem duplicar para LIST com tableFields custom', async () => {
      prisma.dProject.findFirst.mockResolvedValue({
        ...mockProject,
        idClasse: BigInt(-352),
        tableFields: {
          version: 4,
          columns: [{ key: 'f_cliente', type: 'text', label: 'Cliente', order: 0 }],
        },
      });
      prisma.dVincula.findFirst
        .mockResolvedValueOnce({ chave: BigInt(1) })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prisma.dVincula.count.mockResolvedValue(1);

      const result = await service.findOne('1', BigInt(100));

      expect(result.tableFields?.version).toBe(4);
      // Fase 4 (reorder de TUDO): o merge preserva a `order` armazenada e injeta
      // builtin ausentes ao FINAL. A custom (order:0) vem antes das 7 builtin
      // (Fase 3 — timeSpent passou a ser a 7ª builtin).
      expect(result.tableFields?.columns.map((column) => column.key)).toEqual([
        'f_cliente',
        ...BUILTIN_COLUMN_ORDER,
      ]);
      // Não duplica e completa as 7 builtin.
      expect(result.tableFields?.columns).toHaveLength(8);
    });

    it('nao aplica merge-on-read em projetos que nao sao LIST', async () => {
      prisma.dProject.findFirst.mockResolvedValue({
        ...mockProject,
        idClasse: BigInt(-350),
        tableFields: null,
      });
      prisma.dVincula.findFirst
        .mockResolvedValueOnce({ chave: BigInt(1) })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prisma.dVincula.count.mockResolvedValue(1);

      const result = await service.findOne('1', BigInt(100));

      expect(result.tableFields).toBeNull();
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

    it('concede acesso a lista filha de SPACE público para membro da org sem DVincula (ADR-V2-051 §8 — Camada A)', async () => {
      // LIST (-352) filha de um SPACE público, dentro da org 50.
      const listProject = {
        ...mockProject,
        idClasse: BigInt(-352),
        idPai: BigInt(10),
        idEstab: BigInt(50),
        privado: false,
      };
      prisma.dProject.findFirst.mockResolvedValue(listProject);
      // 1ª findFirst (vínculo de projeto) = null → não é membro direto.
      // 2ª/3ª (teamLink/folderLink) = null.
      prisma.dVincula.findFirst
        .mockResolvedValueOnce(null) // sem DVincula de projeto
        .mockResolvedValueOnce(null) // teamLink
        .mockResolvedValueOnce(null) // folderLink
        // 4ª findFirst dentro de hasPublicSpaceAccess: membro da org.
        .mockResolvedValueOnce({ chave: BigInt(77) });
      // CTE recursiva (isProjectPubliclyVisible) sobe até o SPACE raiz → público.
      prisma.$queryRaw.mockResolvedValue([
        { chave: BigInt(10), idClasse: BigInt(-350), privado: false },
        { chave: BigInt(1), idClasse: BigInt(-352), privado: false },
      ]);
      prisma.dVincula.count.mockResolvedValue(0);

      const result = await service.findOne('1', BigInt(999), '50');

      expect(result).toBeDefined();
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('nega acesso quando o SPACE raiz é privado mesmo sendo membro da org', async () => {
      const listProject = {
        ...mockProject,
        idClasse: BigInt(-352),
        idPai: BigInt(10),
        idEstab: BigInt(50),
        privado: false,
      };
      prisma.dProject.findFirst.mockResolvedValue(listProject);
      prisma.dVincula.findFirst
        .mockResolvedValueOnce(null) // sem DVincula de projeto
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      // SPACE raiz é PRIVADO → sem acesso herdado.
      prisma.$queryRaw.mockResolvedValue([
        { chave: BigInt(10), idClasse: BigInt(-350), privado: true },
        { chave: BigInt(1), idClasse: BigInt(-352), privado: false },
      ]);

      await expect(service.findOne('1', BigInt(999), '50')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findAccessibleProjectIds() — Camada A espaços públicos (ADR-V2-051 §8)', () => {
    it('inclui projetos de SPACEs públicos da org mesmo sem DVincula de projeto', async () => {
      // Sem DVincula de projeto (Camada B vazia).
      prisma.dVincula.findMany.mockResolvedValue([]);
      // Usuário é membro da org.
      prisma.dVincula.findFirst.mockResolvedValue({ chave: BigInt(77) });
      // listPublicSpaceProjectIds: SPACE público + lista filha.
      prisma.$queryRaw.mockResolvedValue([{ chave: BigInt(10) }, { chave: BigInt(25) }]);

      const ids = await service.findAccessibleProjectIds(BigInt(999), '50');

      expect(ids.sort()).toEqual(['10', '25']);
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('NÃO inclui espaços públicos quando usuário não é membro da org', async () => {
      prisma.dVincula.findMany.mockResolvedValue([]);
      prisma.dVincula.findFirst.mockResolvedValue(null); // não é membro da org

      const ids = await service.findAccessibleProjectIds(BigInt(999), '50');

      expect(ids).toEqual([]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('une DVincula explícita (Camada B) com espaços públicos (Camada A), deduplicado', async () => {
      prisma.dVincula.findMany.mockResolvedValue([{ idLocEscritu: BigInt(30) }]);
      prisma.dProject.findMany.mockResolvedValue([{ chave: BigInt(30) }]);
      prisma.dVincula.findFirst.mockResolvedValue({ chave: BigInt(77) });
      // 25 é público; 30 também aparece como público → dedup.
      prisma.$queryRaw.mockResolvedValue([{ chave: BigInt(25) }, { chave: BigInt(30) }]);

      const ids = await service.findAccessibleProjectIds(BigInt(999), '50');

      expect(ids.sort()).toEqual(['25', '30']);
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

  describe('repoUrl — fonte única (ADR-V2-043, limpeza dual-write)', () => {
    const REPO = 'git@github.com:org/repo.git';

    it('create({ repoUrl }) deve gravar apenas a coluna repoUrl (sem dados.gitRepo)', async () => {
      const txProjectCreate = jest.fn().mockResolvedValue({
        ...mockProject,
        repoUrl: REPO,
        dados: { ...mockProject.dados, slug: 'test-project' },
      });
      const txProjectFindFirst = jest.fn().mockResolvedValue(null); // sem colisão slug
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn({
          dProject: { create: txProjectCreate, findFirst: txProjectFindFirst },
          dVincula: { create: jest.fn() },
        });
      });

      const result = await service.create({ nome: 'Test Project', repoUrl: REPO }, BigInt(100));

      const createArg = txProjectCreate.mock.calls[0][0];
      // Coluna canônica deve ser gravada.
      expect(createArg.data.repoUrl).toBe(REPO);
      // dados.gitRepo NÃO deve ser escrito.
      expect(createArg.data.dados).not.toHaveProperty('gitRepo');
      expect(result.repoUrl).toBe(REPO);
    });

    it('buildResponse usa apenas project.repoUrl (ignora dados.gitRepo histórico)', async () => {
      const legacyRepo = 'git@github.com:org/legacy.git';
      // Projeto com repoUrl preenchido (coluna canônica).
      const projComRepoUrl = {
        ...mockProject,
        repoUrl: legacyRepo,
        // dados.gitRepo pode estar presente em registros históricos mas é ignorado.
        dados: { ...mockProject.dados, gitRepo: 'https://ANTIGO-NAO-DEVE-SER-LIDO.com/repo' },
      };
      prisma.dProject.findFirst.mockResolvedValue(projComRepoUrl);
      prisma.dVincula.findFirst
        .mockResolvedValueOnce({ chave: BigInt(1) }) // membership
        .mockResolvedValueOnce(null); // teamLink
      prisma.dVincula.count.mockResolvedValue(1);

      const result = await service.findOne('1', BigInt(100));

      // Deve usar apenas a coluna canônica.
      expect(result.repoUrl).toBe(legacyRepo);
    });
  });

  // ─── Testes ADR-V2-051: idClasse + idPai no create() ──────────────────────

  describe('create() — idClasse e idPai (ADR-V2-051)', () => {
    /**
     * Helper que configura $transaction retornando um projeto com o idClasse fornecido.
     */
    const setupTxForIdClasse = (idClasse: bigint) => {
      const proj = { ...mockProject, idClasse };
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          dProject: {
            create: jest.fn().mockResolvedValue(proj),
            findFirst: jest.fn().mockResolvedValue(null), // sem colisão de slug
          },
          dVincula: { create: jest.fn().mockResolvedValue({ chave: BigInt(1) }) },
        };
        return fn(txMock);
      });
    };

    it('deve criar projeto com idClasse=-350 (SPACE) quando dto.idClasse fornecido', async () => {
      setupTxForIdClasse(BigInt(-350));

      const result = await service.create({ nome: 'My Space', idClasse: '-350' }, BigInt(100));

      // O response deve refletir o idClasse=-350 que o mock retornou.
      expect(result.idClasse).toBe('-350');
    });

    it('deve usar idClasse=-153 como fallback quando dto.idClasse ausente', async () => {
      setupTxForIdClasse(BigInt(-153));

      const result = await service.create({ nome: 'Legacy Project' }, BigInt(100));

      expect(result.idClasse).toBe('-153');
    });

    it('findMany com idClasse="-350" deve filtrar apenas projetos SPACE', async () => {
      const spaceProject = { ...mockProject, idClasse: BigInt(-350) };
      prisma.dVincula.findMany
        .mockResolvedValueOnce([{ idLocEscritu: BigInt(1) }]) // roles user
        .mockResolvedValueOnce([]) // team links
        .mockResolvedValueOnce([]); // folder links
      prisma.dProject.findMany.mockResolvedValue([spaceProject]);
      prisma.dVincula.groupBy.mockResolvedValue([
        { idLocEscritu: BigInt(1), _count: { chave: 1 } },
      ]);

      const result = await service.findMany(BigInt(100), { idClasse: '-350' });

      // Verifica que o filtro foi passado para dProject.findMany
      const projectsCall = prisma.dProject.findMany.mock.calls[0][0];
      expect(projectsCall.where).toMatchObject({ idClasse: BigInt(-350) });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].idClasse).toBe('-350');
    });

    it('findMany com idPai="100" deve aplicar filtro BigInt corretamente', async () => {
      prisma.dVincula.findMany
        .mockResolvedValueOnce([{ idLocEscritu: BigInt(1) }]) // roles user
        .mockResolvedValueOnce([]) // team links
        .mockResolvedValueOnce([]); // folder links
      prisma.dProject.findMany.mockResolvedValue([mockProject]);
      prisma.dVincula.groupBy.mockResolvedValue([
        { idLocEscritu: BigInt(1), _count: { chave: 1 } },
      ]);

      await service.findMany(BigInt(100), { idPai: '100' });

      const projectsCall = prisma.dProject.findMany.mock.calls[0][0];
      // idPai deve ser convertido para BigInt(100) no where
      expect(projectsCall.where).toMatchObject({ idPai: BigInt(100) });
    });

    it('findMany com privado=false deve aplicar filtro { privado: false } no where (C5)', async () => {
      // Apenas Spaces públicos (privado=false) devem aparecer.
      const publicSpace = { ...mockProject, idClasse: BigInt(-350), privado: false };
      prisma.dVincula.findMany
        .mockResolvedValueOnce([{ idLocEscritu: BigInt(1) }]) // roles user
        .mockResolvedValueOnce([]) // team links
        .mockResolvedValueOnce([]); // folder links
      prisma.dProject.findMany.mockResolvedValue([publicSpace]);
      prisma.dVincula.groupBy.mockResolvedValue([
        { idLocEscritu: BigInt(1), _count: { chave: 1 } },
      ]);

      await service.findMany(BigInt(100), { privado: false });

      const projectsCall = prisma.dProject.findMany.mock.calls[0][0];
      expect(projectsCall.where).toMatchObject({ privado: false });
      expect(projectsCall.where).not.toHaveProperty('privado', true);
    });

    it('findMany com privado=true deve aplicar filtro { privado: true } no where (C5)', async () => {
      // Apenas Spaces privados devem aparecer.
      const privateSpace = { ...mockProject, idClasse: BigInt(-350), privado: true };
      prisma.dVincula.findMany
        .mockResolvedValueOnce([{ idLocEscritu: BigInt(1) }]) // roles user
        .mockResolvedValueOnce([]) // team links
        .mockResolvedValueOnce([]); // folder links
      prisma.dProject.findMany.mockResolvedValue([privateSpace]);
      prisma.dVincula.groupBy.mockResolvedValue([
        { idLocEscritu: BigInt(1), _count: { chave: 1 } },
      ]);

      await service.findMany(BigInt(100), { privado: true });

      const projectsCall = prisma.dProject.findMany.mock.calls[0][0];
      expect(projectsCall.where).toMatchObject({ privado: true });
    });

    it('findMany sem privado não deve incluir filtro de privacidade no where (C5)', async () => {
      // Ausência de `privado` = sem filtro (retorna públicos e privados).
      prisma.dVincula.findMany
        .mockResolvedValueOnce([{ idLocEscritu: BigInt(1) }]) // roles user
        .mockResolvedValueOnce([]) // team links
        .mockResolvedValueOnce([]); // folder links
      prisma.dProject.findMany.mockResolvedValue([mockProject]);
      prisma.dVincula.groupBy.mockResolvedValue([
        { idLocEscritu: BigInt(1), _count: { chave: 1 } },
      ]);

      await service.findMany(BigInt(100));

      const projectsCall = prisma.dProject.findMany.mock.calls[0][0];
      expect(projectsCall.where).not.toHaveProperty('privado');
    });

    it('deve lançar BadRequestException ao criar FOLDER com pai que não é SPACE', async () => {
      // Mock: pai existe mas é um FOLDER (-351), não SPACE (-350).
      prisma.dProject.findFirst.mockResolvedValue({
        chave: BigInt(99),
        idClasse: BigInt(-351), // FOLDER — inválido como pai de outro FOLDER
        nome: 'Outro Folder',
        descricao: null,
        idEstab: null,
        dados: {},
        excluido: false,
        criadoEm: new Date(),
        atualizadoEm: new Date(),
      });

      await expect(
        service.create({ nome: 'Bad Folder', idClasse: '-351', idPai: '99' }, BigInt(100)),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve criar FOLDER com idPai que é SPACE sem lançar exceção', async () => {
      // Mock: pai existe e é SPACE (-350) — hierarquia válida.
      prisma.dProject.findFirst.mockResolvedValue({
        chave: BigInt(50),
        idClasse: BigInt(-350), // SPACE — válido como pai de FOLDER
        nome: 'My Space',
        descricao: null,
        idEstab: null,
        dados: {},
        excluido: false,
        criadoEm: new Date(),
        atualizadoEm: new Date(),
      });

      const folderProject = { ...mockProject, idClasse: BigInt(-351) };
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          dProject: {
            create: jest.fn().mockResolvedValue(folderProject),
            findFirst: jest.fn().mockResolvedValue(null),
          },
          dVincula: { create: jest.fn().mockResolvedValue({ chave: BigInt(1) }) },
        };
        return fn(txMock);
      });

      await expect(
        service.create({ nome: 'Valid Folder', idClasse: '-351', idPai: '50' }, BigInt(100)),
      ).resolves.not.toThrow();
    });
  });

  describe('delete()', () => {
    it('deve fazer soft-delete em cascade recursivo (DVincula + DTask + DProject)', async () => {
      // Simular requireManagerRole — primeiro findFirst para MANAGER check
      prisma.dVincula.findFirst.mockResolvedValue({ chave: BigInt(1) });
      prisma.dProject.findFirst.mockResolvedValue({ chave: BigInt(1), nome: 'Test' });

      const queryRaw = jest.fn().mockResolvedValue([{ chave: BigInt(1) }]);
      const updateManyTasks = jest.fn().mockResolvedValue({ count: 5 });
      const updateManyVinculos = jest.fn().mockResolvedValue({ count: 2 });
      const updateManyProjects = jest.fn().mockResolvedValue({ count: 1 });

      // O delete() usa $queryRaw (CTE recursiva) dentro da transaction para
      // coletar descendentes (Space + Folders + Lists), depois faz cascade.
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn({
          $queryRaw: queryRaw,
          dTask: { updateMany: updateManyTasks },
          dVincula: { updateMany: updateManyVinculos },
          dProject: { updateMany: updateManyProjects },
        });
      });

      await service.delete('1', BigInt(100));

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // CTE recursiva foi chamada para coletar IDs de descendentes
      expect(queryRaw).toHaveBeenCalledTimes(1);
      // Tasks de todas as Lists coletadas
      expect(updateManyTasks).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ excluido: false }),
          data: { excluido: true },
        }),
      );
      // DVincula (membros) de todos os projetos coletados
      expect(updateManyVinculos).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ excluido: false }),
          data: { excluido: true },
        }),
      );
      // DProject soft-delete de todos os descendentes
      expect(updateManyProjects).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ excluido: false }),
          data: { excluido: true },
        }),
      );
      expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
        'project.deleted',
        expect.objectContaining({ nome: 'Test', projectId: '1' }),
        'test-corr-id',
        expect.objectContaining({ source: 'ProjectsService' }),
      );
    });
  });
});
