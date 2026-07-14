import { NotFoundException } from '@nestjs/common';

import toolsSchema from '../../../../mcp/schemas/tools.schema.json';
import { fromMcp } from '../../tool-principal';
import { CreateProjectCapability } from './create-project.capability';

/**
 * Onda 4 (writes so-MCP) — `CreateProjectCapability`.
 *
 * Espelha `src/mcp/tools/create-project.tool.ts`: resolucao de org por tipo
 * (SPACE deriva via `resolveOrgIdsForUser`; FOLDER/LIST herdam via `findOne`),
 * whitelist de idClasse, validacoes de shape. Prova paridade byte-a-byte de
 * description/inputSchema com `tools.schema.json`.
 */
describe('CreateProjectCapability (Onda 4 — writes so-MCP ADR-V2-079)', () => {
  const created = { id: '900', nome: 'Meu Space', idClasse: '-350' };

  let projectsService: {
    create: jest.Mock;
    resolveOrgIdsForUser: jest.Mock;
    findOne: jest.Mock;
  };
  let capability: CreateProjectCapability;

  beforeEach(() => {
    projectsService = {
      create: jest.fn().mockResolvedValue(created),
      resolveOrgIdsForUser: jest.fn().mockResolvedValue([BigInt(50)]),
      findOne: jest.fn().mockResolvedValue({ id: '10', orgId: '50' }),
    };
    capability = new CreateProjectCapability(projectsService as never);
  });

  it('metadados: nome canonico, scope projects:write; paridade byte-a-byte com schema', () => {
    expect(capability.name).toBe('create_project');
    expect(capability.requiredScopes).toEqual(['projects:write']);
    const t = toolsSchema.tools.find((x) => x.name === 'create_project');
    expect(capability.description).toBe(t!.description);
    expect(capability.inputSchema).toEqual(t!.inputSchema);
  });

  it('SPACE com 1 org: resolve org automaticamente e delega', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    const result = await capability.run({ nome: 'Meu Space', idClasse: '-350' }, principal);

    expect(projectsService.resolveOrgIdsForUser).toHaveBeenCalledWith(principal.actorEntidadeId);
    expect(projectsService.create).toHaveBeenCalledWith(
      { nome: 'Meu Space', idClasse: '-350', orgId: '50' },
      principal.actorEntidadeId,
    );
    expect(result).toEqual({ data: created });
  });

  it('SPACE com N orgs sem orgId → INVALID_INPUT (ambiguo)', async () => {
    projectsService.resolveOrgIdsForUser.mockResolvedValue([BigInt(50), BigInt(60)]);
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    await expect(
      capability.run({ nome: 'Meu Space', idClasse: '-350' }, principal),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', data: { issue: 'ambiguous org' } });
    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('SPACE com orgId de org alheia → FORBIDDEN', async () => {
    projectsService.resolveOrgIdsForUser.mockResolvedValue([BigInt(50)]);
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    await expect(
      capability.run({ nome: 'Meu Space', idClasse: '-350', orgId: '999' }, principal),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('SPACE com idPai → INVALID_INPUT (SPACE e raiz)', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    await expect(
      capability.run({ nome: 'Meu Space', idClasse: '-350', idPai: '10' }, principal),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', data: { field: 'idPai' } });
  });

  it('LIST herda org do pai via findOne e delega', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    await capability.run({ nome: 'Minha Lista', idClasse: '-352', idPai: '10' }, principal);

    expect(projectsService.findOne).toHaveBeenCalledWith('10', principal.actorEntidadeId);
    expect(projectsService.create).toHaveBeenCalledWith(
      { nome: 'Minha Lista', idClasse: '-352', orgId: '50', idPai: '10' },
      principal.actorEntidadeId,
    );
  });

  it('FOLDER/LIST sem idPai → INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    await expect(
      capability.run({ nome: 'Sem pai', idClasse: '-351' }, principal),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', data: { issue: 'required for FOLDER/LIST' } });
  });

  it('idClasse fora da whitelist → INVALID_INPUT, service nao chamado', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    await expect(
      capability.run({ nome: 'X', idClasse: '-999' }, principal),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', data: { field: 'idClasse' } });
    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('color hex invalido → INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    await expect(
      capability.run({ nome: 'Space valido', idClasse: '-350', color: 'red' }, principal),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', data: { field: 'color' } });
  });

  it('parent sem org → NotFoundException propaga (findOne)', async () => {
    projectsService.findOne.mockRejectedValue(new NotFoundException('Pai nao encontrado'));
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    await expect(
      capability.run({ nome: 'Lista', idClasse: '-352', idPai: '10' }, principal),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(projectsService.create).not.toHaveBeenCalled();
  });
});
