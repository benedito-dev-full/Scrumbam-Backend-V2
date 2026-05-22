import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { TasksController } from '../tasks.controller';
import { TasksService } from '../tasks.service';
import { ProjectsService } from '../../projects/projects.service';
import { PhaseTreeService } from '../services/phase-tree.service';
import { PhaseMetricsService } from '../services/phase-metrics.service';
import { AuthCompositeGuard } from '../../auth/guards/auth-composite.guard';
import { CreateTaskDto } from '../dto/create-task.dto';
import { TaskResponseDto } from '../dto/task-response.dto';

/**
 * Specs ADR-V2-050 — POST /tasks com idClasse=-200 (criação de FASE via HTTP).
 *
 * Foco controller-level: contrato HTTP / DTO validation / resposta. A lógica
 * interna do ramo `isPhase` é coberta em
 * `tasks.service.create-phase.spec.ts`. Aqui testamos:
 *
 * 1. POST /tasks { idClasse: '-200' } → 201 com response.idClasse='-200'
 * 2. POST /tasks { idClasse: '-200', idPai } → 201 (sub-fase)
 * 3. POST /tasks { idClasse: '-999' } → ValidationPipe rejeita (400) via @IsIn
 * 4. POST /tasks { ... sem idClasse } → 201 legado (TASK)
 * 5. Ciclo escrita→leitura: cria fase e depois lista com idClasse=-200
 *
 * Decisão deliberada: mocks de PrismaService via TasksService.create (já testado
 * em unit). Não usa banco real (mesma restrição CEO de 2026-05-21).
 *
 * @see plano workspace/plans/plan-tasks-criar-fase-via-http-task2.md
 */
