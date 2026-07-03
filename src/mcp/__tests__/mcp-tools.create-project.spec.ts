import { NotFoundException } from '@nestjs/common';

import { MCP_ERROR_CODES } from '../constants';
import { McpRouterService } from '../services/mcp-router.service';
import { CreateProjectTool } from '../tools/create-project.tool';

/**
 * Specs para a tool MCP `create_project` (Task #2 — wrapper fino sobre
 * `ProjectsService.create` com resolução de org + RBAC por tipo).
 *
 * Cobre:
 * (a) SPACE 1 org (auto): create com { nome, idClasse:-350, orgId } + só
 *     resolveOrgIdsForUser (findOne NÃO chamado).
 * (b) SPACE com orgId explícito ∈ orgs → usa esse orgId.
 * (c) SPACE N orgs sem orgId → INVALID_PARAMS (org ambígua).
 * (d) SPACE orgId de org alheia → FORBIDDEN.
 * (e) SPACE 0 orgs → INVALID_PARAMS.
 * (f) SPACE com idPai → INVALID_PARAMS (SPACE é raiz).
 * (g) LIST via idPai: findOne ANTES de create; orgId herdado de parent.orgId.
 * (h) LIST orgId divergente no input → ignorado (usa parent.orgId).
 * (i) FOLDER sem idPai → INVALID_PARAMS.
 * (j) LIST findOne lança NotFound → propaga, create não chamado.
 * (k) LIST pai sem org → INVALID_PARAMS.
 * (l) scope ausente → FORBIDDEN, nenhum service chamado.
 * (m) nome faltando → INVALID_PARAMS.
 * (n) idClasse faltando → INVALID_PARAMS.
 * (o) idClasse fora do whitelist (-353) → INVALID_PARAMS.
 * (p) nome < 3 → INVALID_PARAMS.
 * (q) color malformado → INVALID_PARAMS.
 * (r) idPai não-BigInt → INVALID_PARAMS.
 * (s) expõe create_project em tools/list (guarda anti-footgun de registro).
 */
