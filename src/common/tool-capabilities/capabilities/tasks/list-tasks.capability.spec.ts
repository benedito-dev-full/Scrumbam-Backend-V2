import { fromMcp } from '../../tool-principal';
import { CapabilityError } from '../../capability-error';
import { ListTasksCapability } from './list-tasks.capability';

/**
 * Onda 3 (reads so-MCP) — `ListTasksCapability`.
 *
 * Espelha `src/mcp/tools/list-tasks.tool.ts`: resolve scope de projetos
 * (explicito ou `findAccessibleProjectIds`) e delega a `TasksService.findMany`.
 */
describe('ListTasksCapability (Onda 3 — reads so-MCP)', () => {
  const projectId = '10';
  const page = { items: [{ id: '1' }], pagination: { hasMore: false, nextCursor: null } };

  let tasksService: { findMany: jest.Mock };
  let projectsService: { findOne: jest.Mock; findAccessibleProjectIds: jest.Mock };
  let capability: ListTasksCapability;

  beforeEach(() => {
    tasksService = { findMany: jest.fn().mockResolvedValue(page) };
    projectsService = {
      findOne: jest.fn().mockResolvedValue({ id: projectId }),
      findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]),
    };
    capability = new ListTasksCapability(tasksService as never, projectsService as never);
  });

  it('metadados: nome canonico, scope tasks:read', () => {
    expect(capability.name).toBe('list_tasks');
    expect(capability.requiredScopes).toEqual(['tasks:read']);
  });

  it('com projectId explicito: valida acesso e escopa a esse projeto', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({ projectId, idClasse: '-200' }, principal);

    expect(projectsService.findOne).toHaveBeenCalledWith(projectId, principal.actorEntidadeId);
    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, idClasse: '-200', limit: 20 }),
      [projectId],
    );
    expect(result).toEqual({ data: page });
  });

  it('sem projectId: usa todos os projetos acessiveis', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await capability.run({}, principal);

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(principal.actorEntidadeId);
    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ projectIds: [projectId] }),
      [projectId],
    );
  });

  it('scope vazio -> lista vazia (nao chama findMany)', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValue([]);
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({}, principal);

    expect(result).toEqual({ data: { items: [], pagination: { hasMore: false, nextCursor: null } } });
    expect(tasksService.findMany).not.toHaveBeenCalled();
  });

  it('idPai="null" e propagado (nao truthy check)', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await capability.run({ idPai: 'null' }, principal);

    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ idPai: 'null' }),
      expect.anything(),
    );
  });

  it('status invalido -> INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(capability.run({ status: 'NOPE' }, principal)).rejects.toThrow(CapabilityError);
  });

  it('idClasse fora do regex -> INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(capability.run({ idClasse: 'abc' }, principal)).rejects.toThrow(CapabilityError);
  });
});
