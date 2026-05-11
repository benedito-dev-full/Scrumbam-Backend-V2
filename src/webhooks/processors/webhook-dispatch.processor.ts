import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { PrismaService } from '../../prisma.service';
import { WEBHOOK_CLASS_ID } from '../services/webhooks.service';
import { WebhooksSigningService } from '../services/webhooks-signing.service';
import { WebhooksSsrfService } from '../services/webhooks-ssrf.service';
import { WebhooksRetryService } from '../services/webhooks-retry.service';
import {
  StoredWebhookDados,
  WEBHOOK_ATTEMPT_CLASS_ID,
  WEBHOOK_DISPATCH_QUEUE,
  WEBHOOK_USER_AGENT,
  WebhookDispatchJobData,
} from '../types/webhook-dispatch-job';

type WebhookConfigRow = {
  chave: bigint;
  dEntidadeId: bigint | null;
  dados: Prisma.JsonValue;
};

interface DispatchResult {
  success: boolean;
  httpCode: number | null;
  errorMessage: string | null;
}

interface FailureRecordResult {
  autoDisabled: boolean;
  failureCount: number;
}

/**
 * Processador BullMQ responsavel pelo despacho de webhooks outbound (Pilar 2).
 *
 * Implementa retry exponencial, assinatura HMAC-SHA256, protecao contra SSRF,
 * truncamento de payload e auto-desabilitacao por falhas consecutivas.
 *
 * @see ADR-V2-012 Webhooks outbound.
 */
