import { fromMcp } from '../../tool-principal';
import { CapabilityError } from '../../capability-error';
import { SearchTasksCapability } from './search-tasks.capability';

/**
 * Onda 3 (reads so-MCP) — `SearchTasksCapability`.
 *
 * Espelha `src/mcp/tools/search-tasks.tool.ts`: gate de tenant via
 * `findAccessibleProjectIds` + validacao de `projectId` (anti-enumeration).
 */
describe('SearchTasksCapability (Onda 3 — reads so-MCP)', () => {
  const projectId = '10';
  const results = { tasks: [{ id: '1' }], total: 1, q: 'bug' };

  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let searchService: { searchForMcp: jest.Mock };
  let capability: SearchTasksCapability;

  beforeEach(() => {
    projectsService = { findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]) };
    searchService = { searchForMcp: jest.fn().mockResolvedValue(results) };
    capability = new SearchTasksCapability(projectsService as never, searchService as never);
  });

  it('metadados: nome canonico, scope tasks:read', () => {
    expect(capability.name).toBe('search_tasks');
    expect(capability.requiredScopes).toEqual(['tasks:read']);
  });

  it('busca com q valido, escopado aos projetos acessiveis', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({ q: 'bug' }, principal);

    expect(searchService.searchForMcp).toHaveBeenCalledWith('bug', principal.actorEntidadeId, [
      projectId,
    ], { projectId: undefined, limit: 20 });
    expect(result).toEqual({ data: results });
  });

  it('scope vazio -> resultado vazio sem chamar searchService', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValue([]);
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({ q: 'bug' }, principal);

    expect(result).toEqual({ data: { tasks: [], total: 0, q: 'bug' } });
    expect(searchService.searchForMcp).not.toHaveBeenCalled();
  });

  it('projectId fora do escopo -> INVALID_INPUT (anti-enumeration)', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(
      capability.run({ q: 'bug', projectId: 'other' }, principal),
    ).rejects.toThrow(CapabilityError);
  });

  it('q ausente ou curto -> INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(capability.run({}, principal)).rejects.toThrow(CapabilityError);
    await expect(capability.run({ q: 'a' }, principal)).rejects.toThrow(CapabilityError);
  });
});
