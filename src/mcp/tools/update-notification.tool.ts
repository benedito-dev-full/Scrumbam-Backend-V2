import { Injectable, Logger } from '@nestjs/common';

import { NotificationsService } from '../../notifications/notifications.service';
import { MCP_SCOPES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  assertRecord,
  invalidParams,
  optionalString,
  parseBigIntParam,
  requireScope,
  requiredString,
  textResult,
} from './tool-params';

const VALID_ACTIONS = ['mark_read', 'mark_all_read', 'delete'] as const;
type NotificationAction = (typeof VALID_ACTIONS)[number];

/**
 * Tool MCP `update_notification` — marca notificacoes como lidas ou deleta.
 *
 * Suporta 3 acoes:
 *  - `mark_read`: marca uma notificacao especifica como lida (notificationId obrigatorio).
 *  - `mark_all_read`: marca todas as notificacoes nao lidas como lidas (notificationId ignorado).
 *  - `delete`: exclui logicamente uma notificacao (notificationId obrigatorio).
 *
 * NAO usa Engine: operacoes estruturais via `NotificationsService` (Prisma direto).
 * Pilar 1 (Engine) aplica apenas em DPedido idClasse=-300.
 */
@Injectable()
export class UpdateNotificationTool implements McpTool {
  private readonly logger = new Logger(UpdateNotificationTool.name);

  readonly name = 'update_notification';
  readonly description =
    'Marca notificação como lida, marca todas como lidas, ou deleta uma notificação. Para mark_read e delete, notificationId é obrigatório.';
  readonly inputSchema = {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['mark_read', 'mark_all_read', 'delete'] },
      notificationId: { type: 'string' },
    },
  };

  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Handler do tools/call para `update_notification`.
   *
   * @param params - Argumentos da chamada (action + notificationId opcional)
   * @param ctx - Contexto MCP autenticado (contém `dEntidadeId` como bigint)
   * @returns Envelope MCP com `{ success: true, action }`
   * @throws {McpToolError} FORBIDDEN (-32002) quando scope `notifications:write` ausente
   * @throws {McpToolError} INVALID_PARAMS quando action invalida ou notificationId ausente/invalido
   * @throws {NotFoundException} Quando notificacao nao encontrada ou pertence a outro usuario
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    // Gate de autorização (ADR-V2-068). Antes de qualquer query.
    requireScope(ctx, MCP_SCOPES.NOTIFICATIONS_WRITE);

    const input = assertRecord(params);
    const actionRaw = requiredString(input, 'action');

    if (!VALID_ACTIONS.includes(actionRaw as NotificationAction)) {
      throw invalidParams('action', `must be one of: ${VALID_ACTIONS.join(', ')}`);
    }

    const action = actionRaw as NotificationAction;

    this.logger.debug?.(`update_notification action=${action} user=${ctx.dEntidadeId}`);

    if (action === 'mark_all_read') {
      await this.notificationsService.markAllAsRead(ctx.dEntidadeId);
      return textResult({ success: true, action });
    }

    // mark_read e delete requerem notificationId.
    const notificationIdStr = optionalString(input, 'notificationId');
    if (!notificationIdStr) {
      throw invalidParams('notificationId', 'required for mark_read and delete actions');
    }

    const notificationId = parseBigIntParam(notificationIdStr, 'notificationId');

    if (action === 'mark_read') {
      await this.notificationsService.markAsRead(notificationId, ctx.dEntidadeId);
    } else {
      // action === 'delete'
      await this.notificationsService.delete(notificationId, ctx.dEntidadeId);
    }

    return textResult({ success: true, action });
  }
}
