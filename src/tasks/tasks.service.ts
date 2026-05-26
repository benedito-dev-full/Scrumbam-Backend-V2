import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';
import { TimezoneService } from '../common/services/timezone.service';
import { TasksIdentifierService } from './tasks-identifier.service';
import { PhaseHierarchyService } from './services/phase-hierarchy.service';
import { validateTransition, isValidState } from './tasks-state-machine';
import { TaskStatus, buildInitialTaskDados } from './schemas/task-dados.schema';
import { PhaseMetricsService } from './services/phase-metrics.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskSprintDto } from './dto/update-task-sprint.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { TaskResponseDto, ListTasksResponseDto, ActiveExecutionDto } from './dto/task-response.dto';

/**
 * idClasse de DTask no seed F1 (classes canônicas V2).
 *
 * ADR-V2-050: deixou de ser usado diretamente no `create()` (substituído pelo
 * `idClasseBigInt` resolvido a partir de `dto.idClasse ?? '-154'`). Mantida
 * como constante semântica de referência — descrita pelo prefixo `_` para
 * evitar TS6133 sem perder a documentação canônica do valor (-154 = SCRUMBAN_TASK
 * no seed F1).
 */
const _ID_CLASSE_TASK = BigInt(-154); // SCRUMBAN_TASK (seed classes.seed.ts)
void _ID_CLASSE_TASK;

/** idClasse PHASE (-200) — agrupador hierárquico de tasks (ADR-V2-047). */
const ID_CLASSE_PHASE = BigInt(-200);

/**
 * Constrói o payload mínimo de `DTask.dados` para uma FASE (idClasse=-200).
 *
 * ADR-V2-050: fase é agrupador hierárquico sem intention própria. Não recebe
 * identifier DEV-N (sequence intacta), não inicializa `v3.state` (sem state
 * machine — status agregado via PhaseMetricsService) e não recebe telemetry
 * ou capture. Apenas `kind` (discriminador) e `createdBy` para audit barato.
 *
 * Mantido como função top-level (não método) para isolar dos helpers de TASK
 * (`buildInitialTaskDados`) e facilitar evolução independente.
 *
 * @param creatorId - chave (string) da DEntidade do criador
 * @returns objeto mínimo a ser serializado em `DTask.dados` (Json)
 */
function buildPhaseDados(creatorId: string): Record<string, unknown> {
  return {
    kind: 'phase',
    createdBy: creatorId,
  };
}

/** Mapa de status string → idClasse DTabela (seed F1). */
const STATUS_TO_TABELA_CLASSE: Record<string, bigint> = {
  INBOX: BigInt(-441),
  READY: BigInt(-442),
  EXECUTING: BigInt(-443),
  DONE: BigInt(-444),
  FAILED: BigInt(-445),
  CANCELLED: BigInt(-446),
  DISCARDED: BigInt(-447),
  VALIDATING: BigInt(-448),
  VALIDATED: BigInt(-449),
};

/**
 * Mapa de priority enum → idClasse DTabela (seed F1).
 * Cada projeto tem 4 DTabelas (uma por idClasse), criadas no bootstrap.
 * Lookup dinâmico via `(idClasse, dEntidadeId=projectId)` resolve a chave runtime.
 */
const PRIORITY_TO_TABELA_CLASSE: Record<string, bigint> = {
  HIGH: BigInt(-421),
  MEDIUM: BigInt(-422),
  LOW: BigInt(-423),
  URGENT: BigInt(-424),
};

/** Inverso de PRIORITY_TO_TABELA_CLASSE — mapeia idClasse string → enum para buildResponse. */
const TABELA_CLASSE_TO_PRIORITY: Record<string, string> = {
  '-421': 'HIGH',
  '-422': 'MEDIUM',
  '-423': 'LOW',
  '-424': 'URGENT',
};

/**
 * idClasses de DPedido que representam executions Claude Code via VPS.
 * -300 = EXECUTION (agrupador), -301 = LOW, -302 = MEDIUM, -303 = HIGH,
 * -304 reservado para variantes futuras. ADR-V2-005 / ADR-V2-006.
 *
 * Usado em `findActiveExecutionsForTasks` para filtrar DPedido cujo
 * `dados.taskId` aponta para uma task carregada. `baixado=false` é o
 * sinal de execução "ainda ativa" — quando o agente conclui (sucesso
 * ou falha), o DPedido é marcado como baixado.
 */
const EXECUTION_CLASS_IDS = [BigInt(-300), BigInt(-301), BigInt(-302), BigInt(-303), BigInt(-304)];

/**
 * Deriva o `riskLevel` (LOW/MEDIUM/HIGH) a partir do `idClasse` do DPedido.
 * Pedidos -300 (agrupador) e -304 (reservado) caem em LOW como fallback
 * conservador — na prática `OperacaoExecucaoClaude` só cria -301/-302/-303.
 *
 * @param idClasse - chave da DClasse do DPedido (BigInt)
 * @returns enum `LOW` | `MEDIUM` | `HIGH`
 */
function deriveRiskLevel(idClasse: bigint): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (idClasse === BigInt(-302)) return 'MEDIUM';
  if (idClasse === BigInt(-303)) return 'HIGH';
  return 'LOW';
}

/**
 * Deriva o `status` simplificado da execução a partir dos campos do DPedido.
 *
 * Regra:
 * - `aprovado=false` → `awaiting_approval` (ainda pendente do gate de risco MEDIUM/HIGH)
 * - `aprovado=true` e `baixado=false` → `running` (em execução pelo agente VPS)
 *
 * Pedidos com `baixado=true` NÃO entram aqui — eles são filtrados no
 * batch lookup (a UI só precisa do lock enquanto a task está ativa).
 *
 * @param row - linha do DPedido com `aprovado` e `baixado`
 * @returns enum de status simplificado para o frontend
 */
function deriveExecutionStatus(row: {
  aprovado: boolean | null;
  baixado: boolean | null;
}): 'queued' | 'running' | 'awaiting_approval' {
  if (row.aprovado === false || row.aprovado === null) return 'awaiting_approval';
  return 'running';
}

