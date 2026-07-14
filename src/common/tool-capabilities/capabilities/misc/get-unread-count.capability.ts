import { Injectable } from '@nestjs/common';

import { NotificationsService } from '../../../../notifications/notifications.service';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/**
 * `GetUnreadCountCapability` — capability neutra `get_unread_count`
 * (Onda 3, reads so-MCP).
 *
 * Casca fina READ-ONLY sobre `NotificationsService.getUnreadCount` — a MESMA
 * chamada que o wrapper legado MCP
 * (`src/mcp/tools/get-unread-count.tool.ts`) ja faz. Nenhum parametro de
 * entrada; o ator e SEMPRE `principal.actorEntidadeId`.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 3 (misc-read)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 */
@Injectable()
export class GetUnreadCountCapability implements Capability {
  readonly name = 'get_unread_count';
  readonly description = 'Retorna a contagem de notificações não-lidas do usuário autenticado.';
  readonly inputSchema = {
    type: 'object',
    properties: {},
  };
  readonly requiredScopes = ['notifications:read'] as const;

  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Retorna a contagem de notificacoes nao lidas do ator.
   *
   * @param _input - Nenhum parametro esperado.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com `{ count: number }`.
   */
  async run(
    _input: Record<string, unknown>,
    principal: ToolPrincipal,
  ): Promise<CapabilityResult> {
    const result = await this.notificationsService.getUnreadCount(principal.actorEntidadeId);
    return { data: result };
  }
}
