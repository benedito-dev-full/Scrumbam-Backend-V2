import { NotFoundException } from '@nestjs/common';

import { fromMcp } from '../../tool-principal';
import { ListMembersCapability } from './list-members.capability';

/**
 * Onda 3 (reads so-MCP) — `ListMembersCapability`.
 *
 * Espelha `src/mcp/tools/list-members.tool.ts`: gate anti-enumeration via
 * `findAccessibleProjectIds` ANTES de `ProjectMembersService.getMembers`.
 */
describe('ListMembersCapability (Onda 3 — reads so-MCP)', () => {
  const projectId = '10';
  const members = { items: [{ id: '1', role: 'MANAGER' }] };

  let projectMembersService: { getMembers: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let capability: ListMembersCapability;

  beforeEach(() => {
    projectMembersService = { getMembers: jest.fn().mockResolvedValue(members) };
    projectsService = { findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]) };
    capability = new ListMembersCapability(
      projectMembersService as never,
      projectsService as never,
    );
  });

  it('metadados: nome canonico, scope tasks:read', () => {
    expect(capability.name).toBe('list_members');
    expect(capability.requiredScopes).toEqual(['tasks:read']);
  });

  it('lista membros de projeto acessivel', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({ projectId }, principal);

    expect(projectMembersService.getMembers).toHaveBeenCalledWith(projectId);
    expect(result).toEqual({ data: members });
  });

  it('projeto fora do escopo -> NotFoundException anti-enumeration', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValue([]);
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(capability.run({ projectId }, principal)).rejects.toThrow(NotFoundException);
    expect(projectMembersService.getMembers).not.toHaveBeenCalled();
  });
});