/**
 * Service de tasks (DTask).
 *
 * Implementa CRUD completo de tasks com:
 * - Identifier atômico DEV-N via TasksIdentifierService
 * - V3 Intentions: 9 estados + state machine
 * - Telemetria: timestamps de transições + workSessions
 * - Auditoria: DEvento -497 (task.created) + -498 (status.changed)
 *
 * Tabela estrutural — Pilar 1 NÃO se aplica (DTask não é DPedido).
 *
 * @see PrismaService — acesso ao banco
 * @see TasksIdentifierService — geração atômica de identifiers
 * @see validateTransition — state machine V3
 * @see EventProducerService — emissão canônica de eventos (audit pós-commit)
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identifierService: TasksIdentifierService,
    private readonly eventProducer: EventProducerService,
    private readonly correlationIdService: CorrelationIdService,
    private readonly phaseHierarchy: PhaseHierarchyService,
    private readonly phaseMetrics: PhaseMetricsService,
    private readonly timezoneService: TimezoneService,
  ) {}

  /**
   * Cria task com identifier atômico DEV-N e estado inicial INBOX.
   *
   * Transaction atômica:
   * 1. Buscar prefix do DProject.dados
   * 2. identifierService.getNextIdentifier() — incremento atômico em DTabela -475
   * 3. DTask.create() com dados.identifier e dados.v3.state=INBOX
   *
   * Audit DEvento -497 emitido APÓS commit.
   *
   * @param dto - Dados da task (nome, projectId, priority, assigneeId, sprintId)
   * @param creatorId - Chave BigInt da DEntidade do criador
   * @returns TaskResponseDto com identifier e status=INBOX
   *
   * @throws {NotFoundException} Se projeto não encontrado
   *
   * @example
   * ```typescript
   * const task = await service.create({ nome: 'Task 1', projectId: '1' }, BigInt(100));
   * // task.identifier = "DEV-1"
   * // task.status = "INBOX"
   * ```
   */
  async create(
    dto: CreateTaskDto,
    creatorId: bigint,
    accessibleProjectIds?: string[],
  ): Promise<TaskResponseDto> {
    // ADR-V2-050: idClasse opcional no DTO, default -154 (TASK). Whitelist no
    // DTO (`@IsIn(['-154','-200'])`) já bloqueia valores fora do range; aqui
    // resolvemos para BigInt e ramificamos comportamento (PHASE pula identifier,
    // status INBOX e priority; ignora silenciosamente assignee/sprint/taskType).
    const idClasseRequested = dto.idClasse ?? '-154';
    const idClasseBigInt = BigInt(idClasseRequested);
    const isPhase = idClasseBigInt === ID_CLASSE_PHASE;

    if (isPhase) {
      this.logger.log(
        `Criando FASE nome="${dto.nome}" projeto=${dto.projectId} idPai=${dto.idPai ?? 'raiz'}`,
      );
    } else {
      this.logger.log(`Criando task nome="${dto.nome}" no projeto=${dto.projectId}`);
    }

    // ADR-V2-042: validar que o projectId esta no scope autorizado
    // ANTES de qualquer query — anti enumeration.
    if (accessibleProjectIds !== undefined && !accessibleProjectIds.includes(dto.projectId)) {
      this.logger.warn(
        `tenant_mismatch_task_create projectId=${dto.projectId} fora do scope do user=${creatorId}`,
      );
      throw new NotFoundException(`Projeto ${dto.projectId} não encontrado`);
    }

    const projectId = BigInt(dto.projectId);

    // Buscar prefix do projeto
    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { dados: true },
    });

    if (!project) {
      throw new NotFoundException(`Projeto ${dto.projectId} não encontrado`);
    }

    // Validar idPai (ADR-V2-047): pai deve existir, mesmo projeto, sem ciclo.
    // ADR-V2-050: quando filha é PHASE, pai TAMBÉM deve ser PHASE (sub-fase).
    // No create taskId ainda nao existe, entao usamos newParentId apenas
    // para descer a cadeia ascendente e validar profundidade.
    let idPaiBigInt: bigint | null = null;
    if (dto.idPai !== undefined && dto.idPai !== null) {
      idPaiBigInt = BigInt(dto.idPai);

      const paiExiste = await this.prisma.dTask.findFirst({
        where: { chave: idPaiBigInt, excluido: false },
        select: { idProject: true, idClasse: true },
      });
      if (!paiExiste) {
        throw new NotFoundException(`Pai ${dto.idPai} nao encontrado`);
      }

      const paiProjectId = paiExiste.idProject?.toString() ?? null;
      if (paiProjectId !== projectId.toString()) {
        throw new BadRequestException(
          `Cross-project parent nao permitido: task.idProject=${projectId} vs pai.idProject=${paiProjectId}`,
        );
      }

      // ADR-V2-050: sub-fase requer pai com idClasse=-200.
      // (TASK como filha de PHASE OU de TASK é permitida; apenas PHASE como
      // filha de TASK é proibida — fase é macro-estrutural acima da task.)
      if (isPhase && paiExiste.idClasse !== ID_CLASSE_PHASE) {
        throw new BadRequestException(
          `Sub-fase requer pai com idClasse=-200 (recebido idClasse=${paiExiste.idClasse}).`,
        );
      }

      // Profundidade: validateNoCycle aceita newParentId arbitrario e sobe
      // a cadeia ascendente — taskId sentinela aqui e BigInt(0) (nao existe
      // como chave real, portanto nunca colide). Garante MAX_DEPTH.
      await this.phaseHierarchy.validateNoCycle(BigInt(0), idPaiBigInt);
    }

    const projectDados = project.dados as Record<string, unknown> | null;
    const prefix = (projectDados?.prefix as string | null) ?? 'DEV';

    // Identifier escopado fora da transaction para usar no evento de audit.
    // Para FASE permanece null (ADR-V2-050 — sequence DEV-N intacta).
    let createdIdentifier: string | null = isPhase ? null : `${prefix}-?`;

    // ADR-V2-050: logger.warn (telemetria barata) quando frontend manda campos
    // que não fazem sentido para fase. Não bloqueia (reduz fricção de clients
    // genéricos como Telegram/MCP).
    if (isPhase && (dto.assigneeId || dto.sprintId || dto.priority || dto.taskType)) {
      this.logger.warn(
        `create_phase_ignored_fields projectId=${dto.projectId} ` +
          `assignee=${!!dto.assigneeId} sprint=${!!dto.sprintId} ` +
          `priority=${!!dto.priority} taskType=${!!dto.taskType}`,
      );
    }

    const task = await this.prisma.$transaction(async (tx) => {
      // TaskDados (ramo TASK) e Record<string, unknown> (ramo PHASE) são
      // serializados igual via `Prisma.InputJsonValue`; ambos são objetos
      // simples. `unknown` aqui evita conflito de Index signature entre os
      // dois shapes; o cast final para InputJsonValue resolve o tipo.
      let dadosPayload: unknown;
      let inboxStatusChave: bigint | null = null;
      let idPriority: bigint | null = null;

      if (isPhase) {
        // ADR-V2-050: ramo FASE — pula identifier (sequence intacta), pula
        // INBOX status (status agregado via PhaseMetricsService), pula priority.
        dadosPayload = buildPhaseDados(creatorId.toString());
      } else {
        // Ramo TASK — comportamento legado preservado.
        const identifier = await this.identifierService.getNextIdentifier(tx, projectId, prefix);
        createdIdentifier = identifier;

        // Construir dados V3 iniciais
        const taskDados = buildInitialTaskDados(
          identifier,
          creatorId.toString(),
          dto.rawText || dto.source
            ? {
                rawText: dto.rawText,
                source: dto.source as 'telegram' | 'web' | 'api' | 'mcp' | undefined,
              }
            : undefined,
        );

        // Injetar taskType (mantém signature de buildInitialTaskDados inalterada — ADR-V2-001)
        if (dto.taskType) {
          taskDados.taskType = dto.taskType;
        }

        dadosPayload = taskDados;

        // Buscar idStatus para INBOX (DTabela -441 do projeto)
        const inboxStatus = await tx.dTabela.findFirst({
          where: {
            idClasse: BigInt(-441),
            dEntidadeId: projectId,
            excluido: false,
          },
          select: { chave: true },
        });
        inboxStatusChave = inboxStatus?.chave ?? null;

        // Resolver idPriority (lookup DTabela -42X escopado pelo projeto)
        idPriority = dto.priority
          ? await this.resolvePriorityId(tx, projectId, dto.priority)
          : null;
      }

      // Criar DTask
      return tx.dTask.create({
        data: {
          idClasse: idClasseBigInt,
          idProject: projectId,
          nome: dto.nome,
          descricao: dto.descricao ?? null,
          idStatus: isPhase ? null : inboxStatusChave,
          idPriority: isPhase ? null : idPriority,
          idAssignee: isPhase ? null : dto.assigneeId ? BigInt(dto.assigneeId) : null,
          idSprint: isPhase ? null : dto.sprintId ? BigInt(dto.sprintId) : null,
          idCreator: creatorId,
          idPai: idPaiBigInt,
          dados: dadosPayload as Prisma.InputJsonValue,
          // D1 — dueDate como DateTime? (não em `dados` JSON)
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        },
      });
    });

    // Hidratar nome do criador (1 query — DEntidade.chave do JWT)
    const creator = await this.prisma.dEntidade.findFirst({
      where: { chave: creatorId, excluido: false },
      select: { nome: true },
    });

    // Audit APÓS commit — tipo task.created → idClasse=-497 TASK_CREATED
    await this.eventProducer.addInternalEvent(
      'task.created',
      {
        taskId: task.chave.toString(),
        nome: dto.nome,
        identifier: createdIdentifier,
        projectId: dto.projectId,
        userId: creatorId.toString(),
        userName: creator?.nome ?? null,
      },
      this.correlationIdService.getOrGenerate(),
      { source: TasksService.name },
    );

    // ADR-V2-047 Fase 8: phase.created — emite ADICIONAL ao task.created quando
    // a entidade criada é uma fase (idClasse=-200). Webhook trigger separado:
    // assinantes de `task.*` continuam recebendo task.created; assinantes de
    // `phase.*` recebem phase.created.
    if (task.idClasse === ID_CLASSE_PHASE) {
      await this.eventProducer.addInternalEvent(
        'phase.created',
        {
          phaseId: task.chave.toString(),
          nome: dto.nome,
          identifier: createdIdentifier,
          projectId: dto.projectId,
          idPai: task.idPai?.toString() ?? null,
          userId: creatorId.toString(),
          userName: creator?.nome ?? null,
        },
        this.correlationIdService.getOrGenerate(),
        { source: TasksService.name },
      );
    }

    const priorityMap = await this.buildPriorityMap([task.idPriority]);
    return this.buildResponse(task, priorityMap);
  }

  /**
   * Lista tasks com filtros e cursor pagination.
   *
   * **ADR-V2-042 — Tenant isolation defense-in-depth:** este metodo
   * agora exige `accessibleProjectIds` (lista de `DProject.chave` ja
   * autorizados pelo caller) E filtra `DTask.idProject IN
   * (accessibleProjectIds)`. Caller responsavel por resolver projetos
   * acessiveis usando `ProjectsService.findAccessibleProjectIds(userId, orgId)`.
   *
   * Se `accessibleProjectIds` for vazio, retorna lista vazia sem hit no
   * banco — defesa contra JWT orfao ou user sem projetos na org.
   *
   * Quando o caller passa `query.projectId`, ele DEVE estar contido em
   * `accessibleProjectIds` (caller checa). Caso contrario, retorna vazio
   * (defense-in-depth).
   *
   * N+1 ZERO — select seletivo com cursor pagination.
   *
   * @param query - Filtros: projectId, status, assigneeId, sprintId, cursor, limit
   * @param accessibleProjectIds - Lista de `DProject.chave` (BigInt como string)
   *   onde o usuario tem acesso E que pertencem a org ativa. Resolva via
   *   `ProjectsService.findAccessibleProjectIds(userEntidadeId, organizationId)`.
   * @returns Lista paginada de tasks
   *
   * @example
   * ```typescript
   * const allowedIds = await projects.findAccessibleProjectIds(uid, orgId);
   * const { items } = await tasks.findMany({ status: 'INBOX' }, allowedIds);
   * ```
   */
  async findMany(
    query: ListTasksQueryDto,
    accessibleProjectIds: string[],
  ): Promise<ListTasksResponseDto> {
    const take = Math.min(query.limit ?? 20, 100);

    // ADR-V2-042: sem projetos autorizados → retorna vazio sem hit no banco.
    if (!accessibleProjectIds || accessibleProjectIds.length === 0) {
      return { items: [], pagination: { hasMore: false, nextCursor: null } };
    }

    // Filtro projectId precisa estar dentro do scope autorizado. Se nao
    // estiver, retorna vazio (mensagem identica → anti enumeration).
    if (query.projectId && !accessibleProjectIds.includes(query.projectId)) {
      this.logger.warn(
        `tenant_mismatch_tasks_findMany projectId=${query.projectId} nao esta em accessibleProjectIds`,
      );
      return { items: [], pagination: { hasMore: false, nextCursor: null } };
    }

    // Calcular escopo final: se query.projectId esta no scope, restringir a ele.
    // Caso contrario, se query.projectIds vier do MCP, usa a INTERSECCAO.
    let scopedProjectIds: bigint[];
    if (query.projectId) {
      scopedProjectIds = [BigInt(query.projectId)];
    } else if (query.projectIds?.length) {
      const accessibleSet = new Set(accessibleProjectIds);
      scopedProjectIds = query.projectIds
        .filter((id) => accessibleSet.has(id))
        .map((id) => BigInt(id));
      if (scopedProjectIds.length === 0) {
        return { items: [], pagination: { hasMore: false, nextCursor: null } };
      }
    } else {
      scopedProjectIds = accessibleProjectIds.map((id) => BigInt(id));
    }

    // Construir filtro where
    const where: Prisma.DTaskWhereInput = {
      excluido: false,
      idProject: { in: scopedProjectIds },
      ...(query.assigneeId ? { idAssignee: BigInt(query.assigneeId) } : {}),
      ...(query.sprintId ? { idSprint: BigInt(query.sprintId) } : {}),
      ...(query.cursor ? { chave: { lt: BigInt(query.cursor) } } : {}),
    };

    // ADR-V2-047 — Fase 4: filtros hierárquicos.
    // `idClasse` (polimórfico) — string negativa → BigInt.
    if (query.idClasse) {
      where.idClasse = BigInt(query.idClasse);
    }

    // `idPai` — aceita string numérica OU literal "null" (raiz).
    // Quando combinado com `depth >= 2`, expande via CTE recursiva
    // (1 query extra para descobrir os chaves descendentes; nunca em loop).
    if (query.idPai !== undefined) {
      if (query.idPai === 'null') {
        where.idPai = null;
      } else {
        const rootId = BigInt(query.idPai);
        // depth=0 → apenas a própria raiz
        // depth=1 (default quando idPai presente) → filhas diretas
        // depth>=2 → descendentes recursivos limitados por `depth`
        const depth = query.depth ?? 1;

        if (depth === 0) {
          // Combinar com cursor (chave: { lt: cursor }) se já presente.
          if (where.chave && typeof where.chave === 'object') {
            where.chave = { ...(where.chave as Prisma.BigIntFilter), equals: rootId };
          } else {
            where.chave = rootId;
          }
        } else if (depth === 1) {
          where.idPai = rootId;
        } else {
          // CTE recursiva PostgreSQL — descobre todos os descendentes até
          // `depth` níveis e usa o resultado em `chave IN (...)`. Guardrail
          // hardcoded 20 também na CTE (defense-in-depth com MAX_PHASE_DEPTH).
          const cappedDepth = Math.min(depth, 20);
          const descendants = await this.prisma.$queryRaw<Array<{ chave: bigint }>>`
            WITH RECURSIVE descendants AS (
              SELECT chave, 0 AS depth
              FROM "DTask"
              WHERE "idPai" = ${rootId} AND excluido = false

              UNION ALL

              SELECT t.chave, d.depth + 1
              FROM "DTask" t
              INNER JOIN descendants d ON t."idPai" = d.chave
              WHERE t.excluido = false AND d.depth < ${cappedDepth - 1} AND d.depth < 20
            )
            SELECT chave FROM descendants
          `;

          if (descendants.length === 0) {
            return { items: [], pagination: { hasMore: false, nextCursor: null } };
          }

          const descendantIds = descendants.map((d) => d.chave);
          // Combinar com cursor (chave: { lt: cursor }) se já presente.
          if (where.chave && typeof where.chave === 'object') {
            where.chave = {
              ...(where.chave as Prisma.BigIntFilter),
              in: descendantIds,
            };
          } else {
            where.chave = { in: descendantIds };
          }
        }
      }
    }

    // Filtro por status: buscar idStatus das DTabelas correspondentes
    const statuses = query.statuses?.length ? query.statuses : query.status ? [query.status] : [];
    if (statuses.length > 0) {
      const statusClasses = statuses
        .map((status) => STATUS_TO_TABELA_CLASSE[status])
        .filter((statusClass): statusClass is bigint => statusClass !== undefined);
      if (statusClasses.length > 0) {
        // Buscar todas as DTabelas deste status (podem ser de múltiplos projetos)
        const statusTabelas = await this.prisma.dTabela.findMany({
          where: {
            idClasse: { in: statusClasses },
            excluido: false,
            ...(query.projectId ? { dEntidadeId: BigInt(query.projectId) } : {}),
          },
          select: { chave: true },
        });
        const statusIds = statusTabelas.map((s) => s.chave);
        where.idStatus = statusIds.length > 0 ? { in: statusIds } : undefined;
      }
    }

    // D1 — Filtros por dueDate (TimezoneService garante timezone America/Sao_Paulo).
    // Precedência: dueDateToday > dueDateFrom/dueDateTo.
    if (query.dueDateToday) {
      const today = this.timezoneService.getPeriodDates('today');
      where.dueDate = { gte: today.gte, lte: today.lte };
    } else if (query.dueDateFrom || query.dueDateTo) {
      // Usa TimezoneService para garantir corte correto em America/Sao_Paulo.
      // applyDateFilters aceita strings YYYY-MM-DD; quando só um lado está
      // presente, usamos o mesmo valor no extremo ausente para montar o range
      // completo e depois extraímos apenas o lado relevante.
      const from = query.dueDateFrom ?? query.dueDateTo!;
      const to = query.dueDateTo ?? query.dueDateFrom!;
      const range = this.timezoneService.applyDateFilters(from, to);
      const dueDateResult: { gte?: Date; lte?: Date } = {};
      if (query.dueDateFrom) {
        dueDateResult.gte = range.gte;
      }
      if (query.dueDateTo) {
        dueDateResult.lte = range.lte;
      }
      where.dueDate = dueDateResult;
    }

    const tasks = await this.prisma.dTask.findMany({
      where,
      select: {
        chave: true,
        idClasse: true,
        idProject: true,
        idPai: true,
        nome: true,
        descricao: true,
        idStatus: true,
        idPriority: true,
        idAssignee: true,
        idSprint: true,
        dueDate: true,
        dados: true,
        excluido: true,
        criadoEm: true,
        atualizadoEm: true,
      },
      take: take + 1,
      orderBy: { chave: 'desc' },
    });

    const hasMore = tasks.length > take;
    const pageTasks = hasMore ? tasks.slice(0, take) : tasks;

    // Batch lookup do mapa de priority (ZERO N+1 — 1 query para todo o lote)
    const priorityMap = await this.buildPriorityMap(pageTasks.map((t) => t.idPriority));
    // Batch lookup de execuções ativas (1 query para todo o lote — ZERO N+1).
    // Filtra DPedido idClasse=-300..-304 com baixado=false cujo dados.taskId
    // pertence ao lote. Quando ausente, frontend trata task como editável.
    const executionsMap = await this.findActiveExecutionsForTasks(pageTasks.map((t) => t.chave));
    const items = pageTasks.map((t) => this.buildResponse(t, priorityMap, executionsMap));
    const nextCursor = hasMore ? pageTasks[pageTasks.length - 1].chave.toString() : null;

    return { items, pagination: { hasMore, nextCursor } };
  }

  /**
   * Busca task por ID, opcionalmente validando que pertence a um projeto
   * no escopo autorizado do caller (ADR-V2-042).
   *
   * @param id - Chave BigInt da task (string)
   * @param accessibleProjectIds - Quando informado, valida que
   *   `DTask.idProject` esta no scope. Caso contrario, 404 (anti enumeration).
   * @returns TaskResponseDto
   *
   * @throws {NotFoundException} Se task não encontrada ou fora do scope
   *
   * @example
   * ```typescript
   * const task = await service.findOne('7', allowedIds);
   * ```
   */
  async findOne(id: string, accessibleProjectIds?: string[]): Promise<TaskResponseDto> {
    const task = await this.prisma.dTask.findFirst({
      where: { chave: BigInt(id), excluido: false },
    });

    if (!task) {
      throw new NotFoundException(`Task ${id} não encontrada`);
    }

    // ADR-V2-042: tenant check via projectId. Mensagem identica → anti enumeration.
    if (accessibleProjectIds !== undefined) {
      const projectIdStr = task.idProject?.toString() ?? null;
      if (!projectIdStr || !accessibleProjectIds.includes(projectIdStr)) {
        this.logger.warn(
          `tenant_mismatch_task_findOne taskId=${id} projectId=${projectIdStr ?? 'null'} fora do scope`,
        );
        throw new NotFoundException(`Task ${id} não encontrada`);
      }
    }

    const priorityMap = await this.buildPriorityMap([task.idPriority]);
    // Lookup de execução ativa para esta task (1 query — N+1 inexistente).
    // Quando presente, sinaliza que a UI deve travar a task (read-only).
    const executionsMap = await this.findActiveExecutionsForTasks([task.chave]);
    return this.buildResponse(task, priorityMap, executionsMap);
  }

  /**
   * Atualiza campos de task (nome, descrição, priority, assignee).
   *
   * NÃO altera status (usar updateStatus) nem sprint (usar updateSprint).
   *
   * @param id - Chave BigInt da task (string)
   * @param dto - Campos a atualizar
   * @returns TaskResponseDto atualizada
   *
   * @throws {NotFoundException} Se task não encontrada
   *
   * @example
   * ```typescript
   * const task = await service.update('7', { nome: 'Novo título' });
   * ```
   */
  async update(
    id: string,
    dto: UpdateTaskDto,
    accessibleProjectIds?: string[],
  ): Promise<TaskResponseDto> {
    const taskId = BigInt(id);

    const existing = await this.prisma.dTask.findFirst({
      where: { chave: taskId, excluido: false },
      select: { chave: true, dados: true, idProject: true },
    });

    if (!existing) {
      throw new NotFoundException(`Task ${id} não encontrada`);
    }

    // ADR-V2-042: tenant check via projectId
    if (accessibleProjectIds !== undefined) {
      const pid = existing.idProject?.toString() ?? null;
      if (!pid || !accessibleProjectIds.includes(pid)) {
        throw new NotFoundException(`Task ${id} não encontrada`);
      }
    }

    // Merge superficial em `dados` quando taskType ou assignedToAi mudar.
    // Preserva identifier, v3, telemetry, capture, automation intactos.
    const dadosAtuais = (existing.dados as Record<string, unknown> | null) ?? {};
    const isAiAssignee = dto.assigneeId === 'ai';
    const novosDados =
      dto.taskType !== undefined || dto.assigneeId !== undefined
        ? {
            ...dadosAtuais,
            ...(dto.taskType !== undefined ? { taskType: dto.taskType } : {}),
            ...(dto.assigneeId !== undefined ? { assignedToAi: isAiAssignee } : {}),
          }
        : undefined;

    // Resolver idPriority (semântica undefined/null/string):
    //   undefined → não tocar
    //   null      → limpar (idPriority = null)
    //   string    → lookup DTabela do projeto
    let idPriorityUpdate: bigint | null | undefined = undefined;
    if (dto.priority !== undefined) {
      if (dto.priority === null) {
        idPriorityUpdate = null;
      } else if (existing.idProject) {
        idPriorityUpdate = await this.resolvePriorityId(
          this.prisma,
          existing.idProject,
          dto.priority,
        );
      } else {
        this.logger.warn(
          `update: task ${taskId} sem idProject; ignorando priority="${dto.priority}"`,
        );
      }
    }

    // Mover na hierarquia de fases (ADR-V2-047) — semantica:
    //   undefined → nao tocar
    //   null      → mover para raiz (idPai=null)
    //   string    → setar novo pai; valida ciclo + project-consistency
    let idPaiUpdate: bigint | null | undefined = undefined;
    if (dto.idPai !== undefined) {
      if (dto.idPai === null) {
        idPaiUpdate = null;
      } else {
        idPaiUpdate = BigInt(dto.idPai);
        await this.phaseHierarchy.validateNoCycle(taskId, idPaiUpdate);
        await this.phaseHierarchy.validateProjectConsistency(taskId, idPaiUpdate);
      }
    }

    // D1 — semântica ternária para dueDate:
    //   undefined → não tocar o campo
    //   null      → remover a data (dueDate = null)
    //   string    → nova data (parseada para Date)
    let dueDateUpdate: Date | null | undefined = undefined;
    if (dto.dueDate !== undefined) {
      dueDateUpdate = dto.dueDate ? new Date(dto.dueDate) : null;
    }

    const updated = await this.prisma.dTask.update({
      where: { chave: taskId },
      data: {
        ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
        ...(dto.descricao !== undefined ? { descricao: dto.descricao } : {}),
        ...(dto.assigneeId !== undefined
          ? { idAssignee: dto.assigneeId && !isAiAssignee ? BigInt(dto.assigneeId) : null }
          : {}),
        ...(idPriorityUpdate !== undefined ? { idPriority: idPriorityUpdate } : {}),
        ...(idPaiUpdate !== undefined ? { idPai: idPaiUpdate } : {}),
        ...(novosDados !== undefined ? { dados: novosDados as Prisma.InputJsonValue } : {}),
        ...(dueDateUpdate !== undefined ? { dueDate: dueDateUpdate } : {}),
      },
    });

    // ADR-V2-047 Fase 8: phase.updated. Emite quando a task é uma fase
    // (idClasse=-200). Pós-commit (Pilar 7).
    if (updated.idClasse === ID_CLASSE_PHASE) {
      await this.eventProducer.addInternalEvent(
        'phase.updated',
        {
          phaseId: updated.chave.toString(),
          nome: updated.nome,
          projectId: updated.idProject?.toString() ?? null,
          idPai: updated.idPai?.toString() ?? null,
        },
        this.correlationIdService.getOrGenerate(),
        { source: TasksService.name },
      );
    }

    const priorityMap = await this.buildPriorityMap([updated.idPriority]);
    return this.buildResponse(updated, priorityMap);
  }

  /**
   * Move task entre estados V3 (state machine valida a transição).
   *
   * Popula telemetria automaticamente:
   * - READY: seta telemetry.readyAt
   * - EXECUTING: seta telemetry.executingAt + abre workSession
   * - DONE: seta telemetry.doneAt + calcula cycleTime + leadTime + fecha workSession
   *
   * Audit DEvento -498 emitido APÓS commit.
   *
   * @param id - Chave BigInt da task (string)
   * @param dto - Novo status + movedBy
   * @returns TaskResponseDto com novo estado
   *
   * @throws {NotFoundException} Se task não encontrada
   * @throws {BadRequestException} Se transição inválida pelo state machine
   *
   * @example
   * ```typescript
   * const task = await service.updateStatus('7', { status: 'READY' });
   * ```
   */
  async updateStatus(
    id: string,
    dto: UpdateTaskStatusDto,
    actorId?: bigint,
    accessibleProjectIds?: string[],
  ): Promise<TaskResponseDto> {
    const taskId = BigInt(id);

    if (!isValidState(dto.status)) {
      throw new BadRequestException(`Estado inválido: ${dto.status}`);
    }

    const task = await this.prisma.dTask.findFirst({
      where: { chave: taskId, excluido: false },
    });

    if (!task) {
      throw new NotFoundException(`Task ${id} não encontrada`);
    }

    // ADR-V2-042: tenant check via projectId
    if (accessibleProjectIds !== undefined) {
      const pid = task.idProject?.toString() ?? null;
      if (!pid || !accessibleProjectIds.includes(pid)) {
        throw new NotFoundException(`Task ${id} não encontrada`);
      }
    }

    // ADR-V2-048: Fases (idClasse=-200) NÃO têm status próprio — o status é
    // derivado da agregação de tasks-folha descendentes (percent via
    // PhaseMetricsService.compute, F5 do ADR-V2-047). Bloqueamos a tentativa
    // de mover uma fase no board V3 antes de qualquer mutação para evitar:
    //   1. Inconsistência semântica entre `dados.v3.state` e `percent`;
    //   2. Emissão indevida de `phase.completed` sem agregação;
    //   3. Confusão do frontend recursivo que renderiza Fase + Task polimorficamente.
    if (task.idClasse === ID_CLASSE_PHASE) {
      throw new BadRequestException(
        'Fase não tem status próprio — use GET /tasks/:id/metrics para consultar percent agregado.',
      );
    }

    // Ler estado atual dos dados
    const dadosAtuais = (task.dados as Record<string, unknown>) ?? {};
    const v3Atual = dadosAtuais.v3 as { state?: string } | null;
    const fromStatus = (v3Atual?.state ?? 'INBOX') as TaskStatus;
    const toStatus = dto.status as TaskStatus;

    // Validar transição
    validateTransition(fromStatus, toStatus);

    const now = new Date();
    const nowIso = now.toISOString();

    // Atualizar telemetria
    const telemetriaAtual = (dadosAtuais.telemetry as Record<string, unknown>) ?? {};
    const workSessions = (telemetriaAtual.workSessions as Array<Record<string, unknown>>) ?? [];

    const novasTelemetria: Record<string, unknown> = { ...telemetriaAtual };

    switch (toStatus) {
      case 'READY':
        novasTelemetria.readyAt = nowIso;
        break;

      case 'EXECUTING': {
        novasTelemetria.executingAt = nowIso;
        // Abrir nova workSession
        workSessions.push({ startedAt: nowIso, agentId: dto.movedBy ?? null });
        novasTelemetria.workSessions = workSessions;
        break;
      }

      case 'DONE': {
        novasTelemetria.doneAt = nowIso;
        // Fechar workSession aberta
        const openSession = [...workSessions].reverse().find((s) => !s.endedAt);
        if (openSession) {
          openSession.endedAt = nowIso;
          novasTelemetria.workSessions = workSessions;
        }
        // Calcular cycleTime (READY → DONE) e leadTime (INBOX → DONE)
        if (telemetriaAtual.readyAt) {
          novasTelemetria.cycleTime =
            now.getTime() - new Date(telemetriaAtual.readyAt as string).getTime();
        }
        const taskCreatedAt = task.criadoEm;
        novasTelemetria.leadTime = now.getTime() - taskCreatedAt.getTime();
        break;
      }

      default:
        break;
    }

    // Buscar idStatus da DTabela correspondente (no projeto da task)
    let newIdStatus = task.idStatus;
    if (task.idProject) {
      const statusTabela = await this.prisma.dTabela.findFirst({
        where: {
          idClasse: STATUS_TO_TABELA_CLASSE[toStatus],
          dEntidadeId: task.idProject,
          excluido: false,
        },
        select: { chave: true },
      });
      if (statusTabela) {
        newIdStatus = statusTabela.chave;
      }
    }

    const novosDados = {
      ...dadosAtuais,
      v3: {
        state: toStatus,
        movedAt: nowIso,
        movedBy: dto.movedBy ?? null,
      },
      telemetry: novasTelemetria,
    };

    const updated = await this.prisma.dTask.update({
      where: { chave: taskId },
      data: {
        idStatus: newIdStatus,
        dados: novosDados as Prisma.InputJsonValue,
      },
    });

    // Cascatear status para todas as subtarefas descendentes (recursivo via BFS).
    // Não lança erro se a cascata falhar — a task mãe já foi atualizada.
    void this.cascadeStatusToDescendants(taskId, toStatus, newIdStatus, nowIso).catch((err) => {
      this.logger.warn(
        `cascade status falhou para taskId=${taskId.toString()}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    // Hidratar nome do ator quando o controller passa o JWT (actorId).
    let actorName: string | null = null;
    if (actorId) {
      const actor = await this.prisma.dEntidade.findFirst({
        where: { chave: actorId, excluido: false },
        select: { nome: true },
      });
      actorName = actor?.nome ?? null;
    }

    // Audit APÓS commit — tipo task.status.changed → idClasse=-498 TASK_STATUS_CHANGED
    await this.eventProducer.addInternalEvent(
      'task.status.changed',
      {
        taskId: taskId.toString(),
        from: fromStatus,
        to: toStatus,
        ...(actorId && { userId: actorId.toString() }),
        ...(actorName && { userName: actorName }),
        ...(dto.movedBy && { movedBy: dto.movedBy }),
        nome: task.nome,
        identifier: (task.dados as Record<string, unknown> | null)?.identifier ?? null,
      },
      this.correlationIdService.getOrGenerate(),
      { source: TasksService.name },
    );

    // ADR-V2-047 Fase 8: detector de phase.completed.
    // Disparado quando uma TASK FOLHA (não PHASE) muda para DONE e o pai
    // direto cruza 100% de conclusão. Idempotência via snapshot em
    // dados._meta.phaseSnapshotPercent. Falha NÃO propaga (try/catch isolado).
    if (toStatus === 'DONE' && task.idClasse !== ID_CLASSE_PHASE && task.idPai !== null) {
      void this.detectPhaseCompletion(task.idPai, task.idProject).catch((err) => {
        this.logger.warn(
          `phase.completed detector falhou para parent=${task.idPai?.toString()} ` +
            `taskId=${taskId.toString()}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    const priorityMap = await this.buildPriorityMap([updated.idPriority]);
    return this.buildResponse(updated, priorityMap);
  }

  /**
   * Cascateia o status para todos os descendentes de uma task (BFS).
   * Atualiza apenas tasks-folha (idClasse != PHASE). Sem state machine —
   * é uma operação de sincronia visual, não de workflow individual.
   */
  private async cascadeStatusToDescendants(
    parentId: bigint,
    toStatus: string,
    newIdStatus: bigint | null,
    nowIso: string,
  ): Promise<void> {
    const queue: bigint[] = [parentId];

    while (queue.length > 0) {
      const currentIds = queue.splice(0, queue.length);

      const children = await this.prisma.dTask.findMany({
        where: { idPai: { in: currentIds }, excluido: false },
        select: { chave: true, idClasse: true, dados: true },
      });

      if (children.length === 0) break;

      const leafIds = children.filter((c) => c.idClasse !== ID_CLASSE_PHASE).map((c) => c.chave);

      if (leafIds.length > 0) {
        // Atualiza dados.v3.state para cada filho preservando o restante do json
        for (const child of children.filter((c) => c.idClasse !== ID_CLASSE_PHASE)) {
          const dadosAtual = (child.dados as Record<string, unknown>) ?? {};
          const novosDados = {
            ...dadosAtual,
            v3: {
              ...((dadosAtual.v3 as object | null) ?? {}),
              state: toStatus,
              movedAt: nowIso,
              movedBy: 'cascade',
            },
          };
          await this.prisma.dTask.update({
            where: { chave: child.chave },
            data: {
              dados: novosDados as Prisma.InputJsonValue,
              ...(newIdStatus && { idStatus: newIdStatus }),
            },
          });
        }
      }

      // Continua BFS com filhos de qualquer tipo
      queue.push(...children.map((c) => c.chave));
    }
  }

  /**
   * Move task para um sprint diferente.
   *
   * @param id - Chave BigInt da task (string)
   * @param dto - sprintId de destino
   * @returns TaskResponseDto com novo sprint
   *
   * @throws {NotFoundException} Se task não encontrada
   *
   * @example
   * ```typescript
   * const task = await service.updateSprint('7', { sprintId: '2' });
   * ```
   */
  async updateSprint(
    id: string,
    dto: UpdateTaskSprintDto,
    accessibleProjectIds?: string[],
  ): Promise<TaskResponseDto> {
    const taskId = BigInt(id);

    const existing = await this.prisma.dTask.findFirst({
      where: { chave: taskId, excluido: false },
      select: { chave: true, idProject: true },
    });

    if (!existing) {
      throw new NotFoundException(`Task ${id} não encontrada`);
    }

    // ADR-V2-042: tenant check via projectId
    if (accessibleProjectIds !== undefined) {
      const pid = existing.idProject?.toString() ?? null;
      if (!pid || !accessibleProjectIds.includes(pid)) {
        throw new NotFoundException(`Task ${id} não encontrada`);
      }
    }

    const updated = await this.prisma.dTask.update({
      where: { chave: taskId },
      data: { idSprint: BigInt(dto.sprintId) },
    });

    const priorityMap = await this.buildPriorityMap([updated.idPriority]);
    return this.buildResponse(updated, priorityMap);
  }

  /**
   * Soft-delete de task. Cascade opcional para fases (ADR-V2-047).
   *
   * Comportamento de `cascade`:
   * - `undefined` (default): cascade = true se task eh PHASE (idClasse=-200);
   *   false caso contrario.
   * - `true`: cascade explicito — usa `PhaseHierarchyService.softDeleteCascade`
   *   (CTE recursiva — 1 statement marca task + descendentes como `excluido=true`).
   * - `false`: soft-delete somente da task; descendentes ficam orfaos
   *   (`idPai` aponta para task deletada — comportamento intencional para
   *   cenarios de "desvincular" sem destruir).
   *
   * @param id - Chave BigInt da task (string)
   * @param accessibleProjectIds - Scope tenant (ADR-V2-042)
   * @param options - Opcoes (cascade)
   * @returns objeto com contagem de afetados (raiz + descendentes em cascade)
   *
   * @throws {NotFoundException} Se task não encontrada
   *
   * @example
   * ```typescript
   * // Default: cascade ligado se for PHASE
   * await service.delete('7');
   *
   * // Cascade explicito
   * await service.delete('7', undefined, { cascade: true });
   * ```
   */
  async delete(
    id: string,
    accessibleProjectIds?: string[],
    options?: { cascade?: boolean },
  ): Promise<{ affected: number }> {
    const taskId = BigInt(id);

    const existing = await this.prisma.dTask.findFirst({
      where: { chave: taskId, excluido: false },
      select: { chave: true, idProject: true, idClasse: true },
    });

    if (!existing) {
      throw new NotFoundException(`Task ${id} não encontrada`);
    }

    // ADR-V2-042: tenant check via projectId
    if (accessibleProjectIds !== undefined) {
      const pid = existing.idProject?.toString() ?? null;
      if (!pid || !accessibleProjectIds.includes(pid)) {
        throw new NotFoundException(`Task ${id} não encontrada`);
      }
    }

    // Decisao de cascade:
    //   options.cascade definido → respeitar valor explicito
    //   omitido → default = true se task eh PHASE, false caso contrario
    const isPhase = existing.idClasse === ID_CLASSE_PHASE;
    const cascade = options?.cascade !== undefined ? options.cascade : isPhase;

    if (cascade) {
      const result = await this.phaseHierarchy.softDeleteCascade(taskId);
      this.logger.log(
        `Task ${taskId} deletada com cascade (isPhase=${isPhase}); afetados=${result.affected}`,
      );

      // ADR-V2-047 Fase 8: phase.deleted. Emite quando a raiz da árvore
      // deletada é uma fase (cascade=true && isPhase é o caso padrão).
      if (isPhase) {
        await this.eventProducer.addInternalEvent(
          'phase.deleted',
          {
            phaseId: taskId.toString(),
            projectId: existing.idProject?.toString() ?? null,
            cascade: true,
            affected: result.affected,
          },
          this.correlationIdService.getOrGenerate(),
          { source: TasksService.name },
        );
      }

      return result;
    }

    await this.prisma.dTask.update({
      where: { chave: taskId },
      data: { excluido: true },
    });

    this.logger.log(`Task ${taskId} deletada (soft delete sem cascade)`);

    // ADR-V2-047 Fase 8: phase.deleted sem cascade — ainda emite se a task
    // deletada é uma fase. cascade=false signaliza que descendentes ficaram.
    if (isPhase) {
      await this.eventProducer.addInternalEvent(
        'phase.deleted',
        {
          phaseId: taskId.toString(),
          projectId: existing.idProject?.toString() ?? null,
          cascade: false,
          affected: 1,
        },
        this.correlationIdService.getOrGenerate(),
        { source: TasksService.name },
      );
    }

    return { affected: 1 };
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  /**
   * Detector de transição "fase concluída" (ADR-V2-047 — Fase 8).
   *
   * Disparado pelo `updateStatus` quando uma task FOLHA (não PHASE) muda para
   * DONE e tem pai direto. Calcula o `percent` da fase pai (recursivo) e, se
   * cruzou para 100% (não estava em 100% antes), emite `phase.completed`.
   *
   * **Cobertura v1 (limitação conhecida):** apenas o PAI DIRETO da task que
   * mudou. Cadeia ancestral completa (avô, bisavô) não é coberta. Em uma
   * cascata de fases aninhadas, somente o pai mais próximo é avaliado.
   * Cobertura ancestral completa fica para iteração futura.
   *
   * **Idempotência:** o último `percent` calculado para a fase é gravado em
   * `DTask.dados._meta.phaseSnapshotPercent`. Antes de emitir, comparamos o
   * snapshot anterior: se já era 100, NÃO re-emite (evita ruído em
   * transições DONE→READY→DONE). Deep-merge preserva outros campos de `dados`.
   *
   * **Resiliência:** caller invoca via `void this.detectPhaseCompletion(...)
   *   .catch(...)`. Falha aqui NÃO bloqueia o `updateStatus` da task original
   *   (Pilar 7 — eventos pós-persistência; consistência eventual aceitável).
   *
   * **N+1 budget:** ~4 queries no total — (1) findFirst do pai, (2) PhaseMetricsService.compute
   * (que faz sua própria CTE recursiva — ~2 queries internas: pré-query de idProject +
   * CTE), (3) update opcional do snapshot. Performance controlada, sem N+1.
   *
   * @param phaseId - chave do pai direto da task que mudou (`task.idPai`)
   * @param projectId - `task.idProject` da task filha (para payload do evento)
   */
  private async detectPhaseCompletion(phaseId: bigint, projectId: bigint | null): Promise<void> {
    // 1. Buscar snapshot anterior + idClasse do pai (1 query — sem N+1)
    const parent = await this.prisma.dTask.findFirst({
      where: { chave: phaseId, excluido: false },
      select: { chave: true, idClasse: true, dados: true, idProject: true },
    });

    if (!parent) {
      this.logger.debug(`detectPhaseCompletion: pai ${phaseId} não encontrado (soft-deleted?).`);
      return;
    }

    // Cobertura v1: só detecta se o pai direto for uma fase.
    // Se não for, nada a fazer (cadeia ancestral fica fora do escopo).
    if (parent.idClasse !== ID_CLASSE_PHASE) {
      return;
    }

    // 2. Snapshot anterior (idempotência)
    const dadosAtuais = (parent.dados as Record<string, unknown> | null) ?? {};
    const metaAtual = (dadosAtuais._meta as Record<string, unknown> | undefined) ?? {};
    const lastSnapshot = (metaAtual.phaseSnapshotPercent as number | undefined) ?? null;

    if (lastSnapshot === 100) {
      // Já estava em 100 — não re-emite (evita ruído em DONE→READY→DONE).
      this.logger.debug(
        `detectPhaseCompletion: fase ${phaseId} já estava em 100% (snapshot=${lastSnapshot}). Skip.`,
      );
      return;
    }

    // 3. Calcular percent atual via PhaseMetricsService
    const metrics = await this.phaseMetrics.compute(phaseId, { recursive: true });
    const currentPercent = metrics.percent;

    // 4. Atualizar snapshot opportunisticamente (1 query — só quando vale a pena)
    if (currentPercent !== lastSnapshot) {
      const novosDados = {
        ...dadosAtuais,
        _meta: {
          ...metaAtual,
          phaseSnapshotPercent: currentPercent,
          phaseSnapshotAt: new Date().toISOString(),
        },
      };
      await this.prisma.dTask.update({
        where: { chave: phaseId },
        data: { dados: novosDados as Prisma.InputJsonValue },
      });
    }

    // 5. Emitir phase.completed se cruzou para 100% agora
    if (currentPercent === 100) {
      await this.eventProducer.addInternalEvent(
        'phase.completed',
        {
          phaseId: phaseId.toString(),
          projectId: (parent.idProject ?? projectId)?.toString() ?? null,
          percent: 100,
          completedAt: new Date().toISOString(),
          total: metrics.total,
          done: metrics.done,
        },
        this.correlationIdService.getOrGenerate(),
        { source: TasksService.name },
      );

      this.logger.log(
        `phase.completed emitido para fase=${phaseId.toString()} ` +
          `(total=${metrics.total}, done=${metrics.done})`,
      );
    }
  }

  /**
   * Resolve enum de priority (HIGH/MEDIUM/LOW/URGENT) → chave BigInt
   * da DTabela escopada pelo projeto.
   *
   * Padrão paralelo ao Status (DTabela -441..-449 escopada por projectId).
   * As 4 DTabelas PRIORITY são criadas no bootstrap do projeto
   * (SeedBootstrapService) e em backfill idempotente para projetos legados.
   *
   * @param tx - Prisma TransactionClient OU PrismaService
   * @param projectId - Chave BigInt do projeto
   * @param priority - Enum string (HIGH/MEDIUM/LOW/URGENT)
   * @returns chave BigInt da DTabela correspondente, ou null se inválido
   *
   * @throws {BadRequestException} Se priority não mapeia ou DTabela não existe
   *   no projeto (sinal de que bootstrap não rodou — rodar backfill).
   */
  private async resolvePriorityId(
    tx: Prisma.TransactionClient | PrismaService,
    projectId: bigint,
    priority: string,
  ): Promise<bigint | null> {
    const idClassePriority = PRIORITY_TO_TABELA_CLASSE[priority];
    if (!idClassePriority) {
      throw new BadRequestException(
        `Priority "${priority}" inválida — esperado um de: HIGH, MEDIUM, LOW, URGENT`,
      );
    }

    const tabela = await tx.dTabela.findFirst({
      where: {
        idClasse: idClassePriority,
        dEntidadeId: projectId,
        excluido: false,
      },
      select: { chave: true },
    });

    if (!tabela) {
      this.logger.warn(
        `resolvePriorityId: DTabela PRIORITY ${priority} (idClasse=${idClassePriority}) ausente ` +
          `para projeto ${projectId}. Rodar backfill (scripts/backfill-priority-tabelas).`,
      );
      // Fallback silencioso: persiste null em vez de quebrar a operação.
      return null;
    }

    return tabela.chave;
  }

  /**
   * Converte o BigInt persistido em DTask.idPriority → string enum
   * (HIGH/MEDIUM/LOW/URGENT) consultando a DTabela referenciada.
   *
   * Implementação batch para ZERO N+1: recebe um Map pré-resolvido
   * de `idPriorityChave → enum`. Para conveniência em chamadas single,
   * o método `findPriorityEnumMap` constrói o mapa em 1 query.
   *
   * @param idPriority - chave da DTabela (BigInt ou null)
   * @param priorityMap - mapa chave-string → enum (pré-resolvido)
   * @returns string enum ou null
   */
  private mapPriorityEnum(
    idPriority: bigint | null | undefined,
    priorityMap: Map<string, string>,
  ): string | null {
    if (!idPriority) return null;
    return priorityMap.get(idPriority.toString()) ?? null;
  }

  /**
   * Constrói o mapa `chaveDTabela → enum` em 1 query para um conjunto
   * de tasks. Usado em findMany/findOne/create/update para evitar N+1.
   *
   * @param idPriorityValues - lista de idPriority (pode conter null/duplicados)
   * @returns Map<string, string> onde key=`chave.toString()`, value=enum
   */
  private async buildPriorityMap(
    idPriorityValues: Array<bigint | null | undefined>,
  ): Promise<Map<string, string>> {
    const uniqueIds = Array.from(
      new Set(
        idPriorityValues
          .filter((id): id is bigint => id !== null && id !== undefined)
          .map((id) => id.toString()),
      ),
    ).map((s) => BigInt(s));

    if (uniqueIds.length === 0) {
      return new Map();
    }

    const tabelas = await this.prisma.dTabela.findMany({
      where: { chave: { in: uniqueIds }, excluido: false },
      select: { chave: true, idClasse: true },
    });

    const map = new Map<string, string>();
    for (const t of tabelas) {
      const enumValue = TABELA_CLASSE_TO_PRIORITY[t.idClasse.toString()];
      if (enumValue) {
        map.set(t.chave.toString(), enumValue);
      }
    }
    return map;
  }

  /**
   * Constrói um mapa `taskIdString → ActiveExecutionDto` para uma lista de
   * tasks em uma única query, sem N+1.
   *
   * Filtra `DPedido` onde:
   * - `idClasse IN (-300..-304)` — execuções Claude Code (ADR-V2-005/006)
   * - `baixado = false` — ainda ativa (sucesso/falha marca `baixado=true`)
   * - `excluido = false`
   * - `dados ? 'taskId'` — campo JSON presente (filtro grosseiro em SQL)
   *
   * O filtro final `dados.taskId IN (taskIds)` é feito em memória porque
   * o suporte de Prisma para filtros JSON tipados (`path: ['taskId'], in: [...]`)
   * varia entre versões de driver — preferimos um filtro grosseiro estável
   * + matching em memória (overhead irrelevante: o set de executions ativas
   * por org é pequeno, geralmente <10).
   *
   * @param taskIds - lista de chaves de DTask a verificar (BigInt). Vazia ⇒ Map vazio sem hit no banco.
   * @returns Map onde key=`task.chave.toString()`, value=ActiveExecutionDto
   */
  private async findActiveExecutionsForTasks(
    taskIds: bigint[],
  ): Promise<Map<string, ActiveExecutionDto>> {
    const map = new Map<string, ActiveExecutionDto>();
    if (taskIds.length === 0) return map;

    const taskIdStrings = new Set(taskIds.map((id) => id.toString()));

    const pedidos = await this.prisma.dPedido.findMany({
      where: {
        idClasse: { in: EXECUTION_CLASS_IDS },
        baixado: false,
        excluido: false,
        // Filtro grosseiro: garante que `dados.task.id` existe (formato
        // canônico persistido pelo Engine OperacaoExecucaoClaude).
        // O matching exato contra `taskIdStrings` acontece em memória abaixo.
        dados: { path: ['task', 'id'], not: Prisma.AnyNull },
      },
      select: {
        chave: true,
        idClasse: true,
        aprovado: true,
        baixado: true,
        criadoEm: true,
        dados: true,
      },
    });

    for (const p of pedidos) {
      const dados = p.dados as Record<string, unknown> | null;
      // Engine OperacaoExecucaoClaude persiste taskId nested em dados.task.id
      // (string). Acesso defensivo contra estrutura inesperada.
      const task = (dados?.task ?? null) as Record<string, unknown> | null;
      const taskId = task?.id;
      if (typeof taskId !== 'string') continue;
      if (!taskIdStrings.has(taskId)) continue;

      // Se uma task tiver múltiplos DPedido ativos (cenário anômalo), prefere
      // o mais recente — a iteração ordena em memória.
      const existing = map.get(taskId);
      if (existing && new Date(existing.startedAt).getTime() >= p.criadoEm.getTime()) {
        continue;
      }

      map.set(taskId, {
        id: p.chave.toString(),
        status: deriveExecutionStatus(p),
        riskLevel: deriveRiskLevel(p.idClasse),
        startedAt: p.criadoEm.toISOString(),
      });
    }

    return map;
  }

  private buildResponse(
    task: {
      chave: bigint;
      idClasse?: bigint | null;
      idProject?: bigint | null;
      idPai?: bigint | null;
      nome: string;
      descricao?: string | null;
      idStatus?: bigint | null;
      idPriority?: bigint | null;
      idAssignee?: bigint | null;
      idSprint?: bigint | null;
      dueDate?: Date | null;
      dados?: unknown;
      criadoEm: Date;
      atualizadoEm: Date;
    },
    priorityMap?: Map<string, string>,
    executionsMap?: Map<string, ActiveExecutionDto>,
  ): TaskResponseDto {
    const dados = task.dados as Record<string, unknown> | null;
    const v3 = dados?.v3 as { state?: string } | null;
    const identifier = (dados?.identifier as string | null) ?? '';
    const taskType = (dados?.taskType as string | null) ?? null;
    // ADR-V2-050: expor idClasse para o frontend distinguir TASK (-154) de
    // PHASE (-200). Default "-154" preserva semântica para rows legados onde
    // o select não trouxe a coluna (defensivo — todos os callers atuais
    // já trazem idClasse).
    const idClasseStr = task.idClasse?.toString() ?? '-154';
    const taskIdStr = task.chave.toString();

    return {
      id: taskIdStr,
      nome: task.nome,
      descricao: task.descricao ?? null,
      projectId: task.idProject?.toString() ?? '',
      idClasse: idClasseStr,
      identifier,
      status: v3?.state ?? 'INBOX',
      priority: priorityMap ? this.mapPriorityEnum(task.idPriority, priorityMap) : null,
      taskType,
      assigneeId: dados?.assignedToAi ? 'ai' : (task.idAssignee?.toString() ?? null),
      sprintId: task.idSprint?.toString() ?? null,
      idPai: task.idPai?.toString() ?? null,
      // D1 — dueDate como coluna tipada (não em dados JSON)
      dueDate: task.dueDate ? task.dueDate.toISOString() : null,
      dados,
      activeExecution: executionsMap?.get(taskIdStr) ?? null,
      criadoEm: task.criadoEm.toISOString(),
      atualizadoEm: task.atualizadoEm.toISOString(),
    };
  }
}
