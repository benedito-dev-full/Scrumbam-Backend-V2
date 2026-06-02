import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CommentTargetResolver } from './comment-target.resolver';
import { CommentTargetType } from './dto/comment-target-type.enum';
import { PrismaService } from '../prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { RoleResolverService } from '../auth/services/role-resolver.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';
import { EVENT_TYPES } from '../eventos/core/event-types';

/**
 * Specs polimórficos do `CommentsService` (Fase 4 — T4.1 do plano
 * `2026-05-27-ia-tools-backend.md`).
 *
 * Cobre 10 cenários:
 *  1–4. POST sucesso nos 4 targetTypes (task, project, folder, list).
 *  5–6. POST 404 para task/project inexistentes (anti-enumeration).
 *  7.   POST 403 sem acesso (task via projectIds; project via DVincula).
 *  8.   POST 400 com targetType inválido (defesa em profundidade).
 *  9.   GET cursor pagination correto + zero N+1 + filtra excluído.
 *  10.  POST 404 cross-tenant (fix M1 da Fase 2.1).
 *
 * Mocks usam padrão do `projects.service.spec.ts` (objeto literal com
 * `jest.fn()` por método; `useValue` no `Test.createTestingModule`).
 *
 * O `CommentTargetResolver` é instanciado real (não mockado) — assim os
 * cenários #5/#6/#7/#10 exercitam o resolver de verdade, dando cobertura
 * indireta do tenant isolation simétrico (ADR-V2-042) sem precisar de
 * `comment-target.resolver.spec.ts` adicional.
 */
