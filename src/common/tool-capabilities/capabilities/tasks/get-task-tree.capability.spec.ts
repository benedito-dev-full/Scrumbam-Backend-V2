import { NotFoundException } from '@nestjs/common';

import { fromMcp } from '../../tool-principal';
import { CapabilityError } from '../../capability-error';
import { GetTaskTreeCapability } from './get-task-tree.capability';

/**
 * Onda 3 (reads so-MCP) — `GetTaskTreeCapability`.
 *
 * Espelha `src/mcp/tools/get-task-tree.tool.ts`: gate de tenant via
 * `findAccessibleProjectIds` + `findOne` (anti-enumeration) ANTES de
 * `PhaseTreeService.buildTree`.
 */
describe('GetTaskTreeCapability (Onda 3 — reads so-MCP)', () => {
  const taskId = '100';
  const projectId = '10';
  const tree = { root: { id: taskId }, totalNodes: 1, maxDepthReached: false };

  let phaseTreeService: { buildTree: jest.Mock };
  let tasksService: { findOne: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let capability: GetTaskTreeCapability;

  beforeEach(() => {
    phaseTreeService = { buildTree: jest.fn().mockResolvedValue(tree) };
    tasksService = { findOne: jest.fn().mockResolvedValue({ id: taskId, projectId }) };
    projectsService = { findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]) };
    capability = new GetTaskTreeCapability(
      phaseTreeService as never,
      tasksService as never,
      projectsService as never,
    );
  });

  it('metadados: nome canonico, scope tasks:read', () => {
    expect(capability.name).toBe('get_task_tree');
    expect(capability.requiredScopes).toEqual(['tasks:read']);
  });

  it('monta a arvore apos gate de tenant (findOne antes de buildTree)', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({ taskId, includeMetrics: true }, principal);

    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, [projectId]);
    expect(phaseTreeService.buildTree).toHaveBeenCalledWith(BigInt(taskId), {
      includeMetrics: true,
    });
    expect(result).toEqual({ data: tree });
  });

  it('scope vazio -> NotFoundException anti-enumeration (nao chama buildTree)', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValue([]);
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(capability.run({ taskId }, principal)).rejects.toThrow(NotFoundException);
    expect(phaseTreeService.buildTree).not.toHaveBeenCalled();
  });

  it('maxDepth fora do range -> INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(capability.run({ taskId, maxDepth: 99 }, principal)).rejects.toThrow(
      CapabilityError,
    );
  });

  it('includeMetrics nao-boolean -> INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(
      capability.run({ taskId, includeMetrics: 'yes' }, principal),
    ).rejects.toThrow(CapabilityError);
  });
});
