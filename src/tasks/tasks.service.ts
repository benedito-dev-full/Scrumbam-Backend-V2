import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';
import { TasksIdentifierService } from './tasks-identifier.service';
import { validateTransition, isValidState } from './tasks-state-machine';
import { TaskStatus, buildInitialTaskDados } from './schemas/task-dados.schema';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskSprintDto } from './dto/update-task-sprint.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { TaskResponseDto, ListTasksResponseDto } from './dto/task-response.dto';

/** idClasse de DTask no seed F1 (classes canônicas V2). */
const ID_CLASSE_TASK = BigInt(-154); // SCRUMBAN_TASK (seed classes.seed.ts)

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
  async create(dto: CreateTaskDto, creatorId: bigint): Promise<TaskResponseDto> {
    this.logger.log(`Criando task nome="${dto.nome}" no projeto=${dto.projectId}`);

    const projectId = BigInt(dto.projectId);

    // Buscar prefix do projeto
    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { dados: true },
    });

    if (!project) {
      throw new NotFoundException(`Projeto ${dto.projectId} não encontrado`);
    }

    const projectDados = project.dados as Record<string, unknown> | null;
    const prefix = (projectDados?.prefix as string | null) ?? 'DEV';

    // Identifier escopado fora da transaction para usar no evento de audit
    let createdIdentifier = `${prefix}-?`;

    const task = await this.prisma.$transaction(async (tx) => {
      // Gerar identifier atômico
      const identifier = await this.identifierService.getNextIdentifier(tx, projectId, prefix);
      createdIdentifier = identifier;

      // Construir dados V3 iniciais
      const dadosPayload = buildInitialTaskDados(
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
        dadosPayload.taskType = dto.taskType;
      }

      // Buscar idStatus para INBOX (DTabela -441 do projeto)
      const inboxStatus = await tx.dTabela.findFirst({
        where: {
          idClasse: BigInt(-441),
          dEntidadeId: projectId,
          excluido: false,
        },
        select: { chave: true },
      });

      // Criar DTask
      return tx.dTask.create({
        data: {
          idClasse: ID_CLASSE_TASK,
          idProject: projectId,
          nome: dto.nome,
          descricao: dto.descricao ?? null,
          idStatus: inboxStatus?.chave ?? null,
          idAssignee: dto.assigneeId ? BigInt(dto.assigneeId) : null,
          idSprint: dto.sprintId ? BigInt(dto.sprintId) : null,
          idCreator: creatorId,
          dados: dadosPayload as Prisma.InputJsonValue,
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

    return this.buildResponse(task);
  }

  /**
   * Lista tasks com filtros e cursor pagination.
   *
   * N+1 ZERO — select seletivo com cursor pagination.
   *
   * @param query - Filtros: projectId, status, assigneeId, sprintId, cursor, limit
   * @returns Lista paginada de tasks
   *
   * @example
   * ```typescript
   * const { items } = await service.findMany({ projectId: '1', status: 'INBOX' });
   * ```
   */
  async findMany(query: ListTasksQueryDto): Promise<ListTasksResponseDto> {
    const take = Math.min(query.limit ?? 20, 100);

    // Construir filtro where
    const where: Prisma.DTaskWhereInput = {
      excluido: false,
      ...(query.projectId
        ? { idProject: BigInt(query.projectId) }
        : query.projectIds?.length
          ? { idProject: { in: query.projectIds.map((projectId) => BigInt(projectId)) } }
          : {}),
      ...(query.assigneeId ? { idAssignee: BigInt(query.assigneeId) } : {}),
      ...(query.sprintId ? { idSprint: BigInt(query.sprintId) } : {}),
      ...(query.cursor ? { chave: { lt: BigInt(query.cursor) } } : {}),
    };

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

    const tasks = await this.prisma.dTask.findMany({
      where,
      select: {
        chave: true,
        idClasse: true,
        idProject: true,
        nome: true,
        descricao: true,
        idStatus: true,
        idPriority: true,
        idAssignee: true,
        idSprint: true,
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

    const items = pageTasks.map((t) => this.buildResponse(t));
    const nextCursor = hasMore ? pageTasks[pageTasks.length - 1].chave.toString() : null;

    return { items, pagination: { hasMore, nextCursor } };
  }

  /**
   * Busca task por ID.
   *
   * @param id - Chave BigInt da task (string)
   * @returns TaskResponseDto
   *
   * @throws {NotFoundException} Se task não encontrada ou deletada
   *
   * @example
   * ```typescript
   * const task = await service.findOne('7');
   * ```
   */
  async findOne(id: string): Promise<TaskResponseDto> {
    const task = await this.prisma.dTask.findFirst({
      where: { chave: BigInt(id), excluido: false },
    });

    if (!task) {
      throw new NotFoundException(`Task ${id} não encontrada`);
    }

    return this.buildResponse(task);
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
  async update(id: string, dto: UpdateTaskDto): Promise<TaskResponseDto> {
    const taskId = BigInt(id);

    const existing = await this.prisma.dTask.findFirst({
      where: { chave: taskId, excluido: false },
      select: { chave: true, dados: true },
    });

    if (!existing) {
      throw new NotFoundException(`Task ${id} não encontrada`);
    }

    // Merge superficial em `dados` quando taskType for atualizado.
    // Preserva identifier, v3, telemetry, capture, automation intactos.
    const dadosAtuais = (existing.dados as Record<string, unknown> | null) ?? {};
    const novosDados =
      dto.taskType !== undefined ? { ...dadosAtuais, taskType: dto.taskType } : undefined;

    const updated = await this.prisma.dTask.update({
      where: { chave: taskId },
      data: {
        ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
        ...(dto.descricao !== undefined ? { descricao: dto.descricao } : {}),
        ...(dto.assigneeId !== undefined
          ? { idAssignee: dto.assigneeId ? BigInt(dto.assigneeId) : null }
          : {}),
        ...(novosDados !== undefined ? { dados: novosDados as Prisma.InputJsonValue } : {}),
      },
    });

    return this.buildResponse(updated);
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

    return this.buildResponse(updated);
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
  async updateSprint(id: string, dto: UpdateTaskSprintDto): Promise<TaskResponseDto> {
    const taskId = BigInt(id);

    const existing = await this.prisma.dTask.findFirst({
      where: { chave: taskId, excluido: false },
      select: { chave: true },
    });

    if (!existing) {
      throw new NotFoundException(`Task ${id} não encontrada`);
    }

    const updated = await this.prisma.dTask.update({
      where: { chave: taskId },
      data: { idSprint: BigInt(dto.sprintId) },
    });

    return this.buildResponse(updated);
  }

  /**
   * Soft-delete de task.
   *
   * @param id - Chave BigInt da task (string)
   *
   * @throws {NotFoundException} Se task não encontrada
   *
   * @example
   * ```typescript
   * await service.delete('7');
   * ```
   */
  async delete(id: string): Promise<void> {
    const taskId = BigInt(id);

    const existing = await this.prisma.dTask.findFirst({
      where: { chave: taskId, excluido: false },
      select: { chave: true },
    });

    if (!existing) {
      throw new NotFoundException(`Task ${id} não encontrada`);
    }

    await this.prisma.dTask.update({
      where: { chave: taskId },
      data: { excluido: true },
    });

    this.logger.log(`Task ${taskId} deletada (soft delete)`);
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  private buildResponse(task: {
    chave: bigint;
    idProject?: bigint | null;
    nome: string;
    descricao?: string | null;
    idStatus?: bigint | null;
    idPriority?: bigint | null;
    idAssignee?: bigint | null;
    idSprint?: bigint | null;
    dados?: unknown;
    criadoEm: Date;
    atualizadoEm: Date;
  }): TaskResponseDto {
    const dados = task.dados as Record<string, unknown> | null;
    const v3 = dados?.v3 as { state?: string } | null;
    const identifier = (dados?.identifier as string | null) ?? '';
    const taskType = (dados?.taskType as string | null) ?? null;

    return {
      id: task.chave.toString(),
      nome: task.nome,
      descricao: task.descricao ?? null,
      projectId: task.idProject?.toString() ?? '',
      identifier,
      status: v3?.state ?? 'INBOX',
      priority: task.idPriority?.toString() ?? null,
      taskType,
      assigneeId: task.idAssignee?.toString() ?? null,
      sprintId: task.idSprint?.toString() ?? null,
      dados,
      criadoEm: task.criadoEm.toISOString(),
      atualizadoEm: task.atualizadoEm.toISOString(),
    };
  }
}
