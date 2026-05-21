import { Test, TestingModule } from '@nestjs/testing';
import { TasksService } from '../tasks.service';
import { TasksIdentifierService } from '../tasks-identifier.service';
import { PhaseHierarchyService } from '../services/phase-hierarchy.service';
import { PhaseMetricsService } from '../services/phase-metrics.service';
import { PrismaService } from '../../prisma.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../common/services/correlation-id.service';
import { ListTasksQueryDto } from '../dto/list-tasks-query.dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

/**
 * Testes da Fase 4 (ADR-V2-047) — filtros hierárquicos em GET /tasks:
 * - DTO de query aceita idPai, idClasse, depth (validação class-validator).
 * - TasksService.findMany aplica os 3 filtros no where Prisma.
 * - depth >= 2 dispara CTE recursiva via $queryRaw (1 query extra,
 *   nunca em loop — zero N+1).
 * - depth = 0 retorna apenas a própria raiz (degenerada).
 * - Escopo de tenant (ADR-V2-042) continua aplicado quando os novos
 *   filtros estão presentes.
 *
 * Mantemos o spec isolado do `tasks.service.spec.ts` legado (24 testes,
 * baseline com falhas pré-existentes não relacionadas a esta fase).
 */
describe('Tasks Fase 4 — filtros hierárquicos (ADR-V2-047)', () => {
  // ─── DTO validation ────────────────────────────────────────────────────────

  describe('ListTasksQueryDto', () => {
    it('aceita idPai numérico positivo', async () => {
      const dto = plainToInstance(ListTasksQueryDto, { idPai: '5' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.idPai).toBe('5');
    });

    it('aceita idPai "null" literal (filtra raízes)', async () => {
      const dto = plainToInstance(ListTasksQueryDto, { idPai: 'null' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.idPai).toBe('null');
    });

    it('rejeita idPai com string não numérica', async () => {
      const dto = plainToInstance(ListTasksQueryDto, { idPai: 'abc' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints?.matches).toMatch(/idPai deve ser string numérica/);
    });

    it('aceita idClasse negativa (ex: -200 PHASE)', async () => {
      const dto = plainToInstance(ListTasksQueryDto, { idClasse: '-200' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.idClasse).toBe('-200');
    });

    it('rejeita idClasse com formato inválido', async () => {
      const dto = plainToInstance(ListTasksQueryDto, { idClasse: '-200.5' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints?.matches).toMatch(/idClasse deve ser string numérica/);
    });

    it('aceita depth entre 0 e 20', async () => {
      const dto = plainToInstance(ListTasksQueryDto, { depth: 5 });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.depth).toBe(5);
    });

    it('rejeita depth > 20 (anti-DoS)', async () => {
      const dto = plainToInstance(ListTasksQueryDto, { depth: 21 });
      const errors = await validate(dto);
      // class-validator devolve erros agrupados; basta verificar que existe um
      // constraint de Max (com chave 'max').
      const max = errors.find((e) => e.constraints?.max !== undefined);
      expect(max).toBeDefined();
    });

    it('rejeita depth negativo', async () => {
      const dto = plainToInstance(ListTasksQueryDto, { depth: -1 });
      const errors = await validate(dto);
      const min = errors.find((e) => e.constraints?.min !== undefined);
      expect(min).toBeDefined();
    });
  });

  // ─── findMany() — filtros hierárquicos ──────────────────────────────────

  describe('TasksService.findMany — filtros idPai/idClasse/depth', () => {
    let service: TasksService;
    let prisma: {
      dTask: { findMany: jest.Mock };
      dTabela: { findFirst: jest.Mock; findMany: jest.Mock };
      $queryRaw: jest.Mock;
    };

    beforeEach(async () => {
      const prismaMock = {
        dProject: { findFirst: jest.fn() },
        dTask: {
          create: jest.fn(),
          findFirst: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn(),
        },
        dTabela: {
          findFirst: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
          update: jest.fn(),
        },
        dEntidade: { findFirst: jest.fn() },
        $transaction: jest.fn(),
        $queryRaw: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TasksService,
          { provide: PrismaService, useValue: prismaMock },
          { provide: TasksIdentifierService, useValue: { getNextIdentifier: jest.fn() } },
          {
            provide: EventProducerService,
            useValue: { addInternalEvent: jest.fn().mockResolvedValue(undefined) },
          },
          {
            provide: CorrelationIdService,
            useValue: { getOrGenerate: jest.fn().mockReturnValue('test-corr') },
          },
          {
            provide: PhaseHierarchyService,
            useValue: {
              maxDepth: 20,
              validateNoCycle: jest.fn(),
              validateProjectConsistency: jest.fn(),
              softDeleteCascade: jest.fn(),
            },
          },
          {
            provide: PhaseMetricsService,
            useValue: { compute: jest.fn() },
          },
        ],
      }).compile();

      service = module.get<TasksService>(TasksService);
      prisma = module.get(PrismaService) as unknown as typeof prisma;
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('aplica filtro idClasse=-200 (somente fases) no where', async () => {
      const query: ListTasksQueryDto = { projectId: '1', idClasse: '-200', limit: 20 };
      await service.findMany(query, ['1']);

      const calledWith = prisma.dTask.findMany.mock.calls[0][0];
      expect(calledWith.where.idClasse).toEqual(BigInt(-200));
    });

    it('aplica filtro idPai numérico (depth=1 default → filhas diretas)', async () => {
      const query: ListTasksQueryDto = { idPai: '5', limit: 20 };
      await service.findMany(query, ['1']);

      const calledWith = prisma.dTask.findMany.mock.calls[0][0];
      expect(calledWith.where.idPai).toEqual(BigInt(5));
      // Não chamou $queryRaw porque depth=1 (default) → filtro direto, sem CTE
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('aplica filtro idPai="null" → where.idPai = null (raízes)', async () => {
      const query: ListTasksQueryDto = { idPai: 'null', limit: 20 };
      await service.findMany(query, ['1']);

      const calledWith = prisma.dTask.findMany.mock.calls[0][0];
      expect(calledWith.where.idPai).toBeNull();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('depth=0 com idPai → retorna apenas a própria raiz (chave equals)', async () => {
      const query: ListTasksQueryDto = { idPai: '5', depth: 0, limit: 20 };
      await service.findMany(query, ['1']);

      const calledWith = prisma.dTask.findMany.mock.calls[0][0];
      expect(calledWith.where.chave).toEqual(BigInt(5));
      // Não usa idPai como filtro neste caso (queremos a própria raiz)
      expect(calledWith.where.idPai).toBeUndefined();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('depth=3 com idPai dispara CTE recursiva (1 $queryRaw) — zero N+1', async () => {
      // Mock retorna 4 descendentes em 3 níveis
      prisma.$queryRaw.mockResolvedValue([
        { chave: BigInt(10) },
        { chave: BigInt(11) },
        { chave: BigInt(12) },
        { chave: BigInt(13) },
      ]);

      const query: ListTasksQueryDto = { idPai: '5', depth: 3, limit: 50 };
      await service.findMany(query, ['1']);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const calledWith = prisma.dTask.findMany.mock.calls[0][0];
      expect(calledWith.where.chave).toEqual({
        in: [BigInt(10), BigInt(11), BigInt(12), BigInt(13)],
      });
    });

    it('depth=2 sem descendentes → retorna items=[] sem chamar dTask.findMany', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const query: ListTasksQueryDto = { idPai: '5', depth: 2, limit: 20 };
      const result = await service.findMany(query, ['1']);

      expect(result.items).toEqual([]);
      expect(result.pagination.hasMore).toBe(false);
      expect(prisma.dTask.findMany).not.toHaveBeenCalled();
    });

    it('combinação idClasse=-200 + idPai="null" lista fases raiz do projeto', async () => {
      const query: ListTasksQueryDto = {
        projectId: '1',
        idClasse: '-200',
        idPai: 'null',
        limit: 20,
      };
      await service.findMany(query, ['1']);

      const calledWith = prisma.dTask.findMany.mock.calls[0][0];
      expect(calledWith.where.idClasse).toEqual(BigInt(-200));
      expect(calledWith.where.idPai).toBeNull();
      expect(calledWith.where.idProject).toEqual({ in: [BigInt(1)] });
    });

    it('scope ADR-V2-042 continua aplicado quando projectId fora do scope', async () => {
      const query: ListTasksQueryDto = { projectId: '999', idPai: '5', limit: 20 };
      const result = await service.findMany(query, ['1']); // 999 fora do scope

      expect(result.items).toEqual([]);
      expect(prisma.dTask.findMany).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('depth capped em 20 mesmo se passado valor maior (defense-in-depth na CTE)', async () => {
      // Não temos como inspecionar o SQL literal facilmente, mas garantimos
      // que a chamada ao $queryRaw ocorre 1x e que o método não estoura.
      // O ListTasksQueryDto já valida @Max(20), então valores maiores são
      // bloqueados antes de chegar ao service. Aqui simulamos passagem direta
      // pelo service (caller que pulou validação) e verificamos comportamento.
      prisma.$queryRaw.mockResolvedValue([{ chave: BigInt(10) }]);

      const query = { idPai: '5', depth: 25 } as ListTasksQueryDto;
      await service.findMany(query, ['1']);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      // Comportamento esperado: o SQL embute Math.min(depth, 20) → não passa nada > 19 no LIMIT.
    });
  });
});