describe('MCP create_project tool', () => {
  const orgId = '100';
  const otherOrgId = '999';
  const parentId = '9007199254740995';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['projects:write'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  const created = { id: '500', nome: 'Projeto A', idClasse: '-350', orgId };

  let projectsService: {
    create: jest.Mock;
    findOne: jest.Mock;
    resolveOrgIdsForUser: jest.Mock;
  };
  let router: McpRouterService;

  /**
   * `create_project` é o ÚLTIMO tool no ctor posicional do router (índice 22,
   * após create_block). Preenche 22 posições com undefined e injeta o tool na
   * posição correta; configService (índice 23) fica undefined.
   */
  function buildRouter(tool: CreateProjectTool): McpRouterService {
    const args: unknown[] = new Array(22).fill(undefined);
    args.push(tool);
    return new McpRouterService(...(args as never[]));
  }

  beforeEach(() => {
    projectsService = {
      create: jest.fn().mockResolvedValue(created),
      findOne: jest.fn().mockResolvedValue({ id: parentId, orgId }),
      resolveOrgIdsForUser: jest.fn().mockResolvedValue([BigInt(orgId)]),
    };

    router = buildRouter(new CreateProjectTool(projectsService as never));
  });

  it('(a) SPACE 1 org (auto): create com orgId resolvido, findOne nao chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_project', arguments: { nome: 'Projeto A', idClasse: '-350' } },
      userCtx,
    );

    expect(projectsService.resolveOrgIdsForUser).toHaveBeenCalledWith(userCtx.dEntidadeId);
    expect(projectsService.findOne).not.toHaveBeenCalled();
    expect(projectsService.create).toHaveBeenCalledWith(
      { nome: 'Projeto A', idClasse: '-350', orgId },
      userCtx.dEntidadeId,
    );
    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(created) }],
    });
  });

  it('(b) SPACE orgId explicito membro → usa esse orgId', async () => {
    projectsService.resolveOrgIdsForUser.mockResolvedValueOnce([BigInt(orgId), BigInt(otherOrgId)]);

    await router.dispatch(
      'tools/call',
      { name: 'create_project', arguments: { nome: 'Projeto A', idClasse: '-350', orgId } },
      userCtx,
    );

    expect(projectsService.create).toHaveBeenCalledWith(
      { nome: 'Projeto A', idClasse: '-350', orgId },
      userCtx.dEntidadeId,
    );
  });

  it('(c) SPACE N orgs sem orgId → INVALID_PARAMS (ambiguo)', async () => {
    projectsService.resolveOrgIdsForUser.mockResolvedValueOnce([BigInt(orgId), BigInt(otherOrgId)]);

    const response = await router.dispatch(
      'tools/call',
      { name: 'create_project', arguments: { nome: 'Projeto A', idClasse: '-350' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'orgId', issue: 'ambiguous org' },
      }),
    );
    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('(d) SPACE orgId de org alheia → FORBIDDEN', async () => {
    projectsService.resolveOrgIdsForUser.mockResolvedValueOnce([BigInt(orgId)]);

    const response = await router.dispatch(
      'tools/call',
      {
        name: 'create_project',
        arguments: { nome: 'Projeto A', idClasse: '-350', orgId: otherOrgId },
      },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.FORBIDDEN,
        data: { field: 'orgId', issue: 'not a member' },
      }),
    );
    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('(e) SPACE 0 orgs → INVALID_PARAMS', async () => {
    projectsService.resolveOrgIdsForUser.mockResolvedValueOnce([]);

    const response = await router.dispatch(
      'tools/call',
      { name: 'create_project', arguments: { nome: 'Projeto A', idClasse: '-350' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'orgId', issue: 'no org membership' },
      }),
    );
    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('(f) SPACE com idPai → INVALID_PARAMS (raiz)', async () => {
    const response = await router.dispatch(
      'tools/call',
      {
        name: 'create_project',
        arguments: { nome: 'Projeto A', idClasse: '-350', idPai: parentId },
      },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'idPai', issue: 'not allowed for SPACE' },
      }),
    );
    expect(projectsService.create).not.toHaveBeenCalled();
    expect(projectsService.resolveOrgIdsForUser).not.toHaveBeenCalled();
  });

  it('(g) LIST via idPai: findOne ANTES de create, orgId herdado do pai', async () => {
    projectsService.findOne.mockResolvedValueOnce({ id: parentId, orgId });

    await router.dispatch(
      'tools/call',
      {
        name: 'create_project',
        arguments: { nome: 'Lista A', idClasse: '-352', idPai: parentId },
      },
      userCtx,
    );

    expect(projectsService.findOne).toHaveBeenCalledWith(parentId, userCtx.dEntidadeId);
    expect(projectsService.resolveOrgIdsForUser).not.toHaveBeenCalled();
    expect(projectsService.create).toHaveBeenCalledWith(
      { nome: 'Lista A', idClasse: '-352', orgId, idPai: parentId },
      userCtx.dEntidadeId,
    );
  });

  it('(h) LIST orgId divergente no input → ignorado (usa parent.orgId)', async () => {
    projectsService.findOne.mockResolvedValueOnce({ id: parentId, orgId });

    await router.dispatch(
      'tools/call',
      {
        name: 'create_project',
        arguments: {
          nome: 'Lista A',
          idClasse: '-352',
          idPai: parentId,
          orgId: otherOrgId,
        },
      },
      userCtx,
    );

    expect(projectsService.create).toHaveBeenCalledWith(
      { nome: 'Lista A', idClasse: '-352', orgId, idPai: parentId },
      userCtx.dEntidadeId,
    );
  });

  it('(i) FOLDER sem idPai → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_project', arguments: { nome: 'Pasta A', idClasse: '-351' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'idPai', issue: 'required for FOLDER/LIST' },
      }),
    );
    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('(j) LIST findOne lanca NotFound → propaga, create nao chamado', async () => {
    projectsService.findOne.mockRejectedValueOnce(
      new NotFoundException(`Projeto ${parentId} não encontrado`),
    );

    await expect(
      router.dispatch(
        'tools/call',
        {
          name: 'create_project',
          arguments: { nome: 'Lista A', idClasse: '-352', idPai: parentId },
        },
        userCtx,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('(k) LIST pai sem org → INVALID_PARAMS', async () => {
    projectsService.findOne.mockResolvedValueOnce({ id: parentId, orgId: null });

    const response = await router.dispatch(
      'tools/call',
      {
        name: 'create_project',
        arguments: { nome: 'Lista A', idClasse: '-352', idPai: parentId },
      },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'idPai', issue: 'parent without org' },
      }),
    );
    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('(l) scope ausente → FORBIDDEN, nenhum service chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_project', arguments: { nome: 'Projeto A', idClasse: '-350' } },
      { ...userCtx, scopes: [] },
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.FORBIDDEN,
        data: { requiredScope: 'projects:write' },
      }),
    );
    expect(projectsService.resolveOrgIdsForUser).not.toHaveBeenCalled();
    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('(m) nome faltando → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_project', arguments: { idClasse: '-350' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'nome', issue: 'required string' },
      }),
    );
    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('(n) idClasse faltando → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_project', arguments: { nome: 'Projeto A' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'idClasse', issue: 'required string' },
      }),
    );
    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('(o) idClasse fora do whitelist (-353) → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_project', arguments: { nome: 'Projeto A', idClasse: '-353' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'idClasse', issue: 'unsupported class' },
      }),
    );
    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('(p) nome < 3 → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_project', arguments: { nome: 'ab', idClasse: '-350' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'nome', issue: 'min length 3 required' },
      }),
    );
    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('(q) color malformado → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      {
        name: 'create_project',
        arguments: { nome: 'Projeto A', idClasse: '-350', color: 'blue' },
      },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'color', issue: 'hex #RRGGBB expected' },
      }),
    );
    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('(r) idPai nao-BigInt → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      {
        name: 'create_project',
        arguments: { nome: 'Lista A', idClasse: '-352', idPai: 'xyz' },
      },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'idPai', issue: 'valid bigint string expected' },
      }),
    );
    expect(projectsService.create).not.toHaveBeenCalled();
  });

  it('(s) expoe create_project em tools/list', async () => {
    const result = await router.dispatch('tools/list', undefined, userCtx);

    expect(result.result).toEqual({
      tools: expect.arrayContaining([expect.objectContaining({ name: 'create_project' })]),
    });
  });
});
