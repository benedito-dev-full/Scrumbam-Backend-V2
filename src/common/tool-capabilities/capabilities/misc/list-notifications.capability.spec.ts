import { fromMcp } from '../../tool-principal';
import { CapabilityError } from '../../capability-error';
import { ListNotificationsCapability } from './list-notifications.capability';

/**
 * Onda 3 (reads so-MCP) — `ListNotificationsCapability`.
 *
 * Espelha `src/mcp/tools/list-notifications.tool.ts`: conversao
 * `unreadOnly` boolean -> string ('true'/'false') antes de delegar ao
 * service (o service espera string).
 */
describe('ListNotificationsCapability (Onda 3 — reads so-MCP)', () => {
  const page = { items: [{ id: '1' }], pagination: { hasMore: false, nextCursor: null } };

  let notificationsService: { findMany: jest.Mock };
  let capability: ListNotificationsCapability;

  beforeEach(() => {
    notificationsService = { findMany: jest.fn().mockResolvedValue(page) };
    capability = new ListNotificationsCapability(notificationsService as never);
  });

  it('metadados: nome canonico, scope notifications:read', () => {
    expect(capability.name).toBe('list_notifications');
    expect(capability.requiredScopes).toEqual(['notifications:read']);
  });

  it('lista notificacoes do ator com limit default', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['notifications:read'] });

    const result = await capability.run({}, principal);

    expect(notificationsService.findMany).toHaveBeenCalledWith(principal.actorEntidadeId, {
      limit: 20,
      cursor: undefined,
      unreadOnly: undefined,
    });
    expect(result).toEqual({ data: page });
  });

  it('unreadOnly=true (boolean) vira string "true" no service', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['notifications:read'] });

    await capability.run({ unreadOnly: true }, principal);

    expect(notificationsService.findMany).toHaveBeenCalledWith(
      principal.actorEntidadeId,
      expect.objectContaining({ unreadOnly: 'true' }),
    );
  });

  it('unreadOnly=false (boolean) vira string "false" no service', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['notifications:read'] });

    await capability.run({ unreadOnly: false }, principal);

    expect(notificationsService.findMany).toHaveBeenCalledWith(
      principal.actorEntidadeId,
      expect.objectContaining({ unreadOnly: 'false' }),
    );
  });

  it('unreadOnly nao-boolean -> INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['notifications:read'] });

    await expect(
      capability.run({ unreadOnly: 'yes' as never }, principal),
    ).rejects.toThrow(CapabilityError);
  });
});
