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
          dProject: { create: jest.fn().mockResolvedValue(mockProject) },
          dVincula: { create: jest.fn().mockResolvedValue({ chave: BigInt(1) }) },
        };
        return fn(txMock);
      });

      // Act
      const result = await service.create(
        { nome: 'Test Project', prefix: 'DEV' },
        BigInt(100),
      );

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
          dProject: { create: jest.fn().mockResolvedValue(mockProject) },
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
      const vinculos = [
        { idLocEscritu: BigInt(1) },
        { idLocEscritu: BigInt(2) },
      ];
      prisma.dVincula.findMany.mockResolvedValue(vinculos);
      prisma.dProject.findMany.mockResolvedValue([mockProject]);
      prisma.dVincula.groupBy.mockResolvedValue([
        { idLocEscritu: BigInt(1), _count: { chave: 2 } },
      ]);

      const result = await service.findMany(BigInt(100), undefined, 1);

      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).toBe('1');
    });
  });

  describe('findOne()', () => {
    it('deve retornar projeto quando usuário é membro', async () => {
      prisma.dProject.findFirst.mockResolvedValue(mockProject);
      prisma.dVincula.findFirst.mockResolvedValue({ chave: BigInt(1) });
      prisma.dVincula.count.mockResolvedValue(3);

      const result = await service.findOne('1', BigInt(100));

      expect(result.id).toBe('1');
      expect(result.memberCount).toBe(3);
    });

    it('deve lançar NotFoundException quando projeto não encontrado', async () => {
      prisma.dProject.findFirst.mockResolvedValue(null);
      prisma.dVincula.findFirst.mockResolvedValue({ chave: BigInt(1) });

      await expect(service.findOne('999', BigInt(100))).rejects.toThrow(NotFoundException);
    });

    it('deve lançar ForbiddenException quando usuário não é membro', async () => {
      prisma.dProject.findFirst.mockResolvedValue(mockProject);
      prisma.dVincula.findFirst.mockResolvedValue(null);

      await expect(service.findOne('1', BigInt(999))).rejects.toThrow(ForbiddenException);
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
