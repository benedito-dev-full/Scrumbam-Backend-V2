import { Injectable } from '@nestjs/common';

import { NotificationsService } from '../../../../notifications/notifications.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

const VALID_ACTIONS = ['mark_read', 'mark_all_read', 'delete'] as const;
type NotificationAction = (typeof VALID_ACTIONS)[number];

/**
 * `UpdateNotificationCapability` — capability neutra `update_notification` (Onda 4).
 *
 * Casca FINA sobre `NotificationsService` — marca notificacoes como lidas ou
 * deleta. MESMA delegacao do wrapper legado
 * (`src/mcp/tools/update-notification.tool.ts`). Suporta 3 acoes:
 *  - `mark_read`: marca UMA notificacao como lida (`notificationId` obrigatorio).
 *  - `mark_all_read`: marca todas as nao lidas como lidas (`notificationId` ignorado).
 *  - `delete`: exclui logicamente UMA notificacao (`notificationId` obrigatorio).
 *
 * Tenant isolation (ADR-V2-042): `principal.actorEntidadeId` (SEMPRE do auth) e
 * repassado ao service, que valida que a notificacao pertence ao usuario.
 *
 * NAO usa Engine: operacoes estruturais via `NotificationsService` (Prisma
 * direto). Pilar 1 (Engine) aplica apenas em DPedido idClasse=-300.
 *
 * `requiredScopes: ['notifications:write']` — espelha `requireScope(ctx,
 * MCP_SCOPES.NOTIFICATIONS_WRITE)`. No Nexus, `principal.can('notifications:write')`.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 4 (notifications-write)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 */
@Injectable()
export class UpdateNotificationCapability implements Capability {
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
  readonly requiredScopes = ['notifications:write'] as const;

  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Executa a acao de notificacao. Valida `action` (enum) e, para
   * mark_read/delete, `notificationId` (BigInt), e delega ao service.
   *
   * @param input - `{ action, notificationId? }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com `{ success: true, action }`.
   * @throws {CapabilityError} `INVALID_INPUT` quando action invalida ou
   *   notificationId ausente/invalido.
   * @throws {import('@nestjs/common').NotFoundException} Notificacao nao
   *   encontrada ou pertence a outro usuario.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const actionRaw = this.requiredString(input, 'action');

    if (!VALID_ACTIONS.includes(actionRaw as NotificationAction)) {
      throw new CapabilityError('INVALID_INPUT', `action: must be one of: ${VALID_ACTIONS.join(', ')}`, {
        field: 'action',
      });
    }

    const action = actionRaw as NotificationAction;

    if (action === 'mark_all_read') {
      await this.notificationsService.markAllAsRead(principal.actorEntidadeId);
      return { data: { success: true, action } };
    }

    // mark_read e delete requerem notificationId.
    const notificationIdStr = this.optionalString(input, 'notificationId');
    if (!notificationIdStr) {
      throw new CapabilityError('INVALID_INPUT', 'notificationId: required for mark_read and delete actions', {
        field: 'notificationId',
      });
    }

    this.assertBigIntParseable(notificationIdStr, 'notificationId');
    const notificationId = BigInt(notificationIdStr);

    if (action === 'mark_read') {
      await this.notificationsService.markAsRead(notificationId, principal.actorEntidadeId);
    } else {
      // action === 'delete'
      await this.notificationsService.delete(notificationId, principal.actorEntidadeId);
    }

    return { data: { success: true, action } };
  }

  private requiredString(input: Record<string, unknown>, field: string): string {
    const value = input[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', `${field}: required string`, { field });
    }
    return value;
  }

  private optionalString(input: Record<string, unknown>, field: string): string | undefined {
    const value = input[field];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', `${field}: string expected`, { field });
    }
    return value;
  }

  private assertBigIntParseable(value: string, field: string): void {
    try {
      BigInt(value);
    } catch {
      throw new CapabilityError('INVALID_INPUT', `${field}: valid bigint string expected`, {
        field,
      });
    }
  }
}
