import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma.service';
import { SupportedEvent } from '../constants/supported-events';
import { ListAttemptsQueryDto } from '../dto/list-attempts-query.dto';
import { TestWebhookDto } from '../dto/test-webhook.dto';
import {
  ListWebhookAttemptsResponseDto,
  RedriveWebhookResponseDto,
  TestWebhookResponseDto,
  WebhookAttemptResponseDto,
} from '../dto/webhook-response.dto';
import {
  WEBHOOK_ATTEMPT_CLASS_ID,
  WEBHOOK_USER_AGENT,
  StoredWebhookDados,
} from '../types/webhook-dispatch-job';
import { WebhooksSigningService } from './webhooks-signing.service';
import { WebhooksSsrfService } from './webhooks-ssrf.service';
import { WEBHOOK_CLASS_ID } from './webhooks.service';

type WebhookConfigRow = {
  chave: bigint;
  dEntidadeId: bigint | null;
  dados: Prisma.JsonValue;
};

type AttemptRow = {
  chave: bigint;
  idClasse: bigint;
  idEntidade: bigint | null;
  identificadorExterno: string | null;
  descricao: string | null;
  metaDados: Prisma.JsonValue | null;
  criadoEm: Date;
};

@Injectable()
export class WebhooksRedriveService {
  private readonly logger = new Logger(WebhooksRedriveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signingService: WebhooksSigningService,
    private readonly ssrfService: WebhooksSsrfService,
    private readonly configService: ConfigService,
  ) {}

  async test(id: string, dto: TestWebhookDto = {}): Promise<TestWebhookResponseDto> {
    const webhookId = BigInt(id);
    const config = await this.findWebhookOrThrow(webhookId);
    const dados = this.parseDados(config.dados);

    await this.ssrfService.validateUrl(dados.url);

    const eventType =
      dto.eventType ?? (dados.events[0] as SupportedEvent | undefined) ?? 'task.created';
    const deliveryId = `test-${randomUUID()}`;
    const bodyString = JSON.stringify({
      id: deliveryId,
      type: eventType,
      eventId: '0',
      occurredAt: new Date().toISOString(),
      data: {
        test: true,
        webhookId: webhookId.toString(),
        ...(dto.payload ?? {}),
      },
      projectId: config.dEntidadeId?.toString() ?? null,
    });
    const signature = this.signingService.sign(
      this.signingService.decrypt(dados.secretEncrypted),
      bodyString,
    );
    const startedAt = Date.now();

    try {
      const response = await this.post(dados.url, bodyString, {
        eventType,
        deliveryId,
        signature,
      });
      const success = response.status >= 200 && response.status < 300;

      return {
        deliveryId,
        eventType,
        success,
        httpCode: response.status,
        durationMs: Date.now() - startedAt,
        errorMessage: success ? null : `HTTP ${response.status}`,
      };
    } catch (err: unknown) {
      return {
        deliveryId,
        eventType,
        success: false,
        httpCode: null,
        durationMs: Date.now() - startedAt,
        errorMessage: this.toErrorMessage(err),
      };
    }
  }

  async redrive(id: string): Promise<RedriveWebhookResponseDto> {
    const webhookId = BigInt(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const webhook = await tx.dTabela.findFirst({
        where: {
          chave: webhookId,
          idClasse: WEBHOOK_CLASS_ID,
          excluido: false,
        },
        select: { chave: true, dados: true },
      });

      if (!webhook) {
        throw new NotFoundException(`Webhook ${webhookId} nao encontrado`);
      }

      const dados = this.parseDados(webhook.dados);
      const nextDados: StoredWebhookDados = {
        ...dados,
        disabled: false,
        failureCount: 0,
      };

      return tx.dTabela.update({
        where: { chave: webhook.chave },
        data: { dados: nextDados as unknown as Prisma.InputJsonValue },
        select: { chave: true, dados: true },
      });
    });

    const dados = this.parseDados(updated.dados);
    this.logger.log(`webhook_redrive webhookId=${webhookId}`);

    return {
      id: updated.chave.toString(),
      disabled: dados.disabled,
      failureCount: dados.failureCount,
    };
  }

  async listAttempts(
    id: string,
    query: ListAttemptsQueryDto,
  ): Promise<ListWebhookAttemptsResponseDto> {
    const webhookId = BigInt(id);
    await this.findWebhookOrThrow(webhookId);

    const limit = Math.min(query.limit ?? 20, 100);
    const cursor = query.cursor ? BigInt(query.cursor) : undefined;
    const cursorFilter = cursor !== undefined ? Prisma.sql`AND "chave" < ${cursor}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<AttemptRow[]>`
      SELECT "chave", "idClasse", "idEntidade", "identificadorExterno", "descricao", "metaDados", "criadoEm"
      FROM "DEvento"
      WHERE "idClasse" = ${WEBHOOK_ATTEMPT_CLASS_ID}
        AND "excluido" = false
        AND "metaDados"->>'webhookId' = ${webhookId.toString()}
        ${cursorFilter}
      ORDER BY "chave" DESC
      LIMIT ${limit + 1}
    `;

    const items = rows.slice(0, limit).map((row) => this.toAttemptResponse(row));
    const hasMore = rows.length > limit;

    return {
      items,
      pagination: {
        hasMore,
        nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      },
    };
  }

  private async findWebhookOrThrow(webhookId: bigint): Promise<WebhookConfigRow> {
    const webhook = await this.prisma.dTabela.findFirst({
      where: {
        chave: webhookId,
        idClasse: WEBHOOK_CLASS_ID,
        excluido: false,
      },
      select: {
        chave: true,
        dEntidadeId: true,
        dados: true,
      },
    });

    if (!webhook) {
      throw new NotFoundException(`Webhook ${webhookId} nao encontrado`);
    }

    return webhook;
  }

  private async post(
    url: string,
    bodyString: string,
    context: { eventType: string; deliveryId: string; signature: string },
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.getTimeoutMs());

    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': context.signature,
          'X-Webhook-Event': context.eventType,
          'X-Webhook-Delivery': context.deliveryId,
          'User-Agent': WEBHOOK_USER_AGENT,
        },
        body: bodyString,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
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
        ? dados.events.filter(
            (event): event is SupportedEvent | string => typeof event === 'string',
          )
        : [],
      secretEncrypted: dados.secretEncrypted,
      disabled: dados.disabled === true,
      failureCount: typeof dados.failureCount === 'number' ? dados.failureCount : 0,
      createdAt: typeof dados.createdAt === 'string' ? dados.createdAt : '',
      lastSuccessAt: typeof dados.lastSuccessAt === 'string' ? dados.lastSuccessAt : null,
      lastFailureAt: typeof dados.lastFailureAt === 'string' ? dados.lastFailureAt : null,
    };
  }

  private toAttemptResponse(row: AttemptRow): WebhookAttemptResponseDto {
    return {
      id: row.chave.toString(),
      idClasse: row.idClasse.toString(),
      projectId: row.idEntidade?.toString() ?? null,
      descricao: row.descricao,
      identificadorExterno: row.identificadorExterno,
      criadoEm: row.criadoEm.toISOString(),
      metaDados:
        row.metaDados && typeof row.metaDados === 'object' && !Array.isArray(row.metaDados)
          ? (row.metaDados as Record<string, unknown>)
          : null,
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
