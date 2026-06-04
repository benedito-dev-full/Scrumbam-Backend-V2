import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventRouterService } from '../eventos/core/event-router.service';
import { RealtimeGateway } from './realtime.gateway';
import type { IEvent } from '../eventos/interfaces/event.interface';
import type { IEventConsumer } from '../eventos/interfaces/consumer.interface';

/**
 * Mapa `event.type` interno → evento WS do contrato do board.
 *
 * Apenas os 7 eventos abaixo viram broadcast de tempo real. Qualquer outro
 * `task.*`/`phase.*` (ex.: `task.assigned`, `phase.completed`,
 * `task.comment.created`) é IGNORADO — o contrato do front escuta SÓ estes 7.
 *
 * Derivação por TYPE (não por idClasse): hoje fases emitem `phase.*` próprios
 * e tasks normais emitem `task.*`, então o type é fonte suficiente e robusta
 * (ver plano Task 6, seção 4 — "Derivação task.* → evento WS").
 *
 * Lookup direto via `Record<string, string>` é O(1) e legível — mesmo estilo
 * do `TYPE_TO_CLASSE` do `audit-log.consumer`.
 */
const TYPE_TO_WS_EVENT: Readonly<Record<string, string>> = Object.freeze({
  // Fases (DTask idClasse=-200) → blocos do board
  'phase.created': 'block.created',
  'phase.updated': 'block.updated',
  'phase.deleted': 'block.deleted',
  // Tasks normais
  'task.created': 'task.created',
  'task.updated': 'task.updated',
  'task.status.changed': 'task.status.changed',
  'task.deleted': 'task.deleted',
});

/**
 * Extrai um campo string do payload (`null`/`undefined`/não-string → `''`).
 */
function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return '';
}

/**
 * Consumer de borda que transmite eventos de domínio (`task.*`/`phase.*`) para
 * a sala WebSocket da lista (`list:{listId}`) via {@link RealtimeGateway}.
 *
 * Fluxo canônico (regra de ouro — o gateway NUNCA é injetado em
 * TasksService/ProjectsService):
 *
 *   `TasksService → EventProducer → EventRouter → RealtimeConsumer → gateway.broadcast`
 *
 * Estratégia "avisar para invalidar": transmite apenas o envelope mínimo
 * `{ event, listId, entityId, actorId }` no canal único `list:event` — o front
 * dispara `invalidateQueries` (o servidor NÃO envia o patch da entidade).
 *
 * Registro: auto-registra no {@link EventRouterService} via `registerConsumer`
 * dinâmico no `onModuleInit` (padrão ADR-V2-049 — precedente
 * `TelegramNotificationConsumer`). Isso mantém o `EventosModule` (`@Global`)
 * desacoplado do `RealtimeModule` (que importa `ProjectsModule`/`AuthModule`),
 * evitando dependência circular. O `RealtimeConsumer` NÃO entra no construtor
 * do `EventRouterService`.
 *
 * Isolamento: o consumer faz skip silencioso (log debug) quando o evento não
 * tem `projectId`/`entityId` — NÃO quebra o pipeline (o `EventProducer` já
 * isola consumers via `Promise.allSettled`, mas evitamos ruído).
 *
 * ZERO query: o consumer apenas LÊ o payload do evento já persistido e chama
 * `broadcast` — não toca o banco (sem Prisma, sem N+1).
 *
 * @see RealtimeGateway.broadcast — ponto de saída WS
 * @see EventRouterService.registerConsumer — registro dinâmico (ADR-V2-049)
 */
@Injectable()
export class RealtimeConsumer implements IEventConsumer, OnModuleInit {
  readonly name = 'realtime';
  private readonly logger = new Logger(RealtimeConsumer.name);

  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly eventRouter: EventRouterService,
  ) {}

  /**
   * Auto-registra este consumer no `EventRouterService` para todos os eventos
   * de task/fase. Usar `onModuleInit` (ao invés de injetar o consumer direto
   * no router) mantém o `EventosModule` desacoplado do `RealtimeModule`
   * (ADR-V2-049 — anti-circular).
   */
  onModuleInit(): void {
    this.eventRouter.registerConsumer(
      (type) => type.startsWith('task.') || type.startsWith('phase.'),
      this,
    );
    this.logger.log('RealtimeConsumer registered for task.* / phase.*');
  }

  /**
   * Deriva o envelope WS a partir do evento de domínio e transmite para a sala
   * da lista. Skip seguro (sem broadcast) quando:
   *  - o `type` não está no mapa dos 7 eventos do contrato (ex.: `task.assigned`);
   *  - falta `projectId` (não há sala destino);
   *  - falta `entityId` (`taskId`/`phaseId`).
   *
   * Não lança por dados faltando — apenas registra debug e retorna.
   *
   * @param event - Evento canônico V2 (`task.*`/`phase.*`).
   */
  async handle(event: IEvent): Promise<void> {
    const wsEvent = TYPE_TO_WS_EVENT[event.type];
    if (!wsEvent) {
      // task.assigned / phase.completed / task.comment.* etc. — não são do board
      this.logger.debug(`realtime skip (não mapeado): type=${event.type}`);
      return;
    }

    const payload = event.payload;
    const listId = asString(payload.projectId);
    if (!listId) {
      this.logger.debug(`realtime skip: sem projectId type=${event.type}`);
      return;
    }

    const entityId = asString(payload.taskId ?? payload.phaseId);
    if (!entityId) {
      this.logger.debug(`realtime skip: sem entityId type=${event.type} listId=${listId}`);
      return;
    }

    // actorId pode ficar '' (front trata vazio como "sem eco-filter").
    const actorId = asString(payload.actorId ?? payload.userId ?? payload.movedBy);

    this.gateway.broadcast(`list:${listId}`, wsEvent, { listId, entityId, actorId });
    this.logger.debug(
      `realtime broadcast: event=${wsEvent} listId=${listId} entityId=${entityId} actorId=${actorId || '∅'}`,
    );
  }
}

/** Exposto para testes — permite verificar o mapeamento type → evento WS. */
export const __REALTIME_TYPE_TO_WS_EVENT = TYPE_TO_WS_EVENT;
