import { NotFoundException } from '@nestjs/common';

import { fromMcp } from '../../tool-principal';
import { CapabilityError } from '../../capability-error';
import { GetProjectCapability } from './get-project.capability';

/**
 * Onda 3 (reads so-MCP) — `GetProjectCapability`.
 *
 * Espelha `src/mcp/tools/get-project.tool.ts`: gate anti-enumeration +
 * `include[]` opt-in (`members`, `stats`) via `Promise.all`.
 */
describe('GetProjectCapability (Onda 3 — reads so-MCP)', () => {
  const projectId = '123';
  const project = { id: projectId, nome: 'Projeto X', tableFields: null };
  const members = { items: [{ id: '1', role: 'MANAGER' }] };
  const stats = { total: 10 };

  let projectsService: {
    findAccessibleProjectIds: jest.Mock;
    findOne: jest.Mock;
    getStats: jest.Mock;
  };
  let projectMembersService: { getMembers: jest.Mock };
  let capability: GetProjectCapability;

  beforeEach(() => {
    projectsService = {
      findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]),
      findOne: jest.fn().mockResolvedValue(project),
      getStats: jest.fn().mockResolvedValue(stats),
    };
    projectMembersService = { getMembers: jest.fn().mockResolvedValue(members) };
    capability = new GetProjectCapability(projectsService as never, projectMembersService as never);
  });

  it('metadados: nome canonico, scope tasks:read', () => {
    expect(capability.name).toBe('get_project');
    expect(capability.requiredScopes).toEqual(['tasks:read']);
  });

  it('sem include: retorna apenas o projeto base', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({ projectId }, principal);

    expect(result).toEqual({ data: { ...project } });
    expect(projectMembersService.getMembers).not.toHaveBeenCalled();
    expect(projectsService.getStats).not.toHaveBeenCalled();
  });

  it('com include=[members,stats]: agrega os dois em paralelo', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({ projectId, include: ['members', 'stats'] }, principal);

    expect(result).toEqual({ data: { ...project, members, stats } });
  });

  it('projeto fora do escopo -> NotFoundException anti-enumeration', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValue([]);
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(capability.run({ projectId }, principal)).rejects.toThrow(NotFoundException);
    expect(projectMembersService.getMembers).not.toHaveBeenCalled();
  });

  it('include invalido -> INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(
      capability.run({ projectId, include: ['activity'] }, principal),
    ).rejects.toThrow(CapabilityError);
  });
});
