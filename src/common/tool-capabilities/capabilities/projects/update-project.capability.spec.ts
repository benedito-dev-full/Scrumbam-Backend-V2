import { ForbiddenException, NotFoundException } from '@nestjs/common';

import toolsSchema from '../../../../mcp/schemas/tools.schema.json';
import { CapabilityError } from '../../capability-error';
import { fromMcp } from '../../tool-principal';
import { UpdateProjectCapability } from './update-project.capability';

/**
 * Onda 4 (writes so-MCP) — `UpdateProjectCapability`.
 *
 * Espelha `src/mcp/tools/update-project.tool.ts`: DTO parcial (omite undefined),
 * semantica ternaria em repoUrl/teamId (null=limpar), exige >=1 campo, delega
 * SEM organizationId (cross-org). Prova paridade byte-a-byte com schema.
 */
describe('UpdateProjectCapability (Onda 4 — writes so-MCP ADR-V2-079)', () => {
  const projectId = '123';
  const updated = { id: projectId, nome: 'Novo' };

  let projectsService: { update: jest.Mock };
  let capability: UpdateProjectCapability;

  beforeEach(() => {
    projectsService = { update: jest.fn().mockResolvedValue(updated) };
    capability = new UpdateProjectCapability(projectsService as never);
  });

  it('metadados: nome canonico, scope projects:write; paridade byte-a-byte com schema', () => {
    expect(capability.name).toBe('update_project');
    expect(capability.requiredScopes).toEqual(['projects:write']);
    const t = toolsSchema.tools.find((x) => x.name === 'update_project');
    expect(capability.description).toBe(t!.description);
    expect(capability.inputSchema).toEqual(t!.inputSchema);
  });

  it('atualiza campos presentes; delega SEM organizationId', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(2), scopes: ['projects:write'] });

    const result = await capability.run(
      { projectId, nome: 'Novo', automationEnabled: true },
      principal,
    );

    expect(projectsService.update).toHaveBeenCalledWith(
      projectId,
      { nome: 'Novo', automationEnabled: true },
      principal.actorEntidadeId,
    );
    expect(result).toEqual({ data: updated });
  });

  it('repoUrl=null e teamId=null → limpar (null no DTO)', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(2), scopes: ['projects:write'] });

    await capability.run({ projectId, repoUrl: null, teamId: null }, principal);

    expect(projectsService.update).toHaveBeenCalledWith(
      projectId,
      { repoUrl: null, teamId: null },
      principal.actorEntidadeId,
    );
  });

  it('nenhum campo alem de projectId → INVALID_INPUT, service nao chamado', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(2), scopes: ['projects:write'] });

    await expect(capability.run({ projectId }, principal)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      data: { field: 'body' },
    });
    expect(projectsService.update).not.toHaveBeenCalled();
  });

  it('projectId nao-BigInt → INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(2), scopes: ['projects:write'] });

    await expect(
      capability.run({ projectId: 'abc', nome: 'X' }, principal),
    ).rejects.toBeInstanceOf(CapabilityError);
    expect(projectsService.update).not.toHaveBeenCalled();
  });

  it('repoUrl invalido (numero) → INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(2), scopes: ['projects:write'] });

    await expect(
      capability.run({ projectId, repoUrl: 123 }, principal),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', data: { field: 'repoUrl' } });
  });

  it('ForbiddenException (nao-MANAGER) propaga UNCHANGED', async () => {
    projectsService.update.mockRejectedValue(new ForbiddenException('Nao e MANAGER'));
    const principal = fromMcp({ actorEntidadeId: BigInt(2), scopes: ['projects:write'] });

    await expect(capability.run({ projectId, nome: 'X' }, principal)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('NotFoundException propaga UNCHANGED', async () => {
    projectsService.update.mockRejectedValue(new NotFoundException('Projeto nao encontrado'));
    const principal = fromMcp({ actorEntidadeId: BigInt(2), scopes: ['projects:write'] });

    await expect(capability.run({ projectId, nome: 'X' }, principal)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
