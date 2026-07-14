import { fromMcp } from '../../tool-principal';
import { ListBlocksCapability } from './list-blocks.capability';

/**
 * Onda 3 (reads so-MCP) — `ListBlocksCapability`.
 *
 * Espelha `src/mcp/tools/list-blocks.tool.ts`: `TasksService.findMany` com
 * `idClasse='-200'` fixo; `projectId` fora do escopo -> lista vazia
 * (anti-enumeration), NUNCA 404.
 */
describe('ListBlocksCapability (Onda 3 — reads so-MCP)', () => {
  const projectId = '10';
  const page = { items: [{ id: '1', idClasse: '-200' }], pagination: { hasMore: false, nextCursor: null } };

  let tasksService: { findMany: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let capability: ListBlocksCapability;

  beforeEach(() => {
    tasksService = { findMany: jest.fn().mockResolvedValue(page) };
    projectsService = { findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]) };
    capability = new ListBlocksCapability(tasksService as never, projectsService as never);
  });

  it('metadados: nome canonico, scope tasks:read', () => {
    expect(capability.name).toBe('list_blocks');
    expect(capability.requiredScopes).toEqual(['tasks:read']);
  });

  it('lista blocos (idClasse=-200) do projeto acessivel', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({ projectId }, principal);

    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, idClasse: '-200' }),
      [projectId],
    );
    expect(result).toEqual({ data: page });
  });

  it('projectId fora do escopo -> lista vazia (anti-enumeration, nao 404)', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValue(['other']);
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({ projectId }, principal);

    expect(result).toEqual({ data: { items: [], pagination: { hasMore: false, nextCursor: null } } });
    expect(tasksService.findMany).not.toHaveBeenCalled();
  });
});