@Processor(WEBHOOK_DISPATCH_QUEUE, { concurrency: 10 })
export class WebhookDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDispatchProcessor.name);
  private metrics = {
    success: 0,
    fail: 0,
    timeout: 0,
    autoDisabled: 0,
    recentDurations: [] as number[],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly signingService: WebhooksSigningService,
    private readonly ssrfService: WebhooksSsrfService,
    private readonly retryService: WebhooksRetryService,
    private readonly configService: ConfigService,
    private readonly eventProducer: EventProducerService,
    @InjectQueue(WEBHOOK_DISPATCH_QUEUE)
    private readonly queue: Queue<WebhookDispatchJobData>,
  ) {
    super();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  logMetrics() {
    const durations = this.metrics.recentDurations;
    const p95 = durations.length > 0 ? this.calcP95(durations) : 0;

    this.logger.log('webhook_metrics_snapshot', {
      ...this.metrics,
      recentDurations: undefined, // Nao logar array
      p95DurationMs: p95,
      count: this.metrics.success + this.metrics.fail + this.metrics.timeout,
    });

    // Limpar durations a cada snapshot para manter frescor
    this.metrics.recentDurations = [];
  }

  async process(job: Job<WebhookDispatchJobData>): Promise<void> {
    const { webhookId, eventType, eventId, payload, deliveryId, attempt } = job.data;
    const webhookChave = BigInt(webhookId);
    const startedAt = Date.now();

    const config = await this.findWebhookConfig(webhookChave);
    if (!config) {
      this.logger.warn(`webhook_dispatch_skipped_missing webhookId=${webhookId}`);
      return;
    }

    const dados = this.parseDados(config.dados);
    if (dados.disabled) {
      this.logger.warn(`webhook_dispatch_skipped_disabled webhookId=${webhookId}`);
      return;
    }

    const result = await this.dispatchHttp(dados, {
      eventType,
      eventId,
      payload,
      deliveryId,
      projectId: config.dEntidadeId?.toString() ?? null,
    });
    const durationMs = Date.now() - startedAt;
    this.trackMetrics(result, durationMs);

    if (result.success) {
      await this.recordSuccess(config, dados, job.data, result.httpCode, durationMs);
      this.logger.log(
        `webhook_delivered webhookId=${webhookId} eventType=${eventType} ` +
          `deliveryId=${deliveryId} httpCode=${result.httpCode} durationMs=${durationMs} ` +
          `attempt=${attempt}`,
      );
      return;
    }

    const failureRecord = await this.recordFailure(config, dados, job.data, result, durationMs);
    this.logger.warn(
      `webhook_failed webhookId=${webhookId} eventType=${eventType} ` +
        `deliveryId=${deliveryId} httpCode=${result.httpCode ?? 'null'} ` +
        `attempt=${attempt} error=${result.errorMessage ?? 'unknown'}`,
    );

    if (attempt < 3) {
      await this.scheduleRetry(job.data);
      return;
    }

    if (failureRecord.autoDisabled) {
      this.metrics.autoDisabled++;
      await this.emitAutoDisabled(config, job.data, failureRecord.failureCount);
    }
  }

  private trackMetrics(result: DispatchResult, durationMs: number) {
    if (result.success) {
      this.metrics.success++;
    } else {
      if (result.errorMessage?.startsWith('timeout')) {
        this.metrics.timeout++;
      }
      this.metrics.fail++;
    }

    this.metrics.recentDurations.push(durationMs);
    if (this.metrics.recentDurations.length > 1000) {
      this.metrics.recentDurations.shift();
    }
  }

  private calcP95(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * 0.95);
    return sorted[index];
  }

  private async findWebhookConfig(webhookChave: bigint): Promise<WebhookConfigRow | null> {
    return this.prisma.dTabela.findFirst({
      where: {
        chave: webhookChave,
        idClasse: WEBHOOK_CLASS_ID,
        excluido: false,
      },
      select: {
        chave: true,
        dEntidadeId: true,
        dados: true,
      },
    });
  }

  private async dispatchHttp(
    dados: StoredWebhookDados,
    context: {
      eventType: string;
      eventId: string;
      payload: unknown;
      deliveryId: string;
      projectId: string | null;
    },
  ): Promise<DispatchResult> {
    try {
      await this.ssrfService.validateUrl(dados.url);

      const secret = this.signingService.decrypt(dados.secretEncrypted);
      const bodyString = JSON.stringify({
        id: context.deliveryId,
        type: context.eventType,
        eventId: context.eventId,
        occurredAt: new Date().toISOString(),
        data: context.payload,
        projectId: context.projectId,
      });
      const signature = this.signingService.sign(secret, bodyString);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.getTimeoutMs());

      try {
        const response = await fetch(dados.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-Event': context.eventType,
            'X-Webhook-Delivery': context.deliveryId,
            'User-Agent': WEBHOOK_USER_AGENT,
          },
          body: bodyString,
          signal: controller.signal,
        });

        const success = response.status >= 200 && response.status < 300;
        return {
          success,
          httpCode: response.status,
          errorMessage: success ? null : `HTTP ${response.status}`,
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: unknown) {
      return {
        success: false,
        httpCode: null,
        errorMessage: this.toErrorMessage(err),
      };
    }
  }

  private async recordSuccess(
    config: WebhookConfigRow,
    dados: StoredWebhookDados,
    jobData: WebhookDispatchJobData,
    httpCode: number | null,
    durationMs: number,
  ): Promise<void> {
    const now = new Date().toISOString();
    const nextDados: StoredWebhookDados = {
      ...dados,
      failureCount: 0,
      lastSuccessAt: now,
      lastFailureAt: dados.lastFailureAt,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.dEvento.create({
        data: {
          idClasse: WEBHOOK_ATTEMPT_CLASS_ID,
          ...(config.dEntidadeId ? { idEntidade: config.dEntidadeId } : {}),
          identificadorExterno: `${jobData.deliveryId}:${jobData.attempt}`,
          descricao: 'webhook.delivery.success',
          metaDados: this.buildAttemptMeta(jobData, {
            status: 'success',
            httpCode,
            durationMs,
          }),
        },
      });

      await tx.dTabela.update({
        where: { chave: config.chave },
        data: { dados: nextDados as unknown as Prisma.InputJsonValue },
      });
    });
  }

  private async recordFailure(
    config: WebhookConfigRow,
    dados: StoredWebhookDados,
    jobData: WebhookDispatchJobData,
    result: DispatchResult,
    durationMs: number,
  ): Promise<FailureRecordResult> {
    const finalFailure = jobData.attempt >= 3;
    const nextFailureCount = finalFailure ? dados.failureCount + 1 : dados.failureCount;
    const autoDisabled = finalFailure && this.retryService.shouldAutoDisable(nextFailureCount);
    const nextDados: StoredWebhookDados = {
      ...dados,
      disabled: autoDisabled ? true : dados.disabled,
      failureCount: nextFailureCount,
      lastFailureAt: new Date().toISOString(),
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.dEvento.create({
        data: {
          idClasse: WEBHOOK_ATTEMPT_CLASS_ID,
          ...(config.dEntidadeId ? { idEntidade: config.dEntidadeId } : {}),
          identificadorExterno: `${jobData.deliveryId}:${jobData.attempt}`,
          descricao: 'webhook.delivery.fail',
          metaDados: this.buildAttemptMeta(jobData, {
            status: 'fail',
            httpCode: result.httpCode,
            durationMs,
            errorMessage: result.errorMessage,
          }),
        },
      });

      await tx.dTabela.update({
        where: { chave: config.chave },
        data: { dados: nextDados as unknown as Prisma.InputJsonValue },
      });
    });

    return {
      autoDisabled,
      failureCount: nextFailureCount,
    };
  }

  private async emitAutoDisabled(
    config: WebhookConfigRow,
    jobData: WebhookDispatchJobData,
    failureCount: number,
  ): Promise<void> {
    try {
      await this.eventProducer.addInternalEvent(
        'webhook.auto_disabled',
        {
          webhookId: config.chave.toString(),
          projectId: config.dEntidadeId?.toString() ?? null,
          idEntidade: config.dEntidadeId?.toString() ?? null,
          eventType: jobData.eventType,
          eventId: BigInt(jobData.eventId).toString(),
          deliveryId: jobData.deliveryId,
          failureCount,
        },
        BigInt(jobData.eventId).toString(),
        { source: 'webhooks.dispatch.processor' },
      );
    } catch (err: unknown) {
      this.logger.error(
        `webhook_auto_disabled_event_failed webhookId=${config.chave.toString()} ` +
          `eventId=${jobData.eventId} error=${this.toErrorMessage(err)}`,
      );
    }
  }

  private async scheduleRetry(jobData: WebhookDispatchJobData): Promise<void> {
    const delay = this.retryService.calcDelay(jobData.attempt);
    const nextData: WebhookDispatchJobData = {
      ...jobData,
      attempt: jobData.attempt + 1,
    };

    await this.queue.add('dispatch', nextData, {
      delay,
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
      jobId: `${nextData.deliveryId}:${nextData.attempt}`,
    });

    this.logger.log(
      `webhook_retry_scheduled webhookId=${jobData.webhookId} ` +
        `deliveryId=${jobData.deliveryId} nextAttempt=${nextData.attempt} delayMs=${delay}`,
    );
  }

  private buildAttemptMeta(
    jobData: WebhookDispatchJobData,
    attempt: {
      status: 'success' | 'fail';
      httpCode: number | null;
      durationMs: number;
      errorMessage?: string | null;
    },
  ): Prisma.InputJsonValue {
    return {
      webhookId: BigInt(jobData.webhookId).toString(),
      eventType: jobData.eventType,
      eventId: BigInt(jobData.eventId).toString(),
      deliveryId: jobData.deliveryId,
      attempt: jobData.attempt,
      status: attempt.status,
      httpCode: attempt.httpCode,
      durationMs: attempt.durationMs,
      ...(attempt.errorMessage ? { errorMessage: attempt.errorMessage } : {}),
    };
  }

  private parseDados(raw: Prisma.JsonValue): StoredWebhookDados {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Dados do webhook invalidos');
    }

    const dados = raw as Record<string, unknown>;
    if (typeof dados.url !== 'string' || typeof dados.secretEncrypted !== 'string') {
      throw new Error('Dados do webhook invalidos');
    }

    return {
      url: dados.url,
      events: Array.isArray(dados.events)
        ? dados.events.filter((event): event is string => typeof event === 'string')
        : [],
      secretEncrypted: dados.secretEncrypted,
      disabled: dados.disabled === true,
      failureCount: typeof dados.failureCount === 'number' ? dados.failureCount : 0,
      createdAt: typeof dados.createdAt === 'string' ? dados.createdAt : '',
      lastSuccessAt: typeof dados.lastSuccessAt === 'string' ? dados.lastSuccessAt : null,
      lastFailureAt: typeof dados.lastFailureAt === 'string' ? dados.lastFailureAt : null,
    };
  }

  private getTimeoutMs(): number {
    const configured = this.configService.get<string>('WEBHOOK_DISPATCH_TIMEOUT_MS');
    if (!configured || !/^\d+$/.test(configured)) return 10_000;
    const timeout = Number(configured);
    return timeout > 0 ? timeout : 10_000;
  }

  private toErrorMessage(err: unknown): string {
    if (err !== null && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
      return `timeout_${this.getTimeoutMs()}ms`;
    }

    if (err instanceof Error) {
      return err.message || 'network_error';
    }
    return 'network_error';
  }
}
