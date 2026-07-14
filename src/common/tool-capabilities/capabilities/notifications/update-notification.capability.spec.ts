import { NotFoundException } from '@nestjs/common';

import toolsSchema from '../../../../mcp/schemas/tools.schema.json';
import { fromMcp, fromNexus } from '../../tool-principal';
import { UpdateNotificationCapability } from './update-notification.capability';

/**
 * Onda 4 (writes so-MCP) — `UpdateNotificationCapability`.
 *
 * Espelha `src/mcp/tools/update-notification.tool.ts`: 3 acoes (mark_read,
 * mark_all_read, delete); notificationId obrigatorio p/ mark_read/delete;
 * actorEntidadeId sempre do principal. Prova paridade byte-a-byte com schema.
 */
describe('UpdateNotificationCapability (Onda 4 — writes so-MCP ADR-V2-079)', () => {
  let notificationsService: {
    markAsRead: jest.Mock;
    markAllAsRead: jest.Mock;
    delete: jest.Mock;
  };
  let capability: UpdateNotificationCapability;

  beforeEach(() => {
    notificationsService = {
      markAsRead: jest.fn().mockResolvedValue(undefined),
      markAllAsRead: jest.fn().mockResolvedValue({ affected: 4 }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    capability = new UpdateNotificationCapability(notificationsService as never);
  });

  it('metadados: nome canonico, scope notifications:write; paridade byte-a-byte com schema', () => {
    expect(capability.name).toBe('update_notification');
    expect(capability.requiredScopes).toEqual(['notifications:write']);
    const t = toolsSchema.tools.find((x) => x.name === 'update_notification');
    expect(capability.description).toBe(t!.description);
    expect(capability.inputSchema).toEqual(t!.inputSchema);
  });

  it('mark_all_read: ignora notificationId e delega actorEntidadeId', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(5), scopes: ['notifications:write'] });

    const result = await capability.run({ action: 'mark_all_read' }, principal);

    expect(notificationsService.markAllAsRead).toHaveBeenCalledWith(principal.actorEntidadeId);
    expect(result).toEqual({ data: { success: true, action: 'mark_all_read' } });
  });

  it('mark_read: converte notificationId para BigInt e delega', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(5), scopes: ['notifications:write'] });

    const result = await capability.run({ action: 'mark_read', notificationId: '77' }, principal);

    expect(notificationsService.markAsRead).toHaveBeenCalledWith(BigInt(77), principal.actorEntidadeId);
    expect(result).toEqual({ data: { success: true, action: 'mark_read' } });
  });

  it('delete: delega ao service e retorna envelope', async () => {
    const principal = fromNexus({ actorEntidadeId: BigInt(9), grantedScopes: ['notifications:write'] });

    const result = await capability.run({ action: 'delete', notificationId: '88' }, principal);

    expect(notificationsService.delete).toHaveBeenCalledWith(BigInt(88), principal.actorEntidadeId);
    expect(result).toEqual({ data: { success: true, action: 'delete' } });
  });

  it('action invalida → INVALID_INPUT, service nao chamado', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(5), scopes: ['notifications:write'] });

    await expect(capability.run({ action: 'archive' }, principal)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      data: { field: 'action' },
    });
    expect(notificationsService.markAsRead).not.toHaveBeenCalled();
  });

  it('mark_read sem notificationId → INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(5), scopes: ['notifications:write'] });

    await expect(capability.run({ action: 'mark_read' }, principal)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      data: { field: 'notificationId' },
    });
  });

  it('notificationId nao-BigInt → INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(5), scopes: ['notifications:write'] });

    await expect(
      capability.run({ action: 'delete', notificationId: 'abc' }, principal),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', data: { field: 'notificationId' } });
    expect(notificationsService.delete).not.toHaveBeenCalled();
  });

  it('NotFoundException do service propaga UNCHANGED', async () => {
    notificationsService.markAsRead.mockRejectedValue(new NotFoundException('Nao encontrada'));
    const principal = fromMcp({ actorEntidadeId: BigInt(5), scopes: ['notifications:write'] });

    await expect(
      capability.run({ action: 'mark_read', notificationId: '77' }, principal),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
