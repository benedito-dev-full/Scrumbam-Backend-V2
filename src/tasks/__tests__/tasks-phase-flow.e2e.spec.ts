import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TasksController } from '../tasks.controller';
import { TasksService } from '../tasks.service';
import { ProjectsService } from '../../projects/projects.service';
import { PhaseTreeService } from '../services/phase-tree.service';
import { PhaseMetricsService } from '../services/phase-metrics.service';
import { AuthCompositeGuard } from '../../auth/guards/auth-composite.guard';
import { CreateTaskDto } from '../dto/create-task.dto';
import { TaskResponseDto } from '../dto/task-response.dto';

/**
 * Testes end-to-end ADR-V2-047 — Fase 10 (cierre do ADR).
 *
 * Estes testes costuram o fluxo controller-level completo do ciclo de vida
 * de uma fase (DTask idClasse=-200) com suas tasks-filhas. O foco e validar
 * o CONTRATO HTTP — entrada/saida dos endpoints — usando mocks de service
 * (mesmo padrao das Fases 3/5/7/8/9). A logica interna (CTE recursiva,
 * validacoes de ciclo, depth guard, cross-project) ja foi exaustivamente
 * coberta em camadas inferiores:
 *
 * - Cenario 2 (Depth guard): {@link ../services/__tests__/phase-hierarchy.service.spec.ts}
 *   Casos 6-7 (`validateNoCycle()` — MAX_PHASE_DEPTH).
 * - Cenario 3 (Ciclo): mesma spec, Casos 2/4/5 (`validateNoCycle()` —
 *   auto-parent, descendente direto, descendente profundo).
 * - Cenario 4 (Cross-project): mesma spec, Caso 12
 *   (`validateProjectConsistency()`).
 *
 * Aqui validamos apenas que esses BadRequestException PROPAGAM corretamente
 * pelo controller (1-linha smoke por cenario), sem duplicar a lógica que
 * já é testada na unidade inferior.
 *
 * O caso central e o Cenario 1 — happy path costurado:
 *   1. POST /tasks (cria fase idClasse=-200)
 *   2. POST /tasks x3 (cria 3 filhas com idPai = fase)
 *   3. GET /tasks/:phaseId/tree (retorna fase + 3 filhas)
 *   4. GET /tasks/:phaseId/metrics (retorna agregacao { total:3, done:1, percent:33.33 })
 *
 * Decisão deliberada: NAO usa banco real nem testcontainers (restrição CEO,
 * 2026-05-21 — "NADA de seed de 500 tasks, testes pesados ficam manualmente
 * em produção"). Mocks de PrismaService via TestingModule, padrao
 * estabelecido nas demais fases.
 */
