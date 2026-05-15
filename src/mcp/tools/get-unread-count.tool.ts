import { Injectable, Logger } from '@nestjs/common';

import { NotificationsService } from '../../notifications/notifications.service';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import { assertRecord, textResult } from './tool-params';

/**
 * Tool MCP `get_unread_count` — retorna contagem de notificacoes nao lidas.
 *
 * Consulta `DEvento -490` filtrando registros sem `metaDados.read = true`.
 * Retorna um numero inteiro (`count`) para exibicao em badges de UI/LLM.
 *
 * NAO usa Engine: consulta read-only via `NotificationsService` (Prisma direto).
 * Pilar 1 (Engine) aplica apenas em DPedido idClasse=-300.
 *
 * @example
 * ```json
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "method": "tools/call",
 *   "params": {
 *     "name": "get_unread_count",
 *     "arguments": {}
 *   }
 * }
 * ```
 */
@Injectable()
export class GetUnreadCountTool implements McpTool {
  private readonly logger = new Logger(GetUnreadCountTool.name);

  readonly name = 'get_unread_count';
  readonly description =
    'Retorna a contagem de notificações não-lidas do usuário autenticado.';
  readonly inputSchema = {
    type: 'object',
    properties: {},
  };

  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Handler do tools/call para `get_unread_count`.
   *
   * Fluxo:
   * 1. Valida `params` como Record (sem campos obrigatorios).
   * 2. Chama `notificationsService.getUnreadCount(ctx.dEntidadeId)`.
   * 3. Retorna `{ count: N }` via `textResult`.
   *
   * @param params - Argumentos da chamada (nenhum esperado)
   * @param ctx - Contexto MCP autenticado (contém `dEntidadeId` como bigint)
   * @returns Envelope MCP com `{ count: number }`
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    assertRecord(params);

    this.logger.debug?.(`get_unread_count user=${ctx.dEntidadeId}`);

    const result = await this.notificationsService.getUnreadCount(ctx.dEntidadeId);

    return textResult(result);
  }
}