describe('TasksController — POST /tasks { idClasse: -200 } (ADR-V2-050)', () => {
  let controller: TasksController;
  let tasksService: {
    create: jest.Mock;
    findOne: jest.Mock;
    findMany: jest.Mock;
  };

  const PROJECT_ID = '42';
  const USER_ID = '7';
  const ORG_ID = '1';

  const buildReq = () => ({ user: { entidadeId: USER_ID, organizationId: ORG_ID } });

  /**
   * Factory de TaskResponseDto preenche TODOS os campos `!:` para evitar drift
   * de schema. Default `idClasse='-154'` (TASK); override quando necessário.
   */
  const buildTaskResponse = (overrides: Partial<TaskResponseDto>): TaskResponseDto =>
    ({
      id: '0',
      nome: 'unnamed',
      descricao: null,
      projectId: PROJECT_ID,
      idClasse: '-154',
      identifier: 'DEV-0',
      status: 'INBOX',
      priority: null,
      taskType: null,
      assigneeId: null,
      sprintId: null,
      dados: { identifier: 'DEV-0', v3: { state: 'INBOX' } },
      criadoEm: '2026-05-22T00:00:00.000Z',
      atualizadoEm: '2026-05-22T00:00:00.000Z',
      ...overrides,
    }) as TaskResponseDto;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        Reflector,
        {
          provide: TasksService,
          useValue: {
            create: jest.fn(),
            findOne: jest.fn(),
            findMany: jest.fn(),
          },
        },
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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────
  // Helper: simula o ValidationPipe global rodando contra o DTO real.
  // (Não há HTTP server boot aqui — testamos o DTO+pipe isoladamente.)
  // ───────────────────────────────────────────────────────────────────────
  const validateDto = async (raw: Record<string, unknown>) => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    });
    return pipe.transform(raw, { type: 'body', metatype: CreateTaskDto });
  };

  // ── E2E 1: cria PHASE root ──────────────────────────────────────────────
  it('1. POST /tasks { idClasse: -200 } → 201 com response.idClasse=-200', async () => {
    const dto: CreateTaskDto = {
      nome: 'Sprint Q2',
      projectId: PROJECT_ID,
      idClasse: '-200',
    } as CreateTaskDto;

    const phaseResponse = buildTaskResponse({
      id: '100',
      nome: 'Sprint Q2',
      idClasse: '-200',
      identifier: '',
      dados: { kind: 'phase', createdBy: USER_ID },
    });
    tasksService.create.mockResolvedValueOnce(phaseResponse);

    const result = await controller.create(dto, buildReq() as never);

    expect(result.idClasse).toBe('-200');
    expect(result.identifier).toBe('');
    expect(result.id).toBe('100');
    expect(tasksService.create).toHaveBeenCalledWith(dto, BigInt(USER_ID), [PROJECT_ID]);
  });

  // ── E2E 2: cria sub-PHASE (idPai apontando para outra phase) ───────────
  it('2. POST /tasks { idClasse: -200, idPai } → 201 sub-fase', async () => {
    const dto: CreateTaskDto = {
      nome: 'Sub-bloco: Refresh',
      projectId: PROJECT_ID,
      idClasse: '-200',
      idPai: '100',
    } as CreateTaskDto;

    const subPhaseResponse = buildTaskResponse({
      id: '101',
      nome: 'Sub-bloco: Refresh',
      idClasse: '-200',
      identifier: '',
    });
    tasksService.create.mockResolvedValueOnce(subPhaseResponse);

    const result = await controller.create(dto, buildReq() as never);

    expect(result.idClasse).toBe('-200');
    expect(result.id).toBe('101');
    expect(tasksService.create).toHaveBeenCalledWith(
      expect.objectContaining({ idClasse: '-200', idPai: '100' }),
      BigInt(USER_ID),
      [PROJECT_ID],
    );
  });

  // ── E2E 3: idClasse fora da whitelist → ValidationPipe rejeita ──────────
  it('3. POST /tasks { idClasse: -999 } → 400 BadRequest do @IsIn no DTO', async () => {
    // Simulação do ValidationPipe global contra o DTO real
    await expect(
      validateDto({
        nome: 'Tentativa invalida',
        projectId: PROJECT_ID,
        idClasse: '-999',
      }),
    ).rejects.toThrow(BadRequestException);

    // Backup: class-validator direto (defesa em profundidade) — confirma que a
    // mensagem custom do @IsIn está ativa (drift de validation rules detecta aqui).
    const dtoInstance = plainToInstance(CreateTaskDto, {
      nome: 'Tentativa invalida',
      projectId: PROJECT_ID,
      idClasse: '-999',
    });
    const errors = await validate(dtoInstance);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toMatchObject({
      isIn: expect.stringContaining('idClasse deve ser'),
    });

    // O controller NUNCA é chamado nesse caso (ValidationPipe trava antes).
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  // ── E2E 4: backward compat — sem idClasse mantém TASK legado ─────────────
  it('4. POST /tasks { sem idClasse } → 201 legado (TASK -154)', async () => {
    const dto: CreateTaskDto = {
      nome: 'Implementar JWT refresh',
      projectId: PROJECT_ID,
    } as CreateTaskDto;

    const taskResponse = buildTaskResponse({
      id: '50',
      nome: 'Implementar JWT refresh',
      idClasse: '-154',
      identifier: 'DEV-50',
    });
    tasksService.create.mockResolvedValueOnce(taskResponse);

    const result = await controller.create(dto, buildReq() as never);

    expect(result.idClasse).toBe('-154');
    expect(result.identifier).toBe('DEV-50');
    // O DTO NÃO carrega idClasse — o service resolve default internamente
    expect(tasksService.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ idClasse: expect.anything() }),
      BigInt(USER_ID),
      [PROJECT_ID],
    );
  });

  // ── E2E 5: ciclo escrita→leitura — cria fase e depois lista com filtro ──
  it('5. cria PHASE e GET /tasks?idClasse=-200 retorna a fase recém criada', async () => {
    // (a) cria fase
    const dto: CreateTaskDto = {
      nome: 'Bloco Listável',
      projectId: PROJECT_ID,
      idClasse: '-200',
    } as CreateTaskDto;

    const phaseResponse = buildTaskResponse({
      id: '200',
      nome: 'Bloco Listável',
      idClasse: '-200',
      identifier: '',
    });
    tasksService.create.mockResolvedValueOnce(phaseResponse);
    await controller.create(dto, buildReq() as never);

    // (b) lista filtrando por idClasse=-200
    tasksService.findMany.mockResolvedValueOnce({
      items: [phaseResponse],
      pagination: { hasMore: false, nextCursor: null },
    });

    const list = await controller.findMany(
      { projectId: PROJECT_ID, idClasse: '-200' } as never,
      buildReq() as never,
    );

    expect(list.items).toHaveLength(1);
    expect(list.items[0].idClasse).toBe('-200');
    expect(list.items[0].id).toBe('200');
    // findMany recebeu o filtro
    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ idClasse: '-200', projectId: PROJECT_ID }),
      [PROJECT_ID],
    );
  });

  // ── E2E 6 (extra): idClasse aceita '-154' explícito (mesmo equivalente ao default) ──
  it('6. POST /tasks { idClasse: -154 explícito } → 201 TASK (whitelist permite)', async () => {
    const dto: CreateTaskDto = {
      nome: 'Task explícita',
      projectId: PROJECT_ID,
      idClasse: '-154',
    } as CreateTaskDto;

    const taskResponse = buildTaskResponse({
      id: '51',
      nome: 'Task explícita',
      idClasse: '-154',
      identifier: 'DEV-51',
    });
    tasksService.create.mockResolvedValueOnce(taskResponse);

    const result = await controller.create(dto, buildReq() as never);

    expect(result.idClasse).toBe('-154');
    expect(tasksService.create).toHaveBeenCalledWith(
      expect.objectContaining({ idClasse: '-154' }),
      BigInt(USER_ID),
      [PROJECT_ID],
    );
  });
});
