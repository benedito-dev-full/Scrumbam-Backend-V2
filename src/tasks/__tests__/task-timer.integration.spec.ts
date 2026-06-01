import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TasksController } from '../tasks.controller';
import { TasksService } from '../tasks.service';
import { ProjectsService } from '../../projects/projects.service';
import { PhaseTreeService } from '../services/phase-tree.service';
import { PhaseMetricsService } from '../services/phase-metrics.service';
import { AuthCompositeGuard } from '../../auth/guards/auth-composite.guard';
import { TaskResponseDto } from '../dto/task-response.dto';

/**
 * Integração controller-level dos 4 endpoints de timer manual (ADR-V2-057).
 *
 * Foco no contrato HTTP: cada handler delega a `TasksService.timer` com a ação
 * correta e o `req.user.entidadeId` (JWT, nunca do body), passando o scope
 * resolvido por `ProjectsService.findAccessibleProjectIds`. Cobre também a
 * propagação dos status 409 (ConflictException) e 404 (NotFoundException /
 * tenant gate). A lógica de domínio é coberta em `task-timer.service.spec.ts`.
 *
 * Mocks de TasksService — sem banco real (restrição CEO).
 */
describe('TasksController — timer manual endpoints (ADR-V2-057)', () => {
  let controller: TasksController;
  let tasksService: { timer: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock };

  const PROJECT_ID = '42';
  const USER_ID = '7';
  const ORG_ID = '1';

  const buildReq = () => ({ user: { entidadeId: USER_ID, organizationId: ORG_ID } });

  const buildTaskResponse = (overrides: Partial<TaskResponseDto> = {}): TaskResponseDto =>
    ({
      id: '100',
      nome: 'Task com timer',
      descricao: null,
      projectId: PROJECT_ID,
      idClasse: '-154',
      identifier: 'DEV-100',
      status: 'EXECUTING',
      priority: null,
      taskType: null,
      assigneeTeamId: null,
      assigneeId: null,
      sprintId: null,
      idPai: null,
      dueDate: null,
      dados: {},
      activeExecution: null,
      timer: {
        running: true,
        runningUserId: USER_ID,
        runningStartedAt: '2026-06-01T13:00:00.000Z',
        totalsByUser: [],
      },
      criadoEm: '2026-06-01T00:00:00.000Z',
      atualizadoEm: '2026-06-01T00:00:00.000Z',
      ...overrides,
    }) as TaskResponseDto;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        Reflector,
        { provide: TasksService, useValue: { timer: jest.fn() } },
        {
          provide: ProjectsService,
          useValue: { findAccessibleProjectIds: jest.fn().mockResolvedValue([PROJECT_ID]) },
        },
        { provide: PhaseTreeService, useValue: { buildTree: jest.fn() } },
        { provide: PhaseMetricsService, useValue: { compute: jest.fn() } },
      ],
    })
      .overrideGuard(AuthCompositeGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TasksController>(TasksController);
    tasksService = module.get(TasksService) as unknown as typeof tasksService;
    projectsService = module.get(ProjectsService) as unknown as typeof projectsService;
  });

  afterEach(() => jest.clearAllMocks());

  it('POST /tasks/:id/timer/start → delega action=start com entidadeId do JWT e scope', async () => {
    tasksService.timer.mockResolvedValue(buildTaskResponse());

    const res = await controller.timerStart('100', buildReq());

    expect(res.timer?.running).toBe(true);
    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(BigInt(USER_ID), ORG_ID);
    expect(tasksService.timer).toHaveBeenCalledWith('100', 'start', BigInt(USER_ID), [PROJECT_ID]);
  });

  it('POST /tasks/:id/timer/pause → delega action=pause', async () => {
    tasksService.timer.mockResolvedValue(buildTaskResponse({ timer: null }));
    await controller.timerPause('100', buildReq());
    expect(tasksService.timer).toHaveBeenCalledWith('100', 'pause', BigInt(USER_ID), [PROJECT_ID]);
  });

  it('POST /tasks/:id/timer/resume → delega action=resume', async () => {
    tasksService.timer.mockResolvedValue(buildTaskResponse());
    await controller.timerResume('100', buildReq());
    expect(tasksService.timer).toHaveBeenCalledWith('100', 'resume', BigInt(USER_ID), [PROJECT_ID]);
  });

  it('POST /tasks/:id/timer/stop → delega action=stop', async () => {
    tasksService.timer.mockResolvedValue(buildTaskResponse({ timer: null }));
    await controller.timerStop('100', buildReq());
    expect(tasksService.timer).toHaveBeenCalledWith('100', 'stop', BigInt(USER_ID), [PROJECT_ID]);
  });

  it('propaga 409 (ConflictException) quando timer já aberto no start', async () => {
    tasksService.timer.mockRejectedValue(new ConflictException('Já existe um timer em andamento'));
    await expect(controller.timerStart('100', buildReq())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('propaga 409 quando não há sessão aberta no pause', async () => {
    tasksService.timer.mockRejectedValue(new ConflictException('Nenhum timer em andamento'));
    await expect(controller.timerPause('100', buildReq())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('propaga 404 (tenant gate) quando task fora do scope', async () => {
    tasksService.timer.mockRejectedValue(new NotFoundException('Task 100 não encontrada'));
    await expect(controller.timerStart('100', buildReq())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('userId vem SEMPRE do JWT — req sem entidadeId no body é irrelevante (anti-fraude)', async () => {
    tasksService.timer.mockResolvedValue(buildTaskResponse());
    // Mesmo que houvesse um "userId" qualquer no payload, o controller usa só o JWT.
    await controller.timerStart('100', { user: { entidadeId: '999', organizationId: ORG_ID } });
    expect(tasksService.timer).toHaveBeenCalledWith('100', 'start', BigInt('999'), [PROJECT_ID]);
  });
});
