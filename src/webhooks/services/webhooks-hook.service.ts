import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma.service';
import { ProjectRefService } from '../../projects/project-ref.service';
import { EventRouterService } from '../../eventos/core/event-router.service';
import { SUPPORTED_EVENTS } from '../constants/supported-events';
import { WEBHOOK_DISPATCH_QUEUE, WebhookDispatchJobData, StoredWebhookDados } from '../types/webhook-dispatch-job';
import { IEvent } from '../../eventos/interfaces/event.interface';
import { WEBHOOK_CLASS_ID } from './webhooks.service';

/**
 * Hook que integra o EventRouter com o modulo de webhooks.
 *
 * Filtra eventos suportados, resolve webhooks ativos por projeto
 * e enfileira jobs de dispatch no BullMQ.
 *
 * @see ADR-V2-012 Webhooks outbound.
 */
@Injectable()
export class WebhooksHookService implements OnModuleInit {
  private readonly logger = new Logger(WebhooksHookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventRouter: EventRouterService,
    private readonly projectRef: ProjectRefService,
    @InjectQueue(WEBHOOK_DISPATCH_QUEUE)
    private readonly queue: Queue<WebhookDispatchJobData>,
  ) {}

  onModuleInit() {
    // Registrar como listener no EventRouter
    this.eventRouter.registerWebhookListener(SUPPORTED_EVENTS, (event) => this.onEvent(event));
    this.logger.log('WebhooksHookService initialized and registered in EventRouter');
  }

  /**
   * Processa evento vindo do EventRouter.
   *
   * @param event - Evento canonico V2.
   */
  async onEvent(event: IEvent): Promise<void> {
    if (!SUPPORTED_EVENTS.includes(event.type as any)) {
      return; // evento nao suportado -- ignorar silenciosamente
    }

    // Determinar projectId do evento (cada evento interno deve carregar projectId ou orgId no payload)
    const projectId = this.resolveProjectId(event);
    if (!projectId) {
      this.logger.warn(`webhook_hook_no_project: type=${event.type} correlationId=${event.correlationId}`);
      return;
    }

    // ADR-V2-058/059: webhooks são gravados com o handle canônico (DEntidade-
    // espelho -158, ou P legado). Resolvemos o handle antes de filtrar.
    const handle = await this.projectRef.resolveEntidadeRef(BigInt(projectId));

    // Buscar webhooks ativos para este projeto e tipo de evento
    // Query: DTabela idClasse=-470 AND dEntidadeId=handle
    const webhooks = await this.prisma.dTabela.findMany({
      where: {
        idClasse: WEBHOOK_CLASS_ID,
        dEntidadeId: handle,
        excluido: false,
      },
      select: {
        chave: true,
        dados: true,
      },
    });

    // Filtrar em aplicacao: disabled=false AND events inclui o tipo do evento
    const candidatos = webhooks.filter((wh) => {
      const dados = wh.dados as unknown as StoredWebhookDados;
      return !dados.disabled && dados.events?.includes(event.type);
    });

    if (candidatos.length === 0) return;

    // Truncar payload antes de enfileirar
    const payload = this.truncatePayload(event.payload ?? {});

    // Enfileirar 1 job por webhook candidato
    const jobs = candidatos.map((wh) => ({
      name: 'dispatch',
      data: {
        webhookId: wh.chave.toString(),
        eventType: event.type,
        eventId: (event as any).id?.toString() ?? '0', // Fallback se id nao estiver presente na interface
        payload,
        deliveryId: uuidv4(),
        attempt: 1,
      } satisfies WebhookDispatchJobData,
    }));

    await this.queue.addBulk(jobs);

    this.logger.log(`webhook_jobs_enqueued: type=${event.type} projectId=${projectId} count=${jobs.length}`);
  }

  private resolveProjectId(event: IEvent): string | undefined {
    const payload = event.payload as Record<string, unknown>;
    const id = payload.projectId || payload.idProject;
    return id ? String(id) : undefined;
  }

  private truncatePayload(data: object): object {
    const str = JSON.stringify(data);
    const MAX_BYTES = 256 * 1024; // 256KB
    if (Buffer.byteLength(str, 'utf8') <= MAX_BYTES) return data;
    return { _truncated: true };
  }
}
