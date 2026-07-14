import { Injectable } from '@nestjs/common';

import { NotificationsService } from '../../../../notifications/notifications.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/**
 * `ListNotificationsCapability` — capability neutra `list_notifications`
 * (Onda 3, reads so-MCP).
 *
 * Casca fina READ-ONLY sobre `NotificationsService.findMany` (cursor
 * pagination sobre `DEvento -490`) — a MESMA chamada que o wrapper legado
 * MCP (`src/mcp/tools/list-notifications.tool.ts`) ja faz.
 *
 * `unreadOnly` chega como boolean no input neutro mas o service espera
 * string ('true'/'false') — a mesma conversao da tool legada e preservada.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 3 (misc-read)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 */
@Injectable()
export class ListNotificationsCapability implements Capability {
  readonly name = 'list_notifications';
  readonly description =
    'Lista notificações do usuário autenticado. Use unreadOnly para filtrar apenas não-lidas.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      cursor: { type: 'string' },
      unreadOnly: { type: 'boolean' },
    },
  };
  readonly requiredScopes = ['notifications:read'] as const;

  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Lista as notificacoes do ator, com paginacao por cursor e filtro opcional.
   *
   * @param input - `{ limit?: number, cursor?: string, unreadOnly?: boolean }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com a lista paginada de notificacoes.
   * @throws {CapabilityError} `INVALID_INPUT` quando `limit` fora do range 1-50.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const limit = this.optionalLimit(input);
    const cursor = this.optionalString(input, 'cursor');

    const unreadOnlyRaw = input.unreadOnly;
    if (unreadOnlyRaw !== undefined && unreadOnlyRaw !== null && typeof unreadOnlyRaw !== 'boolean') {
      throw new CapabilityError('INVALID_INPUT', 'unreadOnly: boolean expected', {
        field: 'unreadOnly',
      });
    }
    const unreadOnly =
      unreadOnlyRaw === true ? 'true' : unreadOnlyRaw === false ? 'false' : undefined;

    const result = await this.notificationsService.findMany(principal.actorEntidadeId, {
      limit,
      cursor,
      unreadOnly,
    });

    return { data: result };
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

  private optionalLimit(input: Record<string, unknown>): number {
    const value = input.limit;
    if (value === undefined || value === null) {
      return 20;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 50) {
      throw new CapabilityError('INVALID_INPUT', 'limit: integer between 1 and 50 expected', {
        field: 'limit',
      });
    }
    return value;
  }
}
