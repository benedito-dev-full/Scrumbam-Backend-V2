import { Prisma } from '@prisma/client';
import { NotificationResponseDto } from '../dto/notification-response.dto';

interface DEventoNotificationRow {
  chave: bigint;
  idClasse: bigint;
  idEntidade: bigint | null;
  descricao: string | null;
  metaDados: Prisma.JsonValue | null;
  criadoEm: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Serializa uma notificacao `DEvento -490` para contrato HTTP.
 *
 * @param row - Linha selecionada de `DEvento`.
 * @returns DTO sem BigInt cru.
 */
export function formatNotificationResponse(row: DEventoNotificationRow): NotificationResponseDto {
  const meta = isRecord(row.metaDados) ? row.metaDados : {};
  const title = readString(meta, 'title') ?? 'Notificacao';
  const message = readString(meta, 'message') ?? row.descricao ?? '';

  return {
    id: row.chave.toString(),
    idClasse: row.idClasse.toString(),
    recipientId: row.idEntidade?.toString() ?? null,
    eventType: readString(meta, 'eventType'),
    title,
    message,
    read: meta.read === true,
    taskId: readString(meta, 'taskId'),
    projectId: readString(meta, 'projectId'),
    executionId: readString(meta, 'executionId'),
    createdAt: row.criadoEm.toISOString(),
    metadata: meta,
  };
}
