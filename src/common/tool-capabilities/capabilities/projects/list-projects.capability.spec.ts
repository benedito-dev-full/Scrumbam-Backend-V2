import { fromMcp } from '../../tool-principal';
import { ListProjectsCapability } from './list-projects.capability';

/**
 * Onda 3 (reads so-MCP) — `ListProjectsCapability`.
 *
 * Espelha `src/mcp/tools/list-projects.tool.ts`: delega a
 * `ProjectsService.findMany(userEntidadeId, { cursor?, limit })`.
 */
describe('ListProjectsCapability (Onda 3 — reads so-MCP)', () => {
  const page = { items: [{ id: '1' }], pagination: { hasMore: false, nextCursor: null } };

  let projectsService: { findMany: jest.Mock };
  let capability: ListProjectsCapability;

  beforeEach(() => {
    projectsService = { findMany: jest.fn().mockResolvedValue(page) };
    capability = new ListProjectsCapability(projectsService as never);
  });

  it('metadados: nome canonico, scope tasks:read', () => {
    expect(capability.name).toBe('list_projects');
    expect(capability.requiredScopes).toEqual(['tasks:read']);
  });

  it('lista projetos escopados ao ator, com limit default 20', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({}, principal);

    expect(projectsService.findMany).toHaveBeenCalledWith(principal.actorEntidadeId, { limit: 20 });
    expect(result).toEqual({ data: page });
  });

  it('repassa cursor quando informado', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await capability.run({ cursor: '456' }, principal);

    expect(projectsService.findMany).toHaveBeenCalledWith(
      principal.actorEntidadeId,
      expect.objectContaining({ cursor: '456' }),
    );
  });
});
