import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  isWebhookTrigger,
  matchesWebhookEventPattern,
} from './webhook-triggers.const';
import type { IEventConsumer } from '../interfaces/consumer.interface';
import type { IEvent } from '../interfaces/event.interface';
import {
  WEBHOOK_DISPATCHER_TOKEN,
  type IWebhookDispatcher,
} from '../interfaces/webhook-dispatcher.interface';

const WEBHOOK_CONFIG_CLASSE = BigInt(-470);

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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getConfiguredEvents(metaDados: unknown): string[] {
  const events = asRecord(metaDados).events;
  if (!Array.isArray(events)) return [];
  return events.filter((event): event is string => typeof event === 'string');
}

function isMetaActive(metaDados: unknown): boolean {
  const active = asRecord(metaDados).active;
  return active !== false;
}

/**
 * Consumer de webhooks outbound.
 *
 * Resolve configs `DTabela.idClasse=-470` e delega para dispatcher injetado.
 * Nesta task o dispatcher registrado e um stub, sem chamada externa real.
 *
 * O escopo organizacional e obrigatorio: configs sao lidas por
 * `DTabela.idLocEscrituracao` para impedir vazamento entre organizacoes.
 *
 * @see ADR-V2-028 Webhook config em DTabela -470.
 * @see ADR-V2-030 Contrato de dispatcher stub.
 * @see ADR-V2-031 Webhooks scoped por org.
 */
@Injectable()
export class WebhookConsumer implements IEventConsumer {
  readonly name = 'webhook';
  private readonly logger = new Logger(WebhookConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WEBHOOK_DISPATCHER_TOKEN)
    private readonly dispatcher: IWebhookDispatcher,
  ) {}

  /**
   * Despacha o evento para configs de webhook compativeis.
   *
   * Resolve a organizacao por `orgId`, `projectId` ou `taskId`, filtra configs
   * ativas `DTabela -470` e delega para o dispatcher injetado. Nesta task o
   * dispatcher e stub e nao executa HTTP real.
   *
   * @param event - Evento canonico V2 roteado pelo `EventRouterService`.
   * @returns Promise resolvida quando todos os dispatches stub forem avaliados.
   *
   * @example
   * ```typescript
   * await consumer.handle({
   *   type: 'task.created',
   *   payload: { projectId: '10' },
   *   correlationId: 'corr-1',
   *   timestamp: new Date().toISOString(),
   * });
   * ```
   */
  async handle(event: IEvent): Promise<void> {
    if (!isWebhookTrigger(event.type)) {
      this.logger.debug(
        `webhook skipped by trigger: type=${event.type} correlationId=${event.correlationId}`,
      );
      return;
    }

    const orgId = await this.resolveOrgId(event);
    if (orgId === undefined) {
      this.logger.debug(
        `webhook skipped without org: type=${event.type} correlationId=${event.correlationId}`,
      );
      return;
    }

    const configs = await this.prisma.dTabela.findMany({
      where: {
        idClasse: WEBHOOK_CONFIG_CLASSE,
        idLocEscrituracao: orgId,
        excluido: false,
        inativo: false,
      },
      select: {
        chave: true,
        nome: true,
        metaDados: true,
        idLocEscrituracao: true,
      },
    });

    const matchingConfigs = configs.filter((config) => this.matchesConfig(config, event.type));
    await Promise.all(
      matchingConfigs.map((config) =>
        this.dispatcher.dispatch(
          {
            chave: config.chave,
            nome: config.nome,
            idLocEscrituracao: config.idLocEscrituracao,
            metaDados: config.metaDados,
          },
          event,
        ),
      ),
    );

    this.logger.debug(
      `webhook dispatched to stub: count=${matchingConfigs.length} type=${event.type} ` +
        `orgId=${orgId.toString()} correlationId=${event.correlationId}`,
    );
  }

  private async resolveOrgId(event: IEvent): Promise<bigint | undefined> {
    const directOrgId = getPayloadId(event.payload, ['orgId', 'organizationId', 'idOrg']);
    if (directOrgId !== undefined) return directOrgId;

    const projectId = getPayloadId(event.payload, ['projectId', 'idProject']);
    if (projectId !== undefined) {
      const project = await this.prisma.dProject.findFirst({
        where: { chave: projectId, excluido: false },
        select: { idEstab: true },
      });
      return project?.idEstab ?? undefined;
    }

    const taskId = getPayloadId(event.payload, ['taskId', 'idTask']);
    if (taskId !== undefined) {
      const task = await this.prisma.dTask.findFirst({
        where: { chave: taskId, excluido: false },
        select: { project: { select: { idEstab: true } } },
      });
      return task?.project?.idEstab ?? undefined;
    }

    return undefined;
  }

  private matchesConfig(config: { metaDados: unknown }, eventType: string): boolean {
    if (!isMetaActive(config.metaDados)) return false;
    const configuredEvents = getConfiguredEvents(config.metaDados);
    return configuredEvents.some((pattern) => matchesWebhookEventPattern(pattern, eventType));
  }
}
