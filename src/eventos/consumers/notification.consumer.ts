import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { isNotificationTrigger } from './notification-triggers.const';
import type { IEventConsumer } from '../interfaces/consumer.interface';
import type { IEvent } from '../interfaces/event.interface';

const NOTIFICATION_CLASSE = BigInt(-490);
const ORG_ROLE_ADMIN = BigInt(-161);
const PROJECT_ROLE_MANAGER = BigInt(-171);

interface NotificationDraft {
  recipientId: bigint;
  title: string;
  message: string;
  taskId?: string;
  projectId?: string;
  executionId?: string;
}

function toBigInt(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return undefined;
}

function getPayloadId(payload: Record<string, unknown>, keys: string[]): bigint | undefined {
  for (const key of keys) {
    const value = toBigInt(payload[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function addRecipient(recipients: Set<bigint>, value: bigint | null | undefined): void {
  if (value !== null && value !== undefined) {
    recipients.add(value);
  }
}

/**
 * Consumer de notificacoes in-app.
 *
 * Persiste notificacoes como `DEvento.idClasse=-490` e nunca reemite eventos,
 * evitando loop no pipeline.
 *
 * Regras principais:
 * - aceita apenas triggers em `NOTIFICATION_TRIGGERS`;
 * - resolve destinatarios por task, execution ou membership;
 * - aplica idempotencia por `identificadorExterno`;
 * - usa Prisma direto porque `DEvento` e tabela estrutural.
 *
 * @see ADR-V2-008 DEvento substitui DNotification/DWebhook.
 * @see ADR-V2-029 Idempotencia de notificacoes sem migration nesta task.
 */
@Injectable()
export class NotificationConsumer implements IEventConsumer {
  readonly name = 'notification';
  private readonly logger = new Logger(NotificationConsumer.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria notificacoes para os destinatarios derivados do evento.
   *
   * O metodo e destino final do pipeline de eventos: ele grava `DEvento -490`
   * diretamente e nao chama `EventProducerService`, evitando recursao.
   *
   * @param event - Evento canonico V2 roteado pelo `EventRouterService`.
   * @returns Promise resolvida quando as notificacoes elegiveis forem gravadas.
   *
   * @example
   * ```typescript
   * await consumer.handle({
   *   type: 'task.status.changed',
   *   payload: { taskId: '123' },
   *   correlationId: 'corr-1',
   *   timestamp: new Date().toISOString(),
   * });
   * ```
   */
  async handle(event: IEvent): Promise<void> {
    if (!isNotificationTrigger(event.type)) {
      this.logger.debug(
        `notification skipped: type=${event.type} correlationId=${event.correlationId}`,
      );
      return;
    }

    const drafts = await this.buildDrafts(event);
    if (drafts.length === 0) {
      this.logger.debug(
        `notification no recipients: type=${event.type} correlationId=${event.correlationId}`,
      );
      return;
    }

    const identifiers = drafts.map((draft) => this.buildIdentifier(event, draft.recipientId));
    const existing = await this.prisma.dEvento.findMany({
      where: {
        idClasse: NOTIFICATION_CLASSE,
        excluido: false,
        identificadorExterno: { in: identifiers },
      },
      select: { identificadorExterno: true },
    });
    const existingIds = new Set(
      existing
        .map((row) => row.identificadorExterno)
        .filter((id): id is string => typeof id === 'string'),
    );

    const data = drafts
      .filter((draft) => !existingIds.has(this.buildIdentifier(event, draft.recipientId)))
      .map((draft) => this.toCreateManyInput(event, draft));

    if (data.length === 0) {
      this.logger.debug(
        `notification idempotent skip: type=${event.type} correlationId=${event.correlationId}`,
      );
      return;
    }

    await this.prisma.dEvento.createMany({ data });

    this.logger.debug(
      `notification persisted: count=${data.length} type=${event.type} ` +
        `correlationId=${event.correlationId}`,
    );
  }

  private async buildDrafts(event: IEvent): Promise<NotificationDraft[]> {
    switch (event.type) {
      case 'task.status.changed':
        return this.buildTaskStatusDrafts(event);
      case 'task.assigned':
        return this.buildTaskAssignedDrafts(event);
      case 'execution.awaiting_approval':
        return this.buildAwaitingApprovalDrafts(event);
      case 'execution.completed':
      case 'execution.failed':
        return this.buildExecutionFinalDrafts(event);
      default:
        return [];
    }
  }

  private async buildTaskStatusDrafts(event: IEvent): Promise<NotificationDraft[]> {
    const taskId = getPayloadId(event.payload, ['taskId', 'idTask']);
    if (taskId === undefined) return [];

    const task = await this.prisma.dTask.findFirst({
      where: { chave: taskId, excluido: false },
      select: { chave: true, nome: true, idCreator: true, idAssignee: true, idProject: true },
    });
    if (!task) return [];

    const recipients = new Set<bigint>();
    addRecipient(recipients, task.idCreator);
    addRecipient(recipients, task.idAssignee);

    return [...recipients].map((recipientId) => ({
      recipientId,
      title: 'Task atualizada',
      message: `Status da task "${task.nome}" alterado.`,
      taskId: task.chave.toString(),
      ...(task.idProject && { projectId: task.idProject.toString() }),
    }));
  }

  private async buildTaskAssignedDrafts(event: IEvent): Promise<NotificationDraft[]> {
    const taskId = getPayloadId(event.payload, ['taskId', 'idTask']);
    if (taskId === undefined) return [];

    const task = await this.prisma.dTask.findFirst({
      where: { chave: taskId, excluido: false },
      select: { chave: true, nome: true, idCreator: true, idAssignee: true, idProject: true },
    });
    if (!task) return [];

    const recipients = new Set<bigint>();
    addRecipient(recipients, task.idAssignee);
    addRecipient(recipients, task.idCreator);

    return [...recipients].map((recipientId) => ({
      recipientId,
      title: 'Task atribuida',
      message: `Task "${task.nome}" atribuida.`,
      taskId: task.chave.toString(),
      ...(task.idProject && { projectId: task.idProject.toString() }),
    }));
  }

  private async buildAwaitingApprovalDrafts(event: IEvent): Promise<NotificationDraft[]> {
    const projectId = getPayloadId(event.payload, ['projectId', 'idProject']);
    if (projectId === undefined) return [];

    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { chave: true, idEstab: true, nome: true },
    });
    if (!project) return [];

    const membershipFilters: Prisma.DVinculaWhereInput[] = [
      { idLocEscritu: project.chave, idClasse: PROJECT_ROLE_MANAGER },
    ];
    if (project.idEstab) {
      membershipFilters.push({ idLocEscritu: project.idEstab, idClasse: ORG_ROLE_ADMIN });
    }

    const vinculos = await this.prisma.dVincula.findMany({
      where: { excluido: false, OR: membershipFilters },
      select: { idEntidade: true },
    });

    const recipients = new Set<bigint>();
    for (const vinculo of vinculos) addRecipient(recipients, vinculo.idEntidade);

    return [...recipients].map((recipientId) => ({
      recipientId,
      title: 'Aprovacao pendente',
      message: `Execucao aguardando aprovacao no projeto "${project.nome}".`,
      projectId: project.chave.toString(),
      executionId: getPayloadId(event.payload, ['executionId', 'pedidoId'])?.toString(),
    }));
  }

  private async buildExecutionFinalDrafts(event: IEvent): Promise<NotificationDraft[]> {
    const recipients = new Set<bigint>();
    addRecipient(recipients, getPayloadId(event.payload, ['entidadeId', 'idEntidade', 'userId']));

    const projectId = getPayloadId(event.payload, ['projectId', 'idProject']);
    if (projectId !== undefined) {
      const vinculos = await this.prisma.dVincula.findMany({
        where: {
          idLocEscritu: projectId,
          idClasse: PROJECT_ROLE_MANAGER,
          excluido: false,
        },
        select: { idEntidade: true },
      });
      for (const vinculo of vinculos) addRecipient(recipients, vinculo.idEntidade);
    }

    const title = event.type === 'execution.failed' ? 'Execucao falhou' : 'Execucao concluida';
    const message =
      event.type === 'execution.failed'
        ? 'Uma execucao terminou com falha.'
        : 'Uma execucao foi concluida.';

    return [...recipients].map((recipientId) => ({
      recipientId,
      title,
      message,
      ...(projectId && { projectId: projectId.toString() }),
      executionId: getPayloadId(event.payload, ['executionId', 'pedidoId'])?.toString(),
    }));
  }

  private buildIdentifier(event: IEvent, recipientId: bigint): string {
    return `${event.correlationId}:notification:${event.type}:${recipientId.toString()}`;
  }

  private toCreateManyInput(
    event: IEvent,
    draft: NotificationDraft,
  ): Prisma.DEventoCreateManyInput {
    const metaDados = {
      eventType: event.type,
      title: draft.title,
      message: draft.message,
      read: false,
      ...(draft.taskId && { taskId: draft.taskId }),
      ...(draft.projectId && { projectId: draft.projectId }),
      ...(draft.executionId && { executionId: draft.executionId }),
      _meta: {
        sourceEventCorrelationId: event.correlationId,
        createdBy: 'NotificationConsumer',
      },
    } as Prisma.InputJsonValue;

    return {
      idClasse: NOTIFICATION_CLASSE,
      idEntidade: draft.recipientId,
      identificadorExterno: this.buildIdentifier(event, draft.recipientId),
      descricao: draft.message,
      metaDados,
    };
  }
}
