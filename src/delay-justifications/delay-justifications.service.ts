import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { TimezoneService } from '../common/services/timezone.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { EVENT_TYPES } from '../eventos/core/event-types';
import { RoleResolverService } from '../auth/services/role-resolver.service';
import { parseTaskDados } from '../tasks/schemas/task-dados.schema';
import { computeOverdue, OverdueResult } from './overdue.util';
import { CreateDelayJustificationDto } from './dto/create-delay-justification.dto';
import { DelayJustificationResponseDto } from './dto/delay-justification-response.dto';
import { PendingCountResponseDto } from './dto/pending-count-response.dto';

/** DClasse do evento de justificativa de atraso (seed F1 — ADR-V2-070). */
const ID_CLASSE_DELAY_JUSTIFICATION = BigInt(-503);

/**
 * Shape mínimo de `metaDados` de um DEvento -503. Persistido como Json; lido
 * com parsing tolerante (linhas antigas podem não ter todos os campos).
 */
interface DelayJustificationMeta {
  taskId: string;
  motivoClasse: string;
  texto: string | null;
  projetoId: string | null;
  autorId: string;
  delayDays: number;
  delayKind: OverdueResult['delayKind'];
  version: number;
  supersededBy: string | null;
}

/** Linha de DEvento -503 com o autor resolvido em JOIN (zero N+1). */
type EventoComAutor = {
  chave: bigint;
  identificadorExterno: string | null;
  descricao: string | null;
  metaDados: Prisma.JsonValue | null;
  criadoEm: Date;
  idEntidade: bigint | null;
  entidade: { chave: bigint; nome: string | null } | null;
};

/**
 * Service da Justificativa de Atraso de Tarefas (ADR-V2-070).
 *
 * Persiste a justificativa como `DEvento` idClasse=-503 (ADR-V2-008 — DEvento
 * é o barramento de eventos/auditoria; ZERO tabela nova, ADR-V2-001):
 * - `idEntidade` = **autorId** (DEntidade do responsável/admin) → FK válida
 *   (ADR-V2-058) e índice barato para "group by usuário" no painel.
 * - `identificadorExterno` = **taskId** (string, SEM FK) → o índice
 *   `(idClasse, identificadorExterno)` resolve "ler a vigente da task X".
 * - `descricao` = texto livre (opcional).
 * - `metaDados` = `{ taskId, motivoClasse, texto, projetoId, autorId,
 *   delayDays, delayKind, version, supersededBy }`.
 *
 * **"1 vigente + histórico" via supersede:** editar marca a linha anterior
 * `excluido=true` (+ `supersededBy=novaChave`) e insere a nova — tudo em
 * `$transaction`. A **vigente é a única `excluido=false`**; o histórico é o
 * conjunto de todas as linhas (Fase 2).
 *
 * **Pilar 1 NÃO se aplica:** não é transação financeira — persistência via
 * Prisma direto (padrão idêntico ao TASK_COMMENT -507). Engine é exclusivo de
 * DPedido/DTitulo/DMov*.
 *
 * @see computeOverdue — critério de atraso por dia de calendário (TZ Brasil).
 * @see RoleResolverService.getOrgRole — RBAC de org ADMIN (-161).
 */
@Injectable()
export class DelayJustificationsService {
  private readonly logger = new Logger(DelayJustificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timezone: TimezoneService,
    private readonly roleResolver: RoleResolverService,
    private readonly eventProducer: EventProducerService,
    private readonly correlationId: CorrelationIdService,
  ) {}

