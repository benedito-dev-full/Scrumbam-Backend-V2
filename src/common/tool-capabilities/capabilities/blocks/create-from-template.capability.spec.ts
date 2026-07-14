import { BadRequestException, NotFoundException } from '@nestjs/common';

import toolsSchema from '../../../../mcp/schemas/tools.schema.json';
import { fromMcp } from '../../tool-principal';
import { CreateFromTemplateCapability } from './create-from-template.capability';

/**
 * Onda 4 (writes so-MCP) — `CreateFromTemplateCapability`.
 *
 * Espelha `src/mcp/tools/create-from-template.tool.ts`: resolucao da org de
 * DESTINO por PRESENCA de idPai (herda via findOne / deriva via
 * resolveOrgIdsForUser). Prova paridade byte-a-byte com schema.
 */
describe('CreateFromTemplateCapability (Onda 4 — writes so-MCP ADR-V2-079)', () => {
  const templateId = '-401';
  const materialized = { id: '900', nome: 'Instancia' };

  let projectsService: {
    createFromTemplate: jest.Mock;
    resolveOrgIdsForUser: jest.Mock;
    findOne: jest.Mock;
  };
  let capability: CreateFromTemplateCapability;

  beforeEach(() => {
    projectsService = {
      createFromTemplate: jest.fn().mockResolvedValue(materialized),
      resolveOrgIdsForUser: jest.fn().mockResolvedValue([BigInt(50)]),
      findOne: jest.fn().mockResolvedValue({ id: '10', orgId: '50' }),
    };
    capability = new CreateFromTemplateCapability(projectsService as never);
  });

  it('metadados: nome canonico, scope projects:write; paridade byte-a-byte com schema', () => {
    expect(capability.name).toBe('create_from_template');
    expect(capability.requiredScopes).toEqual(['projects:write']);
    const t = toolsSchema.tools.find((x) => x.name === 'create_from_template');
    expect(capability.description).toBe(t!.description);
    expect(capability.inputSchema).toEqual(t!.inputSchema);
  });

  it('com idPai (LISTA): herda org do destino via findOne e delega', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    const result = await capability.run({ templateId, idPai: '10' }, principal);

    expect(projectsService.findOne).toHaveBeenCalledWith('10', principal.actorEntidadeId);
    expect(projectsService.createFromTemplate).toHaveBeenCalledWith(
      templateId,
      principal.actorEntidadeId,
      '50',
      { idPai: '10' },
    );
    expect(result).toEqual({ data: materialized });
  });

  it('sem idPai (ESPACO), 1 org: deriva org via membership e delega', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    await capability.run({ templateId: '-402', includeTasks: false }, principal);

    expect(projectsService.resolveOrgIdsForUser).toHaveBeenCalledWith(principal.actorEntidadeId);
    expect(projectsService.createFromTemplate).toHaveBeenCalledWith(
      '-402',
      principal.actorEntidadeId,
      '50',
      { includeTasks: false },
    );
  });

  it('sem idPai, N orgs sem orgId → INVALID_INPUT (ambiguo)', async () => {
    projectsService.resolveOrgIdsForUser.mockResolvedValue([BigInt(50), BigInt(60)]);
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    await expect(capability.run({ templateId: '-402' }, principal)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      data: { issue: 'ambiguous org' },
    });
    expect(projectsService.createFromTemplate).not.toHaveBeenCalled();
  });

  it('sem idPai, orgId de org alheia → FORBIDDEN', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    await expect(
      capability.run({ templateId: '-402', orgId: '999' }, principal),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(projectsService.createFromTemplate).not.toHaveBeenCalled();
  });

  it('templateId nao-BigInt → INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    await expect(capability.run({ templateId: 'abc' }, principal)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      data: { field: 'templateId' },
    });
  });

  it('createFromTemplate lanca BadRequest → propaga UNCHANGED', async () => {
    projectsService.createFromTemplate.mockRejectedValue(new BadRequestException('Hierarquia'));
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    await expect(capability.run({ templateId, idPai: '10' }, principal)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('destino inexistente → NotFoundException propaga (findOne)', async () => {
    projectsService.findOne.mockRejectedValue(new NotFoundException('Destino nao encontrado'));
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['projects:write'] });

    await expect(capability.run({ templateId, idPai: '10' }, principal)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
