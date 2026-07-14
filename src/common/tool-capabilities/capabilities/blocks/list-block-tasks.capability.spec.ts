import { NotFoundException } from '@nestjs/common';

import { fromMcp } from '../../tool-principal';
import { ListBlockTasksCapability } from './list-block-tasks.capability';

/**
 * Onda 3 (reads so-MCP) — `ListBlockTasksCapability`.
 *
 * Espelha `src/mcp/tools/list-block-tasks.tool.ts`: `findOne(blockId, ...)`
 * (gate anti-enumeration) + `findMany({ idBloco })` + metricas opcionais
 * calculadas em memoria.
 */
describe('ListBlockTasksCapability (Onda 3 — reads so-MCP)', () => {
  const blockId = '200';
  const projectId = '10';
  const items = [
    { id: '1', status: 'DONE' },
    { id: '2', status: 'EXECUTING' },
    { id: '3', status: 'FAILED' },
  ];
  const page = { items, pagination: { hasMore: false, nextCursor: null } };

  let tasksService: { findOne: jest.Mock; findMany: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let capability: ListBlockTasksCapability;

  beforeEach(() => {
    tasksService = {
      findOne: jest.fn().mockResolvedValue({ id: blockId, projectId }),
      findMany: jest.fn().mockResolvedValue(page),
    };
    projectsService = { findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]) };
    capability = new ListBlockTasksCapability(tasksService as never, projectsService as never);
  });

  it('metadados: nome canonico, scope tasks:read', () => {
    expect(capability.name).toBe('list_block_tasks');
    expect(capability.requiredScopes).toEqual(['tasks:read']);
  });

  it('lista as tasks do bloco (gate findOne antes de findMany)', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({ blockId }, principal);

    expect(tasksService.findOne).toHaveBeenCalledWith(blockId, [projectId]);
    expect(tasksService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, idBloco: blockId }),
      [projectId],
    );
    expect(result).toEqual({ data: { blockId, items, pagination: page.pagination } });
  });

  it('includeMetrics=true: calcula metricas em memoria sobre a pagina', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({ blockId, includeMetrics: true }, principal);

    expect(result).toEqual({
      data: {
        blockId,
        items,
        pagination: page.pagination,
        metrics: { total: 3, done: 1, failed: 1, inProgress: 1, percent: 33 },
      },
    });
  });

  it('scope vazio -> NotFoundException anti-enumeration', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValue([]);
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(capability.run({ blockId }, principal)).rejects.toThrow(NotFoundException);
    expect(tasksService.findMany).not.toHaveBeenCalled();
  });
});
