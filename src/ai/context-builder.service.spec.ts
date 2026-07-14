import { ContextBuilderService } from './context-builder.service';
import { PrismaService } from '../prisma.service';
import { TimezoneService } from '../common/services/timezone.service';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';

/**
 * Testes do `ContextBuilderService` — foco na 4a entrada do `Promise.allSettled`
 * (tasks ativas EXECUTING/READY do user) adicionada pos ADR-V2-079.
 *
 * Cobre:
 *  - Tasks ativas presentes → renderizadas na secao volatil "Estado atual".
 *  - `findMany` chamado com `statuses: ['EXECUTING','READY']`, `limit: 5` e
 *    `assigneeId` = user (prova ADR-V2-042 + 1 query multi-status).
 *  - Falha da query de tasks NAO derruba o bloco (secao estavel intacta).
 *  - Escopo vazio (`findAccessibleProjectIds` → []) → sem secao de tasks,
 *    sem hit em `findMany`, sem throw.
 */
describe('ContextBuilderService — tasks ativas no contexto', () => {
  let service: ContextBuilderService;

  let prisma: {
    dEntidade: { findMany: jest.Mock };
    dProject: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let timezoneService: jest.Mocked<Pick<TimezoneService, 'toBrazilTime'>>;
  let tasksService: jest.Mocked<Pick<TasksService, 'findMany'>>;
  let projectsService: jest.Mocked<Pick<ProjectsService, 'findAccessibleProjectIds'>>;

  const USER = BigInt(123);

  beforeEach(() => {
    prisma = {
      dEntidade: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ chave: USER, nome: 'Alice' }]),
      },
      dProject: { findMany: jest.fn().mockResolvedValue([]) },
      // getUnreadCount usa $queryRaw — retorna 0 nao lidas por padrao.
      $queryRaw: jest.fn().mockResolvedValue([{ count: BigInt(0) }]),
    };

    timezoneService = {
      toBrazilTime: jest.fn().mockReturnValue(new Date('2026-07-13T15:00:00-03:00')),
    };

    tasksService = {
      findMany: jest.fn().mockResolvedValue({
        items: [],
        pagination: { hasMore: false, nextCursor: null },
      }),
    };

    projectsService = {
      findAccessibleProjectIds: jest.fn().mockResolvedValue(['10', '20']),
    };

    service = new ContextBuilderService(
      prisma as unknown as PrismaService,
      timezoneService as unknown as TimezoneService,
      tasksService as unknown as TasksService,
      projectsService as unknown as ProjectsService,
    );
  });

  it('renderiza tasks EXECUTING/READY na secao "Estado atual" quando ha itens', async () => {
    tasksService.findMany.mockResolvedValue({
      items: [
        { id: '7', nome: 'Refatorar auth', identifier: 'DEV-7', status: 'EXECUTING' },
        { id: '9', nome: 'Corrigir cache', identifier: 'DEV-9', status: 'READY' },
      ],
      pagination: { hasMore: false, nextCursor: null },
    } as never);

    const block = await service.build(USER);

    expect(block).toContain('## Estado atual');
    expect(block).toContain('Suas tasks ativas (EXECUTING/READY)');
    expect(block).toContain('DEV-7 Refatorar auth — EXECUTING');
    expect(block).toContain('DEV-9 Corrigir cache — READY');
  });

  it('chama findMany com statuses [EXECUTING,READY], limit 5 e assigneeId = user (ADR-V2-042)', async () => {
    await service.build(USER);

    expect(tasksService.findMany).toHaveBeenCalledTimes(1);
    const [query, scoped] = tasksService.findMany.mock.calls[0];
    expect(query.assigneeId).toBe(USER.toString());
    expect(query.statuses).toEqual(['EXECUTING', 'READY']);
    expect(query.limit).toBe(5);
    expect(query.projectIds).toEqual(['10', '20']);
    expect(scoped).toEqual(['10', '20']);
  });

  it('fallback para identifier vazio: usa #id no lugar', async () => {
    tasksService.findMany.mockResolvedValue({
      items: [{ id: '42', nome: 'Fase X', identifier: '', status: 'READY' }],
      pagination: { hasMore: false, nextCursor: null },
    } as never);

    const block = await service.build(USER);

    expect(block).toContain('#42 Fase X — READY');
  });

  it('falha da query de tasks NAO derruba o bloco (secao estavel intacta)', async () => {
    tasksService.findMany.mockRejectedValue(new Error('db down'));

    const block = await service.build(USER);

    // Secao estavel (user) permanece.
    expect(block).toContain('# CONTEXTO ATUAL');
    expect(block).toContain('**Usuario:** Alice');
    expect(block).toContain('## Estado atual');
    // Sem secao de tasks ativas.
    expect(block).not.toContain('Suas tasks ativas');
  });

  it('escopo vazio: sem secao de tasks, sem hit em findMany, sem throw', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValue([]);

    const block = await service.build(USER);

    expect(tasksService.findMany).not.toHaveBeenCalled();
    expect(block).toContain('**Usuario:** Alice');
    expect(block).not.toContain('Suas tasks ativas');
  });

  it('sem tasks ativas (lista vazia): omite a secao mas mantem o bloco', async () => {
    // findMany default retorna items: [] → sem secao.
    const block = await service.build(USER);

    expect(block).toContain('## Estado atual');
    expect(block).not.toContain('Suas tasks ativas');
  });
});