describe('CommentsService', () => {
  let service: CommentsService;
  let prisma: jest.Mocked<{
    dEvento: {
      create: jest.Mock;
      findMany: jest.Mock;
    };
    dTask: {
      findFirst: jest.Mock;
    };
    dProject: {
      findFirst: jest.Mock;
    };
    dVincula: {
      findFirst: jest.Mock;
    };
  }>;
  let projectsService: jest.Mocked<{ findAccessibleProjectIds: jest.Mock }>;
  let roleResolver: jest.Mocked<{ getProjectRole: jest.Mock }>;
  let eventProducer: jest.Mocked<{ addInternalEvent: jest.Mock }>;
  let correlationIdService: jest.Mocked<{ getOrGenerate: jest.Mock }>;

  const REQUESTER_ID = BigInt(42);
  const ORG_ID = '50';
  const ORG_ID_BIG = BigInt(ORG_ID);

  /** Helper: monta evento "como vem do Prisma" para mockResolvedValue. */
  function buildEvento(
    overrides: Partial<{
      chave: bigint;
      identificadorExterno: string | null;
      descricao: string | null;
      criadoEm: Date;
      idEntidade: bigint | null;
      entidade: { chave: bigint; nome: string | null } | null;
    }> = {},
  ) {
    return {
      chave: BigInt(1000),
      idClasse: BigInt(-507),
      identificadorExterno: '777',
      descricao: 'comentário de teste',
      metaDados: { targetType: 'task', targetId: '777', autorId: '42' },
      criadoEm: new Date('2026-05-27T18:30:00.000Z'),
      idEntidade: REQUESTER_ID,
      entidade: { chave: REQUESTER_ID, nome: 'Joao Silva' },
      excluido: false,
      ...overrides,
    };
  }

  beforeEach(async () => {
    const prismaMock = {
      dEvento: { create: jest.fn(), findMany: jest.fn() },
      dTask: { findFirst: jest.fn() },
      dProject: { findFirst: jest.fn() },
      dVincula: { findFirst: jest.fn() },
    };
    const projectsServiceMock = {
      findAccessibleProjectIds: jest.fn(),
    };
    const roleResolverMock = {
      getProjectRole: jest.fn(),
    };
    const eventProducerMock = {
      addInternalEvent: jest.fn().mockResolvedValue(undefined),
    };
    const correlationIdMock = {
      getOrGenerate: jest.fn().mockReturnValue('test-correlation-id'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        CommentTargetResolver,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ProjectsService, useValue: projectsServiceMock },
        { provide: RoleResolverService, useValue: roleResolverMock },
        { provide: EventProducerService, useValue: eventProducerMock },
        { provide: CorrelationIdService, useValue: correlationIdMock },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
    prisma = module.get(PrismaService) as typeof prisma;
    projectsService = module.get(ProjectsService) as typeof projectsService;
    roleResolver = module.get(RoleResolverService) as typeof roleResolver;
    eventProducer = module.get(EventProducerService) as typeof eventProducer;
    correlationIdService = module.get(CorrelationIdService) as typeof correlationIdService;
    void correlationIdService;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===================================================================
  // CENÁRIOS 1-4: Happy paths — cobertura polimórfica nos 4 targetTypes
  // ===================================================================
  describe('create — happy paths nos 4 targetTypes', () => {
    it('#1 cria comentário em TASK e emite evento APÓS persistência', async () => {
      // resolveAndAuthorize (task path)
      prisma.dTask.findFirst.mockResolvedValue({
        chave: BigInt(777),
        idProject: BigInt(100),
      });
      prisma.dProject.findFirst.mockResolvedValue({
        chave: BigInt(100),
        idEstab: ORG_ID_BIG,
      });
      projectsService.findAccessibleProjectIds.mockResolvedValue(['100']);

      // ordem APÓS persistência — capturamos para assert
      const createCallOrder: string[] = [];
      prisma.dEvento.create.mockImplementation(() => {
        createCallOrder.push('create');
        return Promise.resolve(buildEvento());
      });
      eventProducer.addInternalEvent.mockImplementation(() => {
        createCallOrder.push('event');
        return Promise.resolve(undefined);
      });

      const result = await service.create(
        CommentTargetType.TASK,
        '777',
        { texto: 'comentário de teste' },
        REQUESTER_ID,
        ORG_ID,
      );

      // DTO esperado
      expect(result).toEqual({
        id: '1000',
        texto: 'comentário de teste',
        targetType: CommentTargetType.TASK,
        targetId: '777',
        autorId: '42',
        autorNome: 'Joao Silva',
        createdAt: '2026-05-27T18:30:00.000Z',
      });

      // DEvento criado com payload exato
      expect(prisma.dEvento.create).toHaveBeenCalledWith({
        data: {
          idClasse: BigInt(-507),
          idEntidade: REQUESTER_ID,
          identificadorExterno: '777',
          descricao: 'comentário de teste',
          metaDados: { targetType: 'task', targetId: '777', autorId: '42' },
        },
        include: {
          entidade: { select: { chave: true, nome: true } },
        },
      });

      // Evento APÓS persistência (Pilar 7)
      expect(createCallOrder).toEqual(['create', 'event']);
      expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
        EVENT_TYPES.TASK_COMMENT_CREATED,
        expect.objectContaining({
          commentId: '1000',
          targetType: CommentTargetType.TASK,
          targetId: '777',
          autorId: '42',
        }),
        'test-correlation-id',
      );
    });

    it('#2 cria comentário em PROJECT (acesso via RoleResolverService)', async () => {
      prisma.dProject.findFirst.mockResolvedValue({
        chave: BigInt(200),
        idEstab: ORG_ID_BIG,
      });
      roleResolver.getProjectRole.mockResolvedValue('MEMBER');
      prisma.dEvento.create.mockResolvedValue(
        buildEvento({
          chave: BigInt(1001),
          identificadorExterno: '200',
        }),
      );

      const result = await service.create(
        CommentTargetType.PROJECT,
        '200',
        { texto: 'projeto OK' },
        REQUESTER_ID,
        ORG_ID,
      );

      expect(result.targetType).toBe(CommentTargetType.PROJECT);
      expect(result.targetId).toBe('200');

      // Resolver delega acesso ao resolvedor central (herda público + ORG_ADMIN).
      expect(roleResolver.getProjectRole).toHaveBeenCalledWith(REQUESTER_ID, BigInt(200));
    });

    it('#3 cria comentário em FOLDER (idClasse=-351)', async () => {
      prisma.dProject.findFirst.mockResolvedValue({
        chave: BigInt(351),
        idEstab: ORG_ID_BIG,
      });
      roleResolver.getProjectRole.mockResolvedValue('MEMBER');
      prisma.dEvento.create.mockResolvedValue(
        buildEvento({ chave: BigInt(1002), identificadorExterno: '351' }),
      );

      const result = await service.create(
        CommentTargetType.FOLDER,
        '351',
        { texto: 'folder ok' },
        REQUESTER_ID,
        ORG_ID,
      );

      expect(result.targetType).toBe(CommentTargetType.FOLDER);
      // Resolver filtrou DProject por idClasse=-351
      expect(prisma.dProject.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            chave: BigInt(351),
            excluido: false,
            idClasse: BigInt(-351),
          }),
        }),
      );
    });

    it('#4 cria comentário em LIST (idClasse=-352)', async () => {
      prisma.dProject.findFirst.mockResolvedValue({
        chave: BigInt(352),
        idEstab: ORG_ID_BIG,
      });
      roleResolver.getProjectRole.mockResolvedValue('MEMBER');
      prisma.dEvento.create.mockResolvedValue(
        buildEvento({ chave: BigInt(1003), identificadorExterno: '352' }),
      );

      const result = await service.create(
        CommentTargetType.LIST,
        '352',
        { texto: 'list ok' },
        REQUESTER_ID,
        ORG_ID,
      );

      expect(result.targetType).toBe(CommentTargetType.LIST);
      expect(prisma.dProject.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            chave: BigInt(352),
            excluido: false,
            idClasse: BigInt(-352),
          }),
        }),
      );
    });
  });

  // ===================================================================
  // CENÁRIOS 5-6: Erros de existência → 404 anti-enumeration
  // ===================================================================
  describe('create — 404 quando alvo não existe', () => {
    it('#5 lança NotFoundException quando task não existe', async () => {
      prisma.dTask.findFirst.mockResolvedValue(null);

      await expect(
        service.create(CommentTargetType.TASK, '999', { texto: 'orfão' }, REQUESTER_ID, ORG_ID),
      ).rejects.toThrow(NotFoundException);

      // Garante que NÃO persistiu nem emitiu evento
      expect(prisma.dEvento.create).not.toHaveBeenCalled();
      expect(eventProducer.addInternalEvent).not.toHaveBeenCalled();
    });

    it('#6 lança NotFoundException quando project não existe', async () => {
      prisma.dProject.findFirst.mockResolvedValue(null);

      await expect(
        service.create(CommentTargetType.PROJECT, '888', { texto: 'orfão' }, REQUESTER_ID, ORG_ID),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.dEvento.create).not.toHaveBeenCalled();
      expect(eventProducer.addInternalEvent).not.toHaveBeenCalled();
    });
  });

  // ===================================================================
  // CENÁRIO 7: RBAC — 403 sem acesso (task + project)
  // ===================================================================
  describe('create — 403 quando requester sem acesso', () => {
    it('#7a lança ForbiddenException em task quando projeto não está em accessibleProjectIds', async () => {
      prisma.dTask.findFirst.mockResolvedValue({
        chave: BigInt(777),
        idProject: BigInt(100),
      });
      prisma.dProject.findFirst.mockResolvedValue({
        chave: BigInt(100),
        idEstab: ORG_ID_BIG,
      });
      // requester só vê outros projetos — 100 NÃO está na lista
      projectsService.findAccessibleProjectIds.mockResolvedValue(['200', '300']);

      await expect(
        service.create(
          CommentTargetType.TASK,
          '777',
          { texto: 'sem acesso' },
          REQUESTER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.dEvento.create).not.toHaveBeenCalled();
    });

    it('#7b lança ForbiddenException em project quando getProjectRole retorna null (sem acesso)', async () => {
      prisma.dProject.findFirst.mockResolvedValue({
        chave: BigInt(200),
        idEstab: ORG_ID_BIG,
      });
      roleResolver.getProjectRole.mockResolvedValue(null);

      await expect(
        service.create(
          CommentTargetType.PROJECT,
          '200',
          { texto: 'sem vínculo' },
          REQUESTER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.dEvento.create).not.toHaveBeenCalled();
    });
  });

  // ===================================================================
  // CENÁRIO 8: Validação — targetType inválido → 400
  // ===================================================================
  describe('create — 400 targetType inválido', () => {
    it('#8 lança BadRequestException quando targetType não está no enum (defesa em profundidade)', async () => {
      // Simula bypass do ParseEnumPipe (chamada interna burlando o controller).
      const invalidType = 'foo' as CommentTargetType;

      await expect(
        service.create(invalidType, '777', { texto: 'inválido' }, REQUESTER_ID, ORG_ID),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.dEvento.create).not.toHaveBeenCalled();
    });
  });

  // ===================================================================
  // CENÁRIO 9: findMany — cursor pagination + zero N+1 + exclui excluído
  // ===================================================================
  describe('findMany — cursor pagination + zero N+1 + soft-delete filter', () => {
    it('#9 retorna 20 items com nextCursor (chave do 20º) quando há 21+ — exclui soft-deleted e usa JOIN para autor', async () => {
      // Setup do resolver (task acessível) — reutilizamos os mocks do path TASK
      prisma.dTask.findFirst.mockResolvedValue({
        chave: BigInt(777),
        idProject: BigInt(100),
      });
      prisma.dProject.findFirst.mockResolvedValue({
        chave: BigInt(100),
        idEstab: ORG_ID_BIG,
      });
      projectsService.findAccessibleProjectIds.mockResolvedValue(['100']);

      // 21 eventos (limit=20 + 1 sentinela "hasMore")
      const eventos = Array.from({ length: 21 }, (_, i) =>
        buildEvento({
          chave: BigInt(2000 - i), // DESC: 2000, 1999, ..., 1980
          identificadorExterno: '777',
          descricao: `comentário ${i}`,
        }),
      );
      prisma.dEvento.findMany.mockResolvedValue(eventos);

      const result = await service.findMany(
        CommentTargetType.TASK,
        '777',
        { limit: 20 },
        REQUESTER_ID,
        ORG_ID,
      );

      // 20 items retornados (último descartado, vira sentinela do nextCursor)
      expect(result.items).toHaveLength(20);
      // nextCursor = chave do 20º item (NÃO do 21º)
      expect(result.nextCursor).toBe('1981');

      // Verifica chamada do findMany — exclui soft-deleted, ordena DESC, JOIN com entidade
      expect(prisma.dEvento.findMany).toHaveBeenCalledWith({
        where: {
          idClasse: BigInt(-507),
          identificadorExterno: '777',
          excluido: false,
        },
        include: {
          entidade: { select: { chave: true, nome: true } },
        },
        take: 21,
        orderBy: { chave: 'desc' },
      });

      // Autor já vem na mesma query (zero N+1) — confirmado pelo DTO mapeado
      expect(result.items[0].autorNome).toBe('Joao Silva');
    });

    it('#9b retorna nextCursor=null quando há menos items que o limit', async () => {
      prisma.dTask.findFirst.mockResolvedValue({
        chave: BigInt(777),
        idProject: BigInt(100),
      });
      prisma.dProject.findFirst.mockResolvedValue({
        chave: BigInt(100),
        idEstab: ORG_ID_BIG,
      });
      projectsService.findAccessibleProjectIds.mockResolvedValue(['100']);

      prisma.dEvento.findMany.mockResolvedValue([
        buildEvento({ chave: BigInt(2000) }),
        buildEvento({ chave: BigInt(1999) }),
      ]);

      const result = await service.findMany(
        CommentTargetType.TASK,
        '777',
        { limit: 20 },
        REQUESTER_ID,
        ORG_ID,
      );

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
    });
  });

  // ===================================================================
  // CENÁRIO 10: Tenant isolation simétrico (Fase 2.1 — fix M1)
  // ===================================================================
  describe('tenant isolation simétrico (Fase 2.1)', () => {
    it('#10 lança NotFoundException (não Forbidden) quando task pertence a projeto cross-tenant com orgId informado', async () => {
      prisma.dTask.findFirst.mockResolvedValue({
        chave: BigInt(777),
        idProject: BigInt(100),
      });
      // Projeto existe MAS pertence a outra org
      prisma.dProject.findFirst.mockResolvedValue({
        chave: BigInt(100),
        idEstab: BigInt(999), // ≠ ORG_ID_BIG (50)
      });

      await expect(
        service.create(
          CommentTargetType.TASK,
          '777',
          { texto: 'cross-tenant' },
          REQUESTER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(NotFoundException);

      // NÃO chega a checar accessibleProjectIds (404 antes)
      expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
      expect(prisma.dEvento.create).not.toHaveBeenCalled();
    });
  });
});
