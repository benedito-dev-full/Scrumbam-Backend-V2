import { fromMcp } from '../../tool-principal';
import { GetUnreadCountCapability } from './get-unread-count.capability';

/**
 * Onda 3 (reads so-MCP) — `GetUnreadCountCapability`.
 *
 * Espelha `src/mcp/tools/get-unread-count.tool.ts`: sem parametros de
 * entrada, ator sempre `principal.actorEntidadeId`.
 */
describe('GetUnreadCountCapability (Onda 3 — reads so-MCP)', () => {
  let notificationsService: { getUnreadCount: jest.Mock };
  let capability: GetUnreadCountCapability;

  beforeEach(() => {
    notificationsService = { getUnreadCount: jest.fn().mockResolvedValue({ count: 3 }) };
    capability = new GetUnreadCountCapability(notificationsService as never);
  });

  it('metadados: nome canonico, scope notifications:read', () => {
    expect(capability.name).toBe('get_unread_count');
    expect(capability.requiredScopes).toEqual(['notifications:read']);
  });

  it('retorna a contagem do ator', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(42), scopes: ['notifications:read'] });

    const result = await capability.run({}, principal);

    expect(notificationsService.getUnreadCount).toHaveBeenCalledWith(principal.actorEntidadeId);
    expect(result).toEqual({ data: { count: 3 } });
  });
});
