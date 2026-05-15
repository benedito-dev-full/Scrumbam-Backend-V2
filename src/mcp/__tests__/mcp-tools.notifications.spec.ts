import { NotFoundException } from '@nestjs/common';

import { McpRouterService } from '../services/mcp-router.service';
import { GetUnreadCountTool } from '../tools/get-unread-count.tool';
import { ListNotificationsTool } from '../tools/list-notifications.tool';
import { UpdateNotificationTool } from '../tools/update-notification.tool';

/**
 * Specs para as tools MCP de notificacoes (Task #3 — MCP Expansion).
 *
 * Cobre as 3 tools em um arquivo consolidado:
 *
 * list_notifications:
 *   (a) happy path — retorna lista com defaults (limit=20)
 *   (b) unreadOnly: true — passa flag corretamente para service
 *   (c) limit e cursor personalizados — passados corretamente ao service
 *   (d) limit fora do range (>50) — INVALID_PARAMS
 *
 * update_notification:
 *   (e) mark_all_read — chama markAllAsRead sem notificationId
 *   (f) mark_read com notificationId — chama markAsRead corretamente
 *   (g) delete com notificationId — chama delete corretamente
 *   (h) mark_read sem notificationId — INVALID_PARAMS
 *   (i) action invalida — INVALID_PARAMS
 *
 * get_unread_count:
 *   (j) happy path — retorna { count: N }
 *   (k) dEntidadeId passado corretamente ao service (bigint)
 */
describe('MCP tools de notificacoes (list_notifications, update_notification, get_unread_count)', () => {
  const userCtx = {
    dEntidadeId: BigInt('9007199254740991'),
    scopes: ['tools:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  const notificationId = '1000000000000001';

  const mockListResult = {
    items: [{ id: notificationId, descricao: 'Test', isRead: false, criadoEm: new Date().toISOString() }],
    pagination: { hasMore: false, nextCursor: null },
  };

  const mockUnreadCountResult = { count: 5 };

  let notificationsService: {
    findMany: jest.Mock;
    markAllAsRead: jest.Mock;
    markAsRead: jest.Mock;
    delete: jest.Mock;
    getUnreadCount: jest.Mock;
  };
  let router: McpRouterService;

  beforeEach(() => {
    notificationsService = {
      findMany: jest.fn().mockResolvedValue(mockListResult),
      markAllAsRead: jest.fn().mockResolvedValue({ updated: 3 }),
      markAsRead: jest.fn().mockResolvedValue({ id: notificationId, isRead: true }),
      delete: jest.fn().mockResolvedValue(undefined),
      getUnreadCount: jest.fn().mockResolvedValue(mockUnreadCountResult),
    };

    router = new McpRouterService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new ListNotificationsTool(notificationsService as never),
      new UpdateNotificationTool(notificationsService as never),
      new GetUnreadCountTool(notificationsService as never),
    );
  });

  // ---------------------------------------------------------------------------
  // list_notifications
  // ---------------------------------------------------------------------------

  it('(a) list_notifications happy path — retorna lista com defaults', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_notifications', arguments: {} },
      userCtx,
    );

    expect(notificationsService.findMany).toHaveBeenCalledTimes(1);
    expect(notificationsService.findMany).toHaveBeenCalledWith(
      userCtx.dEntidadeId,
      expect.objectContaining({ limit: 20 }),
    );
    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(mockListResult) }],
    });
  });

  it('(b) list_notifications com unreadOnly: true — passa flag corretamente para service', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'list_notifications', arguments: { unreadOnly: true } },
      userCtx,
    );

    expect(notificationsService.findMany).toHaveBeenCalledWith(
      userCtx.dEntidadeId,
      expect.objectContaining({ unreadOnly: 'true' }),
    );
  });

  it('(c) list_notifications com limit e cursor — passados corretamente ao service', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'list_notifications', arguments: { limit: 10, cursor: '9999' } },
      userCtx,
    );

    expect(notificationsService.findMany).toHaveBeenCalledWith(
      userCtx.dEntidadeId,
      expect.objectContaining({ limit: 10, cursor: '9999' }),
    );
  });

  it('(d) list_notifications com limit fora do range (>50) — INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_notifications', arguments: { limit: 100 } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        message: 'Invalid params',
        data: expect.objectContaining({ field: 'limit' }),
      }),
    );
    expect(notificationsService.findMany).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // update_notification
  // ---------------------------------------------------------------------------

  it('(e) update_notification mark_all_read — chama markAllAsRead sem notificationId', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_notification', arguments: { action: 'mark_all_read' } },
      userCtx,
    );

    expect(notificationsService.markAllAsRead).toHaveBeenCalledTimes(1);
    expect(notificationsService.markAllAsRead).toHaveBeenCalledWith(userCtx.dEntidadeId);
    expect(notificationsService.markAsRead).not.toHaveBeenCalled();
    expect(notificationsService.delete).not.toHaveBeenCalled();

    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'mark_all_read' }) }],
    });
  });

  it('(f) update_notification mark_read com notificationId — chama markAsRead corretamente', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_notification', arguments: { action: 'mark_read', notificationId } },
      userCtx,
    );

    expect(notificationsService.markAsRead).toHaveBeenCalledTimes(1);
    expect(notificationsService.markAsRead).toHaveBeenCalledWith(
      BigInt(notificationId),
      userCtx.dEntidadeId,
    );
    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'mark_read' }) }],
    });
  });

  it('(g) update_notification delete com notificationId — chama delete corretamente', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_notification', arguments: { action: 'delete', notificationId } },
      userCtx,
    );

    expect(notificationsService.delete).toHaveBeenCalledTimes(1);
    expect(notificationsService.delete).toHaveBeenCalledWith(
      BigInt(notificationId),
      userCtx.dEntidadeId,
    );
    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'delete' }) }],
    });
  });

  it('(h) update_notification mark_read sem notificationId — INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_notification', arguments: { action: 'mark_read' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        message: 'Invalid params',
        data: expect.objectContaining({ field: 'notificationId' }),
      }),
    );
    expect(notificationsService.markAsRead).not.toHaveBeenCalled();
  });

  it('(i) update_notification action invalida — INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_notification', arguments: { action: 'invalid_action' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        message: 'Invalid params',
        data: expect.objectContaining({ field: 'action' }),
      }),
    );
    expect(notificationsService.markAllAsRead).not.toHaveBeenCalled();
    expect(notificationsService.markAsRead).not.toHaveBeenCalled();
    expect(notificationsService.delete).not.toHaveBeenCalled();
  });

  it('(h2) update_notification NotFoundException (notificacao nao encontrada) — propagada como exception', async () => {
    notificationsService.markAsRead.mockRejectedValueOnce(new NotFoundException('Notification not found'));

    await expect(
      router.dispatch(
        'tools/call',
        { name: 'update_notification', arguments: { action: 'mark_read', notificationId } },
        userCtx,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // ---------------------------------------------------------------------------
  // get_unread_count
  // ---------------------------------------------------------------------------

  it('(j) get_unread_count happy path — retorna { count: N }', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_unread_count', arguments: {} },
      userCtx,
    );

    expect(notificationsService.getUnreadCount).toHaveBeenCalledTimes(1);
    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(mockUnreadCountResult) }],
    });
  });

  it('(k) get_unread_count verifica que dEntidadeId e passado corretamente (bigint)', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'get_unread_count', arguments: {} },
      userCtx,
    );

    const callArgs = notificationsService.getUnreadCount.mock.calls[0];
    expect(callArgs[0]).toBe(userCtx.dEntidadeId);
    expect(typeof callArgs[0]).toBe('bigint');
  });
});
