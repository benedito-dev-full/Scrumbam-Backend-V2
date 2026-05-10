import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import {
  ListNotificationsResponseDto,
  MarkAllReadResponseDto,
  UnreadCountResponseDto,
} from './dto/list-notifications-response.dto';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { formatNotificationResponse } from './helpers/format-notification-response';

const NOTIFICATION_CLASSE = BigInt(-490);
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeReadState(metaDados: Prisma.JsonValue | null, readAt: string): Prisma.InputJsonValue {
  const meta = isRecord(metaDados) ? metaDados : {};
  return {
    ...meta,
    read: true,
    readAt,
  } as Prisma.InputJsonValue;
}

/**
 * Service de notificacoes in-app persistidas em `DEvento -490`.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista notificacoes do usuario autenticado com cursor pagination.
   *
   * @param userEntidadeId - `DEntidade.chave` do usuario autenticado.
   * @param query - Filtros de listagem.
   * @returns Lista paginada sem BigInt cru.
   */
  async findMany(
    userEntidadeId: bigint,
    query: ListNotificationsQueryDto,
  ): Promise<ListNotificationsResponseDto> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const cursor = query.cursor ? BigInt(query.cursor) : undefined;
    const unreadOnly = query.unreadOnly === 'true';

    const rows = unreadOnly
      ? await this.findUnreadRows(userEntidadeId, limit + 1, cursor)
      : await this.prisma.dEvento.findMany({
          where: {
            idClasse: NOTIFICATION_CLASSE,
            idEntidade: userEntidadeId,
            excluido: false,
            ...(cursor !== undefined ? { chave: { lt: cursor } } : {}),
          },
          select: {
            chave: true,
            idClasse: true,
            idEntidade: true,
            descricao: true,
            metaDados: true,
            criadoEm: true,
          },
          orderBy: { chave: 'desc' },
          take: limit + 1,
        });

    const items = rows.slice(0, limit).map(formatNotificationResponse);
    const hasMore = rows.length > limit;

    return {
      items,
      pagination: {
        hasMore,
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      },
    };
  }

  /**
   * Conta notificacoes nao lidas do usuario.
   *
   * Notificacoes antigas sem `metaDados.read` contam como nao lidas.
   *
   * @param userEntidadeId - `DEntidade.chave` do usuario autenticado.
   * @returns Contagem de unread.
   */
  async getUnreadCount(userEntidadeId: bigint): Promise<UnreadCountResponseDto> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM "DEvento"
      WHERE "idClasse" = ${NOTIFICATION_CLASSE}
        AND "idEntidade" = ${userEntidadeId}
        AND "excluido" = false
        AND COALESCE(("metaDados"->>'read')::boolean, false) = false
    `;

    return { count: Number(rows[0]?.count ?? BigInt(0)) };
  }

  /**
   * Marca uma notificacao como lida, validando ownership.
   *
   * @param notificationId - `DEvento.chave` da notificacao.
   * @param userEntidadeId - `DEntidade.chave` do usuario autenticado.
   * @returns Notificacao atualizada.
   * @throws {NotFoundException} Quando a notificacao nao existe, pertence a outro usuario ou foi excluida.
   */
  async markAsRead(
    notificationId: bigint,
    userEntidadeId: bigint,
  ): Promise<NotificationResponseDto> {
    const now = new Date().toISOString();

    const updated = await this.prisma.$transaction(async (tx) => {
      const notification = await tx.dEvento.findFirst({
        where: {
          chave: notificationId,
          idClasse: NOTIFICATION_CLASSE,
          idEntidade: userEntidadeId,
          excluido: false,
        },
        select: { chave: true, metaDados: true },
      });

      if (!notification) {
        throw new NotFoundException('Notification not found');
      }

      return tx.dEvento.update({
        where: { chave: notification.chave },
        data: { metaDados: mergeReadState(notification.metaDados, now) },
        select: {
          chave: true,
          idClasse: true,
          idEntidade: true,
          descricao: true,
          metaDados: true,
          criadoEm: true,
        },
      });
    });

    return formatNotificationResponse(updated);
  }

  /**
   * Marca todas as notificacoes nao lidas do usuario como lidas em lote.
   *
   * @param userEntidadeId - `DEntidade.chave` do usuario autenticado.
   * @returns Quantidade de linhas atualizadas.
   */
  async markAllAsRead(userEntidadeId: bigint): Promise<MarkAllReadResponseDto> {
    const now = new Date().toISOString();
    const updated = await this.prisma.$executeRaw`
      UPDATE "DEvento"
      SET "metaDados" =
        jsonb_set(
          jsonb_set(COALESCE("metaDados"::jsonb, '{}'::jsonb), '{read}', 'true'::jsonb, true),
          '{readAt}',
          to_jsonb(${now}::text),
          true
        )
      WHERE "idClasse" = ${NOTIFICATION_CLASSE}
        AND "idEntidade" = ${userEntidadeId}
        AND "excluido" = false
        AND COALESCE(("metaDados"->>'read')::boolean, false) = false
    `;

    this.logger.debug(`marked all notifications read: user=${userEntidadeId} count=${updated}`);
    return { updated };
  }

  /**
   * Exclui logicamente uma notificacao do usuario.
   *
   * @param notificationId - `DEvento.chave` da notificacao.
   * @param userEntidadeId - `DEntidade.chave` do usuario autenticado.
   * @throws {NotFoundException} Quando a notificacao nao existe, pertence a outro usuario ou ja foi excluida.
   */
  async delete(notificationId: bigint, userEntidadeId: bigint): Promise<void> {
    const updated = await this.prisma.dEvento.updateMany({
      where: {
        chave: notificationId,
        idClasse: NOTIFICATION_CLASSE,
        idEntidade: userEntidadeId,
        excluido: false,
      },
      data: { excluido: true },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Notification not found');
    }
  }

  private async findUnreadRows(
    userEntidadeId: bigint,
    take: number,
    cursor?: bigint,
  ): Promise<
    Array<{
      chave: bigint;
      idClasse: bigint;
      idEntidade: bigint | null;
      descricao: string | null;
      metaDados: Prisma.JsonValue | null;
      criadoEm: Date;
    }>
  > {
    const cursorFilter =
      cursor !== undefined ? Prisma.sql`AND "chave" < ${cursor}` : Prisma.empty;

    return this.prisma.$queryRaw`
      SELECT "chave", "idClasse", "idEntidade", "descricao", "metaDados", "criadoEm"
      FROM "DEvento"
      WHERE "idClasse" = ${NOTIFICATION_CLASSE}
        AND "idEntidade" = ${userEntidadeId}
        AND "excluido" = false
        AND COALESCE(("metaDados"->>'read')::boolean, false) = false
        ${cursorFilter}
      ORDER BY "chave" DESC
      LIMIT ${take}
    `;
  }
}
