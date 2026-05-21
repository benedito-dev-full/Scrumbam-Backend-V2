import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, NotImplementedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TasksController } from '../tasks.controller';
import { TasksService } from '../tasks.service';
import { ProjectsService } from '../../projects/projects.service';
import { PhaseTreeService } from '../services/phase-tree.service';
import { PhaseMetricsService } from '../services/phase-metrics.service';
import { AuthCompositeGuard } from '../../auth/guards/auth-composite.guard';

/**
 * Testes ADR-V2-047 — endpoints de fase no TasksController:
 *
 * - GET /tasks/:id/tree → delega para PhaseTreeService.buildTree
 * - GET /tasks/:id/metrics → delega para PhaseMetricsService.compute
 *
 * Services têm implementação real (CTE recursiva — Fase 5), mas estes
 * testes mockam os services — o foco é o contrato HTTP do controller,
 * não a lógica SQL. Validamos:
 * - Tenant gate executado ANTES do service (findOne com 404 anti-enumeration).
 * - Validação de query params (`maxDepth` 1..20, `includeMetrics` boolean).
 * - Propagação correta de exceptions (erro genérico para mock/teste, método real em prod).
 */
describe('TasksController — endpoints de fase (Fase 4, ADR-V2-047)', () => {
  let controller: TasksController;
  let tasksService: { findOne: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let phaseTreeService: { buildTree: jest.Mock };
  let phaseMetricsService: { compute: jest.Mock };

  const buildReq = () => ({ user: { entidadeId: '100', organizationId: '1' } });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        Reflector,
        {
          provide: TasksService,
          useValue: { findOne: jest.fn().mockResolvedValue({ id: '5', projectId: '1' }) },
        },
        {
          provide: ProjectsService,
          useValue: { findAccessibleProjectIds: jest.fn().mockResolvedValue(['1']) },
        },
        {
          provide: PhaseTreeService,
          useValue: { buildTree: jest.fn() },
        },
        {
          provide: PhaseMetricsService,
          useValue: { compute: jest.fn() },
        },
      ],
    })
      .overrideGuard(AuthCompositeGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TasksController>(TasksController);
    tasksService = module.get(TasksService) as unknown as typeof tasksService;
    projectsService = module.get(ProjectsService) as unknown as typeof projectsService;
    phaseTreeService = module.get(PhaseTreeService) as unknown as typeof phaseTreeService;
    phaseMetricsService = module.get(PhaseMetricsService) as unknown as typeof phaseMetricsService;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── GET /tasks/:id/tree ──────────────────────────────────────────────────

  describe('getTree()', () => {
    it('chama tenant gate (tasksService.findOne) antes do PhaseTreeService', async () => {
      phaseTreeService.buildTree.mockRejectedValue(new NotImplementedException('stub Fase 4'));

      await expect(controller.getTree('5', buildReq() as never, undefined, false)).rejects.toThrow(
        NotImplementedException,
      );

      expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(BigInt(100), '1');
      expect(tasksService.findOne).toHaveBeenCalledWith('5', ['1']);
      expect(phaseTreeService.buildTree).toHaveBeenCalledWith(BigInt(5), {
        maxDepth: undefined,
        includeMetrics: false,
      });
    });

    it('propaga 404 do tenant gate antes de tocar no PhaseTreeService', async () => {
      tasksService.findOne.mockRejectedValue(new NotFoundException('Task 999 não encontrada'));

      await expect(
        controller.getTree('999', buildReq() as never, undefined, false),
      ).rejects.toThrow(NotFoundException);

      expect(phaseTreeService.buildTree).not.toHaveBeenCalled();
    });

    it('rejeita maxDepth fora do range [1..20] com BadRequestException', async () => {
      await expect(controller.getTree('5', buildReq() as never, '0', false)).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.getTree('5', buildReq() as never, '21', false)).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.getTree('5', buildReq() as never, 'abc', false)).rejects.toThrow(
        BadRequestException,
      );

      expect(phaseTreeService.buildTree).not.toHaveBeenCalled();
    });

    it('passa maxDepth=10 quando query "10" é fornecida', async () => {
      phaseTreeService.buildTree.mockResolvedValue({
        root: null,
        totalNodes: 0,
        maxDepthReached: 0,
      });

      await controller.getTree('5', buildReq() as never, '10', true);

      expect(phaseTreeService.buildTree).toHaveBeenCalledWith(BigInt(5), {
        maxDepth: 10,
        includeMetrics: true,
      });
    });

    it('quando service responde, retorna o payload conforme PhaseTreeResponseDto', async () => {
      const payload = {
        root: {
          id: '5',
          nome: 'Fase 1',
          idClasse: '-200',
          idPai: null,
          status: null,
          depth: 0,
          children: [],
        },
        totalNodes: 1,
        maxDepthReached: 0,
      };
      phaseTreeService.buildTree.mockResolvedValue(payload);

      const result = await controller.getTree('5', buildReq() as never, undefined, false);
      expect(result).toBe(payload);
    });
  });

  // ─── GET /tasks/:id/metrics ───────────────────────────────────────────────

  describe('getMetrics()', () => {
    it('aplica tenant gate antes do PhaseMetricsService', async () => {
      phaseMetricsService.compute.mockRejectedValue(new NotImplementedException('stub Fase 4'));

      await expect(controller.getMetrics('5', buildReq() as never, true)).rejects.toThrow(
        NotImplementedException,
      );

      expect(tasksService.findOne).toHaveBeenCalledWith('5', ['1']);
      expect(phaseMetricsService.compute).toHaveBeenCalledWith(BigInt(5), { recursive: true });
    });

    it('default recursive=true quando query omitida (ParseBoolPipe default)', async () => {
      phaseMetricsService.compute.mockResolvedValue({
        phaseId: '5',
        total: 0,
        done: 0,
        failed: 0,
        inProgress: 0,
        pending: 0,
        percent: 0,
        recursive: true,
        computedAt: new Date().toISOString(),
      });

      // Chamada do controller passando o default explicitamente (como o pipe faria)
      await controller.getMetrics('5', buildReq() as never, true);

      expect(phaseMetricsService.compute).toHaveBeenCalledWith(BigInt(5), { recursive: true });
    });

    it('recursive=false é honrado e propagado para o service', async () => {
      phaseMetricsService.compute.mockResolvedValue({
        phaseId: '5',
        total: 5,
        done: 1,
        failed: 0,
        inProgress: 1,
        pending: 3,
        percent: 20,
        recursive: false,
        computedAt: new Date().toISOString(),
      });

      const result = await controller.getMetrics('5', buildReq() as never, false);

      expect(phaseMetricsService.compute).toHaveBeenCalledWith(BigInt(5), { recursive: false });
      expect(result.recursive).toBe(false);
    });

    it('propaga 404 do tenant gate antes do PhaseMetricsService', async () => {
      tasksService.findOne.mockRejectedValue(new NotFoundException('Task fora do scope'));

      await expect(controller.getMetrics('999', buildReq() as never, true)).rejects.toThrow(
        NotFoundException,
      );

      expect(phaseMetricsService.compute).not.toHaveBeenCalled();
    });
  });
});
