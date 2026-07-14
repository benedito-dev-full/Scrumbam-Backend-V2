import { NotFoundException } from '@nestjs/common';

import { fromMcp, fromNexus } from '../../tool-principal';
import { CapabilityError } from '../../capability-error';
import { CreateTaskCapability } from './create-task.capability';

/**
 * Onda 1 (piloto) — `CreateTaskCapability`.
 *
 * Espelha `mcp-tools.create-task.spec.ts` (comportamento legado do wrapper
 * MCP) para provar paridade 1:1: mesmos campos, mesmas validacoes, mesmo
 * DTO repassado ao `TasksService.create`. Cobre tambem o `principal` Nexus
 * (surface='nexus' => `source:'nexus'` no DTO).
 */
describe('CreateTaskCapability (Onda 1 — piloto ADR-V2-079)', () => {
  const projectId = '9007199254740995';
  const created = { id: '123', projectId, nome: 'Nova task' };

  let tasksService: { create: jest.Mock };
  let projectsService: { findOne: jest.Mock };
  let capability: CreateTaskCapability;

  beforeEach(() => {
    tasksService = { create: jest.fn().mockResolvedValue(created) };
    projectsService = { findOne: jest.fn().mockResolvedValue({ id: projectId }) };
    capability = new CreateTaskCapability(tasksService as never, projectsService as never);
  });

  it('metadados: nome canonico, scope tasks:write', () => {
    expect(capability.name).toBe('create_task');
    expect(capability.requiredScopes).toEqual(['tasks:write']);
    expect(capability.inputSchema).toMatchObject({
      type: 'object',
      required: ['projectId', 'titulo'],
    });
  });

  it('(a) cria com todos os campos opcionais → DTO completo com dados.idBloco/fields e source=mcp', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt('9007199254740997'), scopes: ['tasks:write'] });

    const result = await capability.run(
      {
        projectId,
        titulo: 'Nova task',
        descricao: 'desc',
        assigneeId: '100',
        priority: 'HIGH',
        dueDate: '2026-06-30',
        idPai: '5',
        assigneeTeamId: '42',
        idBloco: '77',
        fields: { f_a1: 'x' },
      },
      principal,
    );

    expect(projectsService.findOne).toHaveBeenCalledWith(projectId, principal.actorEntidadeId);
    expect(tasksService.create).toHaveBeenCalledWith(
      {
        projectId,
        nome: 'Nova task',
        descricao: 'desc',
        assigneeId: '100',
        priority: 'HIGH',
        dueDate: '2026-06-30',
        idPai: '5',
        assigneeTeamId: '42',
        dados: { idBloco: '77', fields: { f_a1: 'x' } },
        source: 'mcp',
      },
      principal.actorEntidadeId,
    );
    expect(result).toEqual({ data: created });
  });

  it('(b) back-compat: so projectId+titulo → DTO minimo', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:write'] });

    await capability.run({ projectId, titulo: 'Minima' }, principal);

    expect(tasksService.create).toHaveBeenCalledWith(
      { projectId, nome: 'Minima', source: 'mcp' },
      principal.actorEntidadeId,
    );
  });

  it('surface nexus => source="nexus" no DTO repassado ao service', async () => {
    const principal = fromNexus({ actorEntidadeId: BigInt(5), grantedScopes: ['tasks:write'] });

    await capability.run({ projectId, titulo: 'Via chat' }, principal);

    expect(tasksService.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'nexus' }),
      principal.actorEntidadeId,
    );
  });

  it('(c) priority invalido → CapabilityError INVALID_INPUT, service nao chamado', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:write'] });

    await expect(
      capability.run({ projectId, titulo: 'X', priority: 'NUCLEAR' }, principal),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(tasksService.create).not.toHaveBeenCalled();
    expect(projectsService.findOne).not.toHaveBeenCalled();
  });

  it('(d) dueDate mal-formado → CapabilityError INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:write'] });

    await expect(
      capability.run({ projectId, titulo: 'X', dueDate: 'amanha' }, principal),
    ).rejects.toBeInstanceOf(CapabilityError);
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('(e) idPai nao-BigInt → CapabilityError INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:write'] });

    await expect(
      capability.run({ projectId, titulo: 'X', idPai: 'abc' }, principal),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', data: { field: 'idPai' } });
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('tenant: projectsService.findOne lanca NotFound → propaga, create nao chamado', async () => {
    projectsService.findOne.mockRejectedValue(new NotFoundException('Projeto nao encontrado'));
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:write'] });

    await expect(capability.run({ projectId, titulo: 'X' }, principal)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tasksService.create).not.toHaveBeenCalled();
  });
});
