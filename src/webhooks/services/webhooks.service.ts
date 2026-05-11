import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { SupportedEvent } from '../constants/supported-events';
import { CreateWebhookDto } from '../dto/create-webhook.dto';
import { ListWebhooksQueryDto } from '../dto/list-webhooks-query.dto';
import { UpdateWebhookDto } from '../dto/update-webhook.dto';
import {
  ListWebhooksResponseDto,
  WebhookCreatedResponseDto,
  WebhookResponseDto,
} from '../dto/webhook-response.dto';
import { WebhooksSigningService } from './webhooks-signing.service';
import { WebhooksSsrfService } from './webhooks-ssrf.service';

export const WEBHOOK_CLASS_ID = BigInt(-470);
export const PROJECT_CLASS_ID = BigInt(-153);

interface StoredWebhookDados {
  url: string;
  events: SupportedEvent[];
  secretEncrypted: string;
  disabled: boolean;
  failureCount: number;
  createdAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

type WebhookTabela = {
  chave: bigint;
  dEntidadeId: bigint | null;
  nome: string;
  dados: Prisma.JsonValue;
  criadoEm: Date;
};

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signingService: WebhooksSigningService,
    private readonly ssrfService: WebhooksSsrfService,
  ) {}

  async create(dto: CreateWebhookDto): Promise<WebhookCreatedResponseDto> {
    const projectId = BigInt(dto.projectId);
    await this.ensureProjectExists(projectId);
    await this.ssrfService.validateUrl(dto.url);

    const secret = this.signingService.generateSecret();
    const secretEncrypted = this.signingService.encrypt(secret);
    const createdAt = new Date().toISOString();

    this.logger.log(`webhook_create projectId=${projectId} events=${dto.events.length}`);

    const tabela = await this.prisma.dTabela.create({
      data: {
        idClasse: WEBHOOK_CLASS_ID,
        dEntidadeId: projectId,
        nome: dto.url,
        dados: {
          url: dto.url,
          events: dto.events,
          secretEncrypted,
          disabled: false,
          failureCount: 0,
          createdAt,
          lastSuccessAt: null,
          lastFailureAt: null,
        } as Prisma.InputJsonValue,
      },
      select: {
        chave: true,
        dEntidadeId: true,
        nome: true,
        dados: true,
        criadoEm: true,
      },
    });

    return {
      ...this.toResponse(tabela),
      secret,
    };
  }

  async list(query: ListWebhooksQueryDto): Promise<ListWebhooksResponseDto> {
    const projectId = BigInt(query.projectId);
    const take = query.limit ?? 20;

    const webhooks = await this.prisma.dTabela.findMany({
      where: {
        idClasse: WEBHOOK_CLASS_ID,
        dEntidadeId: projectId,
        excluido: false,
        ...(query.cursor ? { chave: { lt: BigInt(query.cursor) } } : {}),
      },
      select: {
        chave: true,
        dEntidadeId: true,
        nome: true,
        dados: true,
        criadoEm: true,
      },
      take: take + 1,
      orderBy: { chave: 'desc' },
    });

    const hasMore = webhooks.length > take;
    const items = hasMore ? webhooks.slice(0, take) : webhooks;
    const nextCursor = hasMore ? items[items.length - 1].chave.toString() : null;

    return {
      items: items.map((webhook) => this.toResponse(webhook)),
      pagination: { hasMore, nextCursor },
    };
  }

  async findOne(id: string): Promise<WebhookResponseDto> {
    const webhook = await this.findWebhookOrThrow(BigInt(id));
    return this.toResponse(webhook);
  }

  async update(id: string, dto: UpdateWebhookDto): Promise<WebhookResponseDto> {
    const webhookId = BigInt(id);
    const existing = await this.findWebhookOrThrow(webhookId);
    const dados = this.parseDados(existing.dados);

    if (dto.url !== undefined) {
      await this.ssrfService.validateUrl(dto.url);
    }

    const nextDados: StoredWebhookDados = {
      ...dados,
      ...(dto.url !== undefined ? { url: dto.url } : {}),
      ...(dto.events !== undefined ? { events: dto.events } : {}),
    };

    this.logger.log(`webhook_update webhookId=${webhookId}`);

    const updated = await this.prisma.dTabela.update({
      where: { chave: webhookId },
      data: {
        ...(dto.url !== undefined ? { nome: dto.url } : {}),
        dados: nextDados as unknown as Prisma.InputJsonValue,
      },
      select: {
        chave: true,
        dEntidadeId: true,
        nome: true,
        dados: true,
        criadoEm: true,
      },
    });

    return this.toResponse(updated);
  }

  async delete(id: string): Promise<void> {
    const webhookId = BigInt(id);
    await this.findWebhookOrThrow(webhookId);

    this.logger.log(`webhook_delete webhookId=${webhookId}`);

    await this.prisma.dTabela.update({
      where: { chave: webhookId },
      data: { excluido: true, inativo: true },
    });
  }

  private async findWebhookOrThrow(webhookId: bigint): Promise<WebhookTabela> {
    const webhook = await this.prisma.dTabela.findFirst({
      where: {
        chave: webhookId,
        idClasse: WEBHOOK_CLASS_ID,
        excluido: false,
      },
      select: {
        chave: true,
        dEntidadeId: true,
        nome: true,
        dados: true,
        criadoEm: true,
      },
    });

    if (!webhook) {
      throw new NotFoundException(`Webhook ${webhookId} nao encontrado`);
    }

    return webhook;
  }

  private async ensureProjectExists(projectId: bigint): Promise<void> {
    const project = await this.prisma.dProject.findFirst({
      where: {
        chave: projectId,
        idClasse: PROJECT_CLASS_ID,
        excluido: false,
      },
      select: { chave: true },
    });

    if (!project) {
      throw new NotFoundException(`Projeto ${projectId} nao encontrado`);
    }
  }

  private toResponse(webhook: WebhookTabela): WebhookResponseDto {
    const dados = this.parseDados(webhook.dados);

    return {
      id: webhook.chave.toString(),
      projectId: webhook.dEntidadeId?.toString() ?? '',
      url: dados.url,
      events: dados.events,
      disabled: dados.disabled,
      failureCount: dados.failureCount,
      createdAt: dados.createdAt || webhook.criadoEm.toISOString(),
      lastSuccessAt: dados.lastSuccessAt,
      lastFailureAt: dados.lastFailureAt,
    };
  }

  private parseDados(raw: Prisma.JsonValue): StoredWebhookDados {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException('Dados do webhook invalidos');
    }

    const dados = raw as Record<string, unknown>;
    if (typeof dados.url !== 'string' || typeof dados.secretEncrypted !== 'string') {
      throw new BadRequestException('Dados do webhook invalidos');
    }

    return {
      url: dados.url,
      events: Array.isArray(dados.events)
        ? dados.events.filter((event): event is SupportedEvent => typeof event === 'string')
        : [],
      secretEncrypted: dados.secretEncrypted,
      disabled: dados.disabled === true,
      failureCount: typeof dados.failureCount === 'number' ? dados.failureCount : 0,
      createdAt: typeof dados.createdAt === 'string' ? dados.createdAt : '',
      lastSuccessAt: typeof dados.lastSuccessAt === 'string' ? dados.lastSuccessAt : null,
      lastFailureAt: typeof dados.lastFailureAt === 'string' ? dados.lastFailureAt : null,
    };
  }
}