describe('TasksController — fluxo end-to-end de fase (Fase 10, ADR-V2-047)', () => {
  let controller: TasksController;
  let tasksService: {
    create: jest.Mock;
    findOne: jest.Mock;
  };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let phaseTreeService: { buildTree: jest.Mock };
  let phaseMetricsService: { compute: jest.Mock };

  const PROJECT_ID = '42';
  const PHASE_ID = '100';
  const CHILD_IDS = ['101', '102', '103'];
  const USER_ID = '7';
  const ORG_ID = '1';

  const buildReq = () => ({ user: { entidadeId: USER_ID, organizationId: ORG_ID } });

  /**
   * Factory de TaskResponseDto — preenche os campos obrigatorios do DTO real
   * para evitar drift de schema (qualquer campo novo `!:` no DTO quebra aqui
   * antes do deploy). Campos opcionais defaultam a null ou 'PHASE' conforme tipo.
   */
  const buildTaskResponse = (overrides: Partial<TaskResponseDto>): TaskResponseDto =>
    ({
      id: '0',
      nome: 'unnamed',
      descricao: null,
      projectId: PROJECT_ID,
      identifier: 'DEV-0',
      status: 'INBOX',
      priority: null,
      taskType: 'TASK',
      assigneeId: null,
      dados: { identifier: 'DEV-0', v3: { state: 'INBOX' }, taskType: 'TASK' },
      criadoEm: '2026-05-21T00:00:00.000Z',
      atualizadoEm: '2026-05-21T00:00:00.000Z',
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
          },
        },
        {
          provide: ProjectsService,
          useValue: { findAccessibleProjectIds: jest.fn().mockResolvedValue([PROJECT_ID]) },
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

  // ─── Cenario 1: Happy path costurado (controller-level) ────────────────────

  describe('Cenario 1 — happy path: criar fase, criar 3 filhas, tree, metrics', () => {
    /**
     * Roundtrip completo: cria fase + 3 filhas e em seguida recupera tree e
     * metrics. Valida que o controller orquestra create/findOne/services e
     * que as respostas seguem o contrato (`PhaseTreeResponseDto` e
     * `PhaseMetricsResponseDto`).
     */
    it('cria fase + 3 tasks-filhas e retorna tree+metrics consistentes', async () => {
      // ── 1. Criar fase (idClasse=-200) ────────────────────────────────────
      const phaseDto: CreateTaskDto = {
        nome: 'Fase 1 — Implementacao',
        projectId: PROJECT_ID,
        idClasse: '-200',
      } as CreateTaskDto;

      const phaseResponse = buildTaskResponse({
        id: PHASE_ID,
        nome: 'Fase 1 — Implementacao',
        identifier: 'DEV-100',
        dados: { identifier: 'DEV-100', v3: { state: 'INBOX' }, taskType: 'PHASE' },
      });

      tasksService.create.mockResolvedValueOnce(phaseResponse);

      const phase = await controller.create(phaseDto, buildReq() as never);

      expect(phase.id).toBe(PHASE_ID);
      expect(tasksService.create).toHaveBeenCalledWith(phaseDto, BigInt(USER_ID), [PROJECT_ID]);

      // ── 2. Criar 3 filhas (idPai = phase.id) ─────────────────────────────
      const childResponses = CHILD_IDS.map((id, i) =>
        buildTaskResponse({
          id,
          nome: `Filha ${i + 1}`,
          identifier: `DEV-${id}`,
          status: i === 0 ? 'DONE' : 'INBOX',
        }),
      );

      for (let i = 0; i < CHILD_IDS.length; i++) {
        tasksService.create.mockResolvedValueOnce(childResponses[i]);
        const childDto: CreateTaskDto = {
          nome: `Filha ${i + 1}`,
          projectId: PROJECT_ID,
          idPai: PHASE_ID,
        } as CreateTaskDto;

        const result = await controller.create(childDto, buildReq() as never);
        expect(result.id).toBe(CHILD_IDS[i]);
      }

      expect(tasksService.create).toHaveBeenCalledTimes(1 + CHILD_IDS.length);

      // ── 3. GET /tasks/:phaseId/tree ──────────────────────────────────────
      tasksService.findOne.mockResolvedValueOnce({ id: PHASE_ID, projectId: PROJECT_ID });

      const treePayload = {
        root: {
          id: PHASE_ID,
          nome: 'Fase 1 — Implementacao',
          idClasse: '-200',
          idPai: null,
          status: null,
          depth: 0,
          children: childResponses.map((c, i) => ({
            id: c.id,
            nome: c.nome,
            idClasse: '-201',
            idPai: PHASE_ID,
            status: i === 0 ? 'DONE' : 'INBOX',
            depth: 1,
            children: [],
          })),
        },
        totalNodes: 1 + CHILD_IDS.length,
        maxDepthReached: 1,
      };
      phaseTreeService.buildTree.mockResolvedValueOnce(treePayload);

      const tree = await controller.getTree(PHASE_ID, buildReq() as never, undefined, false);

      expect(tree).toBe(treePayload);
      expect(tasksService.findOne).toHaveBeenCalledWith(PHASE_ID, [PROJECT_ID]);
      expect(phaseTreeService.buildTree).toHaveBeenCalledWith(BigInt(PHASE_ID), {
        maxDepth: undefined,
        includeMetrics: false,
      });
      expect(tree.root.children).toHaveLength(CHILD_IDS.length);

      // ── 4. GET /tasks/:phaseId/metrics ───────────────────────────────────
      tasksService.findOne.mockResolvedValueOnce({ id: PHASE_ID, projectId: PROJECT_ID });

      const metricsPayload = {
        phaseId: PHASE_ID,
        total: 3,
        done: 1,
        failed: 0,
        inProgress: 0,
        pending: 2,
        percent: 33.33,
        recursive: true,
        computedAt: '2026-05-21T00:00:00.000Z',
      };
      phaseMetricsService.compute.mockResolvedValueOnce(metricsPayload);

      const metrics = await controller.getMetrics(PHASE_ID, buildReq() as never, true);

      expect(metrics).toBe(metricsPayload);
      expect(metrics.total).toBe(3);
      expect(metrics.done).toBe(1);
      expect(metrics.percent).toBeCloseTo(33.33, 2);
      expect(phaseMetricsService.compute).toHaveBeenCalledWith(BigInt(PHASE_ID), {
        recursive: true,
      });

      // ── 5. Sanity: tenant gate foi chamado em CADA endpoint protegido ────
      expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledTimes(
        1 + CHILD_IDS.length + 2, // 1 fase + 3 filhas + tree + metrics = 6
      );
    });
  });

  // ─── Cenarios 2/3/4: contrato HTTP — propagacao de BadRequest ─────────────
  //
  // Estes smoke-tests confirmam apenas a PROPAGACAO. A logica que dispara as
  // exceptions e exaustivamente coberta em phase-hierarchy.service.spec.ts
  // (referenciado no JSDoc do describe principal acima).

  describe('Cenario 2 — depth guard runtime (propagacao HTTP)', () => {
    /**
     * Quando o service lança BadRequestException por profundidade
     * (`validateNoCycle()` excede MAX_PHASE_DEPTH=20), o controller propaga
     * sem reembrulhar. Logica em phase-hierarchy.service.spec.ts Caso 7.
     */
    it('propaga BadRequestException do service ao criar task em hierarquia profunda', async () => {
      tasksService.create.mockRejectedValueOnce(
        new BadRequestException(
          'Profundidade resultante (21) excede o limite de 20 niveis (MAX_PHASE_DEPTH).',
        ),
      );

      const dto: CreateTaskDto = {
        nome: 'Filha profunda',
        projectId: PROJECT_ID,
        idPai: PHASE_ID,
      } as CreateTaskDto;

      await expect(controller.create(dto, buildReq() as never)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('Cenario 3 — ciclo runtime (propagacao HTTP)', () => {
    /**
     * Quando o service detecta ciclo via `validateNoCycle()` ao criar ou mover task
     * (tentar mover B para baixo de A, sendo A descendente de B), o
     * BadRequestException propaga limpo. Logica em
     * phase-hierarchy.service.spec.ts Casos 2/4/5.
     *
     * Nota: usamos `create` aqui como proxy do contrato HTTP — o
     * `validateNoCycle` e invocado tanto em create quanto em update; o
     * comportamento de propagacao e identico em ambos os casos.
     */
    it('propaga BadRequestException ao tentar criar relacao que formaria ciclo', async () => {
      tasksService.create.mockRejectedValueOnce(
        new BadRequestException(
          'Operacao criaria ciclo na hierarquia de fases: o pai indicado e descendente da task.',
        ),
      );

      const dto: CreateTaskDto = {
        nome: 'Cycle attempt',
        projectId: PROJECT_ID,
        idPai: PHASE_ID,
      } as CreateTaskDto;

      await expect(controller.create(dto, buildReq() as never)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('Cenario 4 — cross-project (propagacao HTTP)', () => {
    /**
     * Quando `validateProjectConsistency()` rejeita por projetos divergentes
     * (task no projeto A, pai no projeto B), o BadRequestException propaga
     * limpo. Logica em phase-hierarchy.service.spec.ts Caso 12.
     */
    it('propaga BadRequestException ao tentar vincular task com pai de outro projeto', async () => {
      tasksService.create.mockRejectedValueOnce(
        new BadRequestException(
          'Task e seu pai devem pertencer ao mesmo projeto (cross-project move proibido).',
        ),
      );

      const dto: CreateTaskDto = {
        nome: 'Cross-project child',
        projectId: PROJECT_ID,
        idPai: '999',
      } as CreateTaskDto;

      await expect(controller.create(dto, buildReq() as never)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
