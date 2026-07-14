import { fromMcp, fromNexus } from '../../tool-principal';
import { CapabilityError } from '../../capability-error';
import { GetTaskCapability } from './get-task.capability';

/**
 * Onda 3 (reads so-MCP) — `GetTaskCapability`.
 *
 * Espelha o comportamento do wrapper legado MCP
 * (`src/mcp/tools/get-task.tool.ts`): mesma delegacao a
 * `TasksService.findOne(taskId, accessibleProjectIds)`.
 */
describe('GetTaskCapability (Onda 3 — reads so-MCP)', () => {
  const taskId = '9007199254740993';
  const projectId = '9007199254740995';
  const found = { id: taskId, projectId, nome: 'Task de teste', status: 'INBOX' };

  let tasksService: { findOne: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let capability: GetTaskCapability;

  beforeEach(() => {
    tasksService = { findOne: jest.fn().mockResolvedValue(found) };
    projectsService = { findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]) };
    capability = new GetTaskCapability(tasksService as never, projectsService as never);
  });

  it('metadados: nome canonico, scope tasks:read', () => {
    expect(capability.name).toBe('get_task');
    expect(capability.requiredScopes).toEqual(['tasks:read']);
    expect(capability.inputSchema).toMatchObject({ type: 'object', required: ['taskId'] });
  });

  it('busca a task escopada aos projetos acessiveis (surface mcp)', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt('9007199254740997'), scopes: ['tasks:read'] });

    const result = await capability.run({ taskId }, principal);

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(principal.actorEntidadeId);
    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, [projectId]);
    expect(result).toEqual({ data: found });
  });

  it('funciona identico sob principal Nexus', async () => {
    const principal = fromNexus({
      actorEntidadeId: BigInt('9007199254740997'),
      grantedScopes: ['tasks:read'],
    });

    const result = await capability.run({ taskId }, principal);

    expect(result).toEqual({ data: found });
  });

  it('taskId ausente -> INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(capability.run({}, principal)).rejects.toThrow(CapabilityError);
    expect(tasksService.findOne).not.toHaveBeenCalled();
  });

  it('taskId nao bigint-parseavel -> INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(capability.run({ taskId: 'abc' }, principal)).rejects.toThrow(CapabilityError);
  });
});
