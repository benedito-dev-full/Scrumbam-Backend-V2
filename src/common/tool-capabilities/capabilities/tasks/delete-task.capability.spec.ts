import { NotFoundException } from '@nestjs/common';

import toolsSchema from '../../../../mcp/schemas/tools.schema.json';
import { CapabilityError } from '../../capability-error';
import { fromMcp, fromNexus } from '../../tool-principal';
import { DeleteTaskCapability } from './delete-task.capability';

/**
 * Onda 4 (writes so-MCP) — `DeleteTaskCapability`.
 *
 * Espelha `src/mcp/tools/delete-task.tool.ts`: soft-delete com cascade default,
 * tenant + membership em duas etapas, `accessibleProjectIds=[task.projectId]`.
 * Prova paridade byte-a-byte de description/inputSchema com `tools.schema.json`.
 */
describe('DeleteTaskCapability (Onda 4 — writes so-MCP ADR-V2-079)', () => {
  const taskId = '402';
  const projectId = '100';

  let tasksService: { findOne: jest.Mock; delete: jest.Mock };
  let projectsService: { findOne: jest.Mock };
  let capability: DeleteTaskCapability;

  beforeEach(() => {
    tasksService = {
      findOne: jest.fn().mockResolvedValue({ id: taskId, projectId }),
      delete: jest.fn().mockResolvedValue({ affected: 3 }),
    };
    projectsService = { findOne: jest.fn().mockResolvedValue({ id: projectId }) };
    capability = new DeleteTaskCapability(tasksService as never, projectsService as never);
  });

  it('metadados: nome canonico, scope tasks:write; paridade byte-a-byte com schema', () => {
    expect(capability.name).toBe('delete_task');
    expect(capability.requiredScopes).toEqual(['tasks:write']);
    const t = toolsSchema.tools.find((x) => x.name === 'delete_task');
    expect(capability.description).toBe(t!.description);
    expect(capability.inputSchema).toEqual(t!.inputSchema);
  });

  it('(a) cascade default: tenant+membership, delega [projectId], retorna affected', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(7), scopes: ['tasks:write'] });

    const result = await capability.run({ taskId }, principal);

    expect(tasksService.findOne).toHaveBeenCalledWith(taskId);
    expect(projectsService.findOne).toHaveBeenCalledWith(projectId, principal.actorEntidadeId);
    expect(tasksService.delete).toHaveBeenCalledWith(
      taskId,
      [projectId],
      { cascade: undefined },
      principal.actorEntidadeId,
    );
    expect(result).toEqual({ data: { deleted: true, taskId, cascade: true, affected: 3 } });
  });

  it('(b) cascade=false: repassa e o cascade efetivo no envelope e false', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(7), scopes: ['tasks:write'] });

    const result = await capability.run({ taskId, cascade: false }, principal);

    expect(tasksService.delete).toHaveBeenCalledWith(
      taskId,
      [projectId],
      { cascade: false },
      principal.actorEntidadeId,
    );
    expect(result).toEqual({ data: { deleted: true, taskId, cascade: false, affected: 3 } });
  });

  it('surface nexus tambem funciona (actorEntidadeId do principal)', async () => {
    const principal = fromNexus({ actorEntidadeId: BigInt(9), grantedScopes: ['tasks:write'] });

    await capability.run({ taskId }, principal);

    expect(tasksService.delete).toHaveBeenCalledWith(
      taskId,
      [projectId],
      { cascade: undefined },
      principal.actorEntidadeId,
    );
  });

  it('(c) taskId nao-BigInt → INVALID_INPUT, service nao chamado', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:write'] });

    await expect(capability.run({ taskId: 'abc' }, principal)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      data: { field: 'taskId' },
    });
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(tasksService.delete).not.toHaveBeenCalled();
  });

  it('(d) cascade nao-boolean → INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:write'] });

    await expect(capability.run({ taskId, cascade: 'yes' }, principal)).rejects.toBeInstanceOf(
      CapabilityError,
    );
    expect(tasksService.delete).not.toHaveBeenCalled();
  });

  it('tenant: findOne lanca NotFound → propaga UNCHANGED, delete nao chamado', async () => {
    tasksService.findOne.mockRejectedValue(new NotFoundException('Task nao encontrada'));
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:write'] });

    await expect(capability.run({ taskId }, principal)).rejects.toBeInstanceOf(NotFoundException);
    expect(tasksService.delete).not.toHaveBeenCalled();
  });
});
