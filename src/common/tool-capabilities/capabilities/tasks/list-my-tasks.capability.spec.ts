import { fromMcp } from '../../tool-principal';
import { ListMyTasksCapability } from './list-my-tasks.capability';

/**
 * Onda 3 (reads so-MCP) — `ListMyTasksCapability`.
 *
 * Espelha `src/mcp/tools/list-my-tasks.tool.ts`: `assigneeId` SEMPRE do
 * `principal.actorEntidadeId` (anti-fraude), nunca do input.
 */
describe('ListMyTasksCapability (Onda 3 — reads so-MCP)', () => {
  const projectId = '10';
  const page = { items: [{ id: '1' }], pagination: { hasMore: false, nextCursor: null } };

  let tasksService: { findMany: jest.Mock };
  let projectsService: { findOne: jest.Mock; findAccessibleProjectIds: jest.Mock };
  let capability: ListMyTasksCapability;

  beforeEach(() => {
    tasksService = { findMany: jest.fn().mockResolvedValue(page) };
    projectsService = {
      findOne: jest.fn().mockResolvedValue({ id: projectId }),
      findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]),
    };
    capability = new ListMyTasksCapability(tasksService as never, projectsService as never);
  });

  it('metadados: nome canonico, scope tasks:read', () => {
    expect(capability.name).toBe('list_my_tasks');
    expect(capability.requiredScopes).toEqual(['tasks:read']);
  });

  it('assigneeId SEMPRE do principal, mesmo se input tentar informar outro', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(777), scopes: ['tasks:read'] });

    await capability.run({ assigneeId: '999999' } as never, principal);

    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: '777' }),
      [projectId],
    );
  });

  it('scope vazio -> lista vazia, nunca 404', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValue([]);
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({}, principal);

    expect(result).toEqual({ data: { items: [], pagination: { hasMore: false, nextCursor: null } } });
  });

  it('projectId informado: valida acesso via findOne', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await capability.run({ projectId }, principal);

    expect(projectsService.findOne).toHaveBeenCalledWith(projectId, principal.actorEntidadeId);
  });
});