  /**
   * Cria OU edita (supersede) a justificativa vigente da tarefa.
   *
   * Fluxo:
   *  1. Carrega a task (404 se inexistente).
   *  2. Autoriza: responsável (assignee) OU org ADMIN (-161) da org dona do
   *     projeto — senão 403 (Project MANAGER NÃO autoriza — CEO decisão 3).
   *  3. Valida que a task está de fato atrasada (`computeOverdue`) — senão 400.
   *  4. Lê a vigente atual (para versionar) e faz supersede+insert em
   *     `$transaction` (atomicidade).
   *  5. Emite `delay.justified` APÓS o commit (ordem crítica — sem evento órfão).
   *
   * @param taskId - `DTask.chave` (path param, string).
   * @param dto - motivoClasse (obrigatório) + texto (opcional).
   * @param requesterEntidadeId - `DEntidade.chave` do requester (do JWT).
   * @returns A justificativa vigente recém-criada.
   *
   * @throws {NotFoundException} Task inexistente.
   * @throws {ForbiddenException} Não é assignee nem org ADMIN.
   * @throws {BadRequestException} Task não está atrasada.
   */
  async createOrEdit(
    taskId: string,
    dto: CreateDelayJustificationDto,
    requesterEntidadeId: bigint,
  ): Promise<DelayJustificationResponseDto> {
    const task = await this.loadTaskOrThrow(taskId);
    await this.assertCanAccess(task, requesterEntidadeId);

    const overdue = computeOverdue(
      { dueDate: task.dueDate, dados: parseTaskDados(task.dados), atualizadoEm: task.atualizadoEm },
      this.timezone,
    );
    if (!overdue.isOverdue) {
      throw new BadRequestException(
        'A tarefa não está atrasada; justificativa de atraso não se aplica',
      );
    }

    // Vigente atual (para versionar). Índice (idClasse, identificadorExterno).
    const atual = await this.prisma.dEvento.findFirst({
      where: {
        idClasse: ID_CLASSE_DELAY_JUSTIFICATION,
        identificadorExterno: taskId,
        excluido: false,
      },
      orderBy: { criadoEm: 'desc' },
      select: { chave: true, metaDados: true },
    });

    const previousVersion = this.readMeta(atual?.metaDados).version ?? 0;
    const nextVersion = previousVersion + 1;
    const projetoId = task.idProject ? task.idProject.toString() : null;
    const texto = dto.texto ?? null;

    const meta: DelayJustificationMeta = {
      taskId,
      motivoClasse: dto.motivoClasse,
      texto,
      projetoId,
      autorId: requesterEntidadeId.toString(),
      delayDays: overdue.delayDays,
      delayKind: overdue.delayKind,
      version: nextVersion,
      supersededBy: null,
    };

    // Supersede + insert atômicos: (1) marca vigentes anteriores como
    // superseded, (2) insere a nova vigente, (3) linka a anterior à nova.
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.dEvento.updateMany({
        where: {
          idClasse: ID_CLASSE_DELAY_JUSTIFICATION,
          identificadorExterno: taskId,
          excluido: false,
        },
        data: { excluido: true },
      });

      const novo = await tx.dEvento.create({
        data: {
          idClasse: ID_CLASSE_DELAY_JUSTIFICATION,
          idEntidade: requesterEntidadeId,
          identificadorExterno: taskId,
          descricao: texto,
          metaDados: meta as unknown as Prisma.InputJsonValue,
        },
        include: { entidade: { select: { chave: true, nome: true } } },
      });

      // Linka a versão anterior à nova (histórico navegável). Só quando editou.
      if (atual) {
        const oldMeta = { ...this.readMeta(atual.metaDados), supersededBy: novo.chave.toString() };
        await tx.dEvento.update({
          where: { chave: atual.chave },
          data: { metaDados: oldMeta as unknown as Prisma.InputJsonValue },
        });
      }

      return novo;
    });

    // Evento APÓS persistência (Pilar 7 / ordem crítica) — nunca órfão.
    await this.eventProducer.addInternalEvent(
      EVENT_TYPES.DELAY_JUSTIFIED,
      {
        justificationId: created.chave.toString(),
        taskId,
        projetoId,
        motivoClasse: dto.motivoClasse,
        delayKind: overdue.delayKind,
        delayDays: overdue.delayDays,
        version: nextVersion,
        autorId: requesterEntidadeId.toString(),
      },
      this.correlationId.getOrGenerate(),
      { source: DelayJustificationsService.name },
    );

    this.logger.log(
      `delay_justified taskId=${taskId} autorId=${requesterEntidadeId.toString()} ` +
        `motivo=${dto.motivoClasse} kind=${overdue.delayKind} days=${overdue.delayDays} ` +
        `version=${nextVersion} eventId=${created.chave.toString()}`,
    );

    return this.toResponseDto(created);
  }

  /**
   * Lê a justificativa VIGENTE (`excluido=false`) da tarefa.
   *
   * Autorização idêntica à escrita: assignee OU org ADMIN. Membro NÃO lê a de
   * terceiros (CEO decisão 1). Retorna `null` (200) quando ainda não há
   * justificativa — o frontend distingue "não justificado" de erro.
   *
   * @param taskId - `DTask.chave` (path param).
   * @param requesterEntidadeId - `DEntidade.chave` do requester.
   * @returns A vigente, ou `null` se não existe.
   *
   * @throws {NotFoundException} Task inexistente.
   * @throws {ForbiddenException} Não é assignee nem org ADMIN.
   */
  async getVigente(
    taskId: string,
    requesterEntidadeId: bigint,
  ): Promise<DelayJustificationResponseDto | null> {
    const task = await this.loadTaskOrThrow(taskId);
    await this.assertCanAccess(task, requesterEntidadeId);

    const vigente = await this.prisma.dEvento.findFirst({
      where: {
        idClasse: ID_CLASSE_DELAY_JUSTIFICATION,
        identificadorExterno: taskId,
        excluido: false,
      },
      orderBy: { criadoEm: 'desc' },
      include: { entidade: { select: { chave: true, nome: true } } },
    });

    return vigente ? this.toResponseDto(vigente) : null;
  }

  /**
   * Conta tarefas do PRÓPRIO usuário atrasadas SEM justificativa vigente.
   *
   * Duas queries, ZERO N+1:
   *  1. Tarefas do usuário (assignee) com `dueDate` e não excluídas (recorte
   *     opcional por `projectId`).
   *  2. Um único `findMany` em DEvento -503 vigentes cujo `identificadorExterno`
   *     está no lote de tasks atrasadas → Set de "já justificadas".
   *
   * `assigneeId` é SEMPRE `requesterEntidadeId` (do JWT), nunca entrada do
   * cliente — o badge é sempre `/me`.
   *
   * @param requesterEntidadeId - `DEntidade.chave` do requester (do JWT).
   * @param projectId - Recorte opcional por projeto (null = global).
   * @returns `{ pendingCount, projectId }`.
   */
  async getPendingCount(
    requesterEntidadeId: bigint,
    projectId?: string,
  ): Promise<PendingCountResponseDto> {
    const tasks = await this.prisma.dTask.findMany({
      where: {
        idAssignee: requesterEntidadeId,
        excluido: false,
        dueDate: { not: null },
        ...(projectId ? { idProject: BigInt(projectId) } : {}),
      },
      select: { chave: true, dueDate: true, dados: true, atualizadoEm: true },
    });

    const overdueTaskIds = tasks
      .filter(
        (t) =>
          computeOverdue(
            { dueDate: t.dueDate, dados: parseTaskDados(t.dados), atualizadoEm: t.atualizadoEm },
            this.timezone,
          ).isOverdue,
      )
      .map((t) => t.chave.toString());

    if (overdueTaskIds.length === 0) {
      return { pendingCount: 0, projectId: projectId ?? null };
    }

    const justified = await this.prisma.dEvento.findMany({
      where: {
        idClasse: ID_CLASSE_DELAY_JUSTIFICATION,
        excluido: false,
        identificadorExterno: { in: overdueTaskIds },
      },
      select: { identificadorExterno: true },
    });
    const justifiedSet = new Set(justified.map((e) => e.identificadorExterno));

    const pendingCount = overdueTaskIds.filter((id) => !justifiedSet.has(id)).length;
    return { pendingCount, projectId: projectId ?? null };
  }

  /**
   * Carrega os campos da task necessários para atraso + RBAC. 404 se ausente.
   */
  private async loadTaskOrThrow(taskId: string): Promise<{
    chave: bigint;
    idAssignee: bigint | null;
    idProject: bigint | null;
    dueDate: Date | null;
    dados: Prisma.JsonValue | null;
    atualizadoEm: Date;
  }> {
    let chave: bigint;
    try {
      chave = BigInt(taskId);
    } catch {
      throw new NotFoundException(`Tarefa ${taskId} não encontrada`);
    }

    const task = await this.prisma.dTask.findFirst({
      where: { chave, excluido: false },
      select: {
        chave: true,
        idAssignee: true,
        idProject: true,
        dueDate: true,
        dados: true,
        atualizadoEm: true,
      },
    });
    if (!task) {
      throw new NotFoundException(`Tarefa ${taskId} não encontrada`);
    }
    return task;
  }

  /**
   * Autoriza leitura/escrita da justificativa: responsável (assignee) OU org
   * ADMIN (-161) da org DONA do projeto da task. Project MANAGER NÃO autoriza
   * (CEO decisão 3). Membro comum não acessa a de terceiros (CEO decisão 1).
   *
   * A org-alvo é a org do projeto (`DProject.idEstab`) — NÃO a "org ativa" do
   * JWT — para garantir isolamento de tenant (um admin da org A nunca acessa
   * justificativa de tarefa da org B). Só consulta a org quando o requester
   * NÃO é o assignee (curto-circuito → custo zero no caminho comum).
   *
   * @throws {ForbiddenException} Não é assignee nem org ADMIN da org do projeto.
   */
  private async assertCanAccess(
    task: { idAssignee: bigint | null; idProject: bigint | null },
    requesterEntidadeId: bigint,
  ): Promise<void> {
    if (task.idAssignee !== null && task.idAssignee === requesterEntidadeId) {
      return; // responsável pela própria tarefa
    }

    if (task.idProject !== null) {
      const project = await this.prisma.dProject.findFirst({
        where: { chave: task.idProject, excluido: false },
        select: { idEstab: true },
      });
      if (project?.idEstab) {
        const orgRole = await this.roleResolver.getOrgRole(requesterEntidadeId, project.idEstab);
        if (orgRole === 'ADMIN') {
          return; // admin da org dona do projeto
        }
      }
    }

    this.logger.warn(
      `delay_justification_denied requester=${requesterEntidadeId.toString()} ` +
        `assignee=${task.idAssignee?.toString() ?? 'null'}`,
    );
    throw new ForbiddenException(
      'Apenas o responsável pela tarefa ou um ADMIN da organização podem gerir a justificativa de atraso',
    );
  }

  /** Parse tolerante de `metaDados` (Json) → shape de justificativa. */
  private readMeta(raw: Prisma.JsonValue | null | undefined): Partial<DelayJustificationMeta> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }
    return raw as Partial<DelayJustificationMeta>;
  }

  /** Mapeia DEvento -503 (+ join autor) → response DTO. */
  private toResponseDto(evento: EventoComAutor): DelayJustificationResponseDto {
    const meta = this.readMeta(evento.metaDados);
    return {
      id: evento.chave.toString(),
      taskId: evento.identificadorExterno ?? meta.taskId ?? '',
      motivoClasse: meta.motivoClasse ?? '',
      texto: evento.descricao ?? meta.texto ?? '',
      autorId: evento.idEntidade?.toString() ?? meta.autorId ?? '',
      autorNome: evento.entidade?.nome ?? null,
      projetoId: meta.projetoId ?? null,
      delayDays: meta.delayDays ?? 0,
      delayKind: meta.delayKind ?? null,
      version: meta.version ?? 1,
      createdAt: evento.criadoEm.toISOString(),
    };
  }
}
