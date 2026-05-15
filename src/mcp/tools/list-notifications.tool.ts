import { Injectable, Logger } from '@nestjs/common';

import { NotificationsService } from '../../notifications/notifications.service';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  assertRecord,
  optionalLimit,
  optionalString,
  textResult,
} from './tool-params';

/**
 * Tool MCP `list_notifications` — lista notificacoes do usuario autenticado.
 *
 * Usa cursor pagination sobre `DEvento -490`. Suporta filtro `unreadOnly`
 * para retornar apenas notificacoes sem leitura confirmada.
 *
 * NAO usa Engine: consulta estrutural via `NotificationsService` (Prisma direto).
 * Pilar 1 (Engine) aplica apenas em DPedido idClasse=-300.
 *
 * @example
 * ```json
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "method": "tools/call",
 *   "params": {
 *     "name": "list_notifications",
 *     "arguments": {
 *       "unreadOnly": true,
 *       "limit": 10
 *     }
 *   }
 * }
 * ```
 */
@Injectable()
export class ListNotificationsTool implements McpTool {
  private readonly logger = new Logger(ListNotificationsTool.name);

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

  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Handler do tools/call para `list_notifications`.
   *
   * Fluxo:
   * 1. Valida `params` como Record (todos os campos sao opcionais).
   * 2. Extrai `limit` (default 20, clampar 1-50 via `optionalLimit`).
   * 3. Extrai `cursor` como string opcional.
   * 4. Extrai `unreadOnly` como boolean opcional.
   * 5. Constroi DTO compativel com `ListNotificationsQueryDto` (unreadOnly como string).
   * 6. Chama `notificationsService.findMany(ctx.dEntidadeId, query)`.
   * 7. Retorna resultado via `textResult`.
   *
   * @param params - Argumentos da chamada (todos opcionais)
   * @param ctx - Contexto MCP autenticado (contém `dEntidadeId` como bigint)
   * @returns Envelope MCP com lista paginada de notificacoes
   * @throws {McpToolError} INVALID_PARAMS quando `limit` fora do range 1-50
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = assertRecord(params);

    const limit = optionalLimit(input);
    const cursor = optionalString(input, 'cursor');

    // unreadOnly chega como boolean no MCP mas o service espera string ('true'/'false').
    const unreadOnlyRaw = input.unreadOnly;
    const unreadOnly =
      unreadOnlyRaw === true
        ? 'true'
        : unreadOnlyRaw === false
          ? 'false'
          : undefined;

    this.logger.debug?.(
      `list_notifications user=${ctx.dEntidadeId} limit=${limit} unreadOnly=${unreadOnly ?? 'all'}`,
    );

    const result = await this.notificationsService.findMany(ctx.dEntidadeId, {
      limit,
      cursor,
      unreadOnly,
    });

    return textResult(result);
  }
}
