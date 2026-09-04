import { NotFoundException } from '@nestjs/common';

import { MCP_ERROR_CODES } from '../constants';
import { McpRouterService } from '../services/mcp-router.service';
import { CreateFromTemplateTool } from '../tools/create-from-template.tool';

/**
 * Specs para a tool MCP `create_from_template` (Task #3 — wrapper fino sobre
 * `ProjectsService.createFromTemplate` que resolve a org de DESTINO sem org de
 * token e delega 100% ao service).
 *
 * Cobre:
 * (a) template de LISTA via idPai → findOne ANTES de createFromTemplate; org
 *     herdada de parent.orgId; idPai repassado no dto.
 * (b) template de ESPACO sem idPai, 1 org → org auto; resolveOrgIdsForUser;
 *     findOne NAO chamado; dto sem idPai.
 * (c) template inexistente / de outra org → NotFoundException propaga.
 * (d) scope ausente → FORBIDDEN, nenhum service chamado.
 * (e) org ambigua (idPai ausente, N orgs, sem orgId) → INVALID_PARAMS.
 * (f) orgId de org alheia (idPai ausente) → FORBIDDEN.
 * (g) includeTasks ausente → dto SEM includeTasks (service aplica default true).
 * (h) includeTasks:false explicito → passthrough.
 * (i) destino sem org (findOne.orgId null) → INVALID_PARAMS.
 * (j) 0 orgs (idPai ausente) → INVALID_PARAMS.
 * (k) orgId divergente com idPai presente → ignorado (usa parent.orgId).
 * (l) novoNome/novoIcone + orgId explicito membro → passthrough completo.
 * (m) templateId faltando → INVALID_PARAMS.
 * (n) templateId nao-BigInt → INVALID_PARAMS.
 * (o) expoe create_from_template em tools/list (guarda de registro).
 */
describe('MCP create_from_template tool', () => {
  const orgId = '100';
  const otherOrgId = '999';
  const templateId = '-401';
  const idPai = '9007199254740995';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['projects:write'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  const materialized = { id: '700', nome: 'Onboarding X', idClasse: '-352', orgId };

  let projectsService: {
    createFromTemplate: jest.Mock;
    findOne: jest.Mock;
    resolveOrgIdsForUser: jest.Mock;
  };
  let router: McpRouterService;

  /**
   * `create_from_template` é o ÚLTIMO tool no ctor posicional do router (índice
   * 23, após create_project). Preenche 23 posições com undefined e injeta o tool
   * na posição correta; configService (índice 24) fica undefined.
   */
  function buildRouter(tool: CreateFromTemplateTool): McpRouterService {
    const args: unknown[] = new Array(23).fill(undefined);
    args.push(tool);
    return new McpRouterService(...(args as never[]));
  }

  beforeEach(() => {
    projectsService = {
      createFromTemplate: jest.fn().mockResolvedValue(materialized),
      findOne: jest.fn().mockResolvedValue({ id: idPai, orgId }),
      resolveOrgIdsForUser: jest.fn().mockResolvedValue([BigInt(orgId)]),
    };

    router = buildRouter(new CreateFromTemplateTool(projectsService as never));
  });

  it('(a) template de LISTA via idPai: findOne ANTES, org herdada do destino', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_from_template', arguments: { templateId, idPai } },
      userCtx,
    );

    expect(projectsService.findOne).toHaveBeenCalledWith(idPai, userCtx.dEntidadeId);
    expect(projectsService.resolveOrgIdsForUser).not.toHaveBeenCalled();
    expect(projectsService.createFromTemplate).toHaveBeenCalledWith(
      templateId,
      userCtx.dEntidadeId,
      orgId,
      { idPai },
    );
    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(materialized) }],
    });
  });

  it('(b) template de ESPACO sem idPai, 1 org: org auto, findOne nao chamado', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'create_from_template', arguments: { templateId: '-402' } },
      userCtx,
    );

    expect(projectsService.resolveOrgIdsForUser).toHaveBeenCalledWith(userCtx.dEntidadeId);
    expect(projectsService.findOne).not.toHaveBeenCalled();
    expect(projectsService.createFromTemplate).toHaveBeenCalledWith(
      '-402',
      userCtx.dEntidadeId,
      orgId,
      {},
    );
  });

  it('(c) template inexistente / de outra org → NotFoundException propaga', async () => {
    projectsService.createFromTemplate.mockRejectedValueOnce(
      new NotFoundException(`Template ${templateId} não encontrado`),
    );

    const response = await router.dispatch(
        'tools/call',
        { name: 'create_from_template', arguments: { templateId: '-402' } },
        userCtx,
      );
    expect(response.error).toEqual(
      expect.objectContaining({ code: MCP_ERROR_CODES.NOT_FOUND }),
    );
  });

  it('(d) scope ausente → FORBIDDEN, nenhum service chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_from_template', arguments: { templateId, idPai } },
      { ...userCtx, scopes: [] },
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.FORBIDDEN,
        data: { requiredScope: 'projects:write' },
      }),
    );
    expect(projectsService.findOne).not.toHaveBeenCalled();
    expect(projectsService.resolveOrgIdsForUser).not.toHaveBeenCalled();
    expect(projectsService.createFromTemplate).not.toHaveBeenCalled();
  });

  it('(e) org ambigua (idPai ausente, N orgs, sem orgId) → INVALID_PARAMS', async () => {
    projectsService.resolveOrgIdsForUser.mockResolvedValueOnce([BigInt(orgId), BigInt(otherOrgId)]);

    const response = await router.dispatch(
      'tools/call',
      { name: 'create_from_template', arguments: { templateId: '-402' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'orgId', issue: 'ambiguous org' },
      }),
    );
    expect(projectsService.createFromTemplate).not.toHaveBeenCalled();
  });

  it('(f) orgId de org alheia (idPai ausente) → FORBIDDEN', async () => {
    projectsService.resolveOrgIdsForUser.mockResolvedValueOnce([BigInt(orgId)]);

    const response = await router.dispatch(
      'tools/call',
      { name: 'create_from_template', arguments: { templateId: '-402', orgId: otherOrgId } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.FORBIDDEN,
        data: { field: 'orgId', issue: 'not a member' },
      }),
    );
    expect(projectsService.createFromTemplate).not.toHaveBeenCalled();
  });

  it('(g) includeTasks ausente → dto SEM includeTasks (service aplica default)', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'create_from_template', arguments: { templateId, idPai } },
      userCtx,
    );

    expect(projectsService.createFromTemplate).toHaveBeenCalledWith(
      templateId,
      userCtx.dEntidadeId,
      orgId,
      { idPai },
    );
    const dtoArg = projectsService.createFromTemplate.mock.calls[0][3];
    expect(dtoArg).not.toHaveProperty('includeTasks');
  });

  it('(h) includeTasks:false explicito → passthrough', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'create_from_template', arguments: { templateId, idPai, includeTasks: false } },
      userCtx,
    );

    expect(projectsService.createFromTemplate).toHaveBeenCalledWith(
      templateId,
      userCtx.dEntidadeId,
      orgId,
      { includeTasks: false, idPai },
    );
  });

  it('(i) destino sem org (findOne.orgId null) → INVALID_PARAMS', async () => {
    projectsService.findOne.mockResolvedValueOnce({ id: idPai, orgId: null });

    const response = await router.dispatch(
      'tools/call',
      { name: 'create_from_template', arguments: { templateId, idPai } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'idPai', issue: 'parent without org' },
      }),
    );
    expect(projectsService.createFromTemplate).not.toHaveBeenCalled();
  });

  it('(j) 0 orgs (idPai ausente) → INVALID_PARAMS', async () => {
    projectsService.resolveOrgIdsForUser.mockResolvedValueOnce([]);

    const response = await router.dispatch(
      'tools/call',
      { name: 'create_from_template', arguments: { templateId: '-402' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'orgId', issue: 'no org membership' },
      }),
    );
    expect(projectsService.createFromTemplate).not.toHaveBeenCalled();
  });

  it('(k) orgId divergente com idPai presente → ignorado (usa parent.orgId)', async () => {
    projectsService.findOne.mockResolvedValueOnce({ id: idPai, orgId });

    await router.dispatch(
      'tools/call',
      { name: 'create_from_template', arguments: { templateId, idPai, orgId: otherOrgId } },
      userCtx,
    );

    expect(projectsService.resolveOrgIdsForUser).not.toHaveBeenCalled();
    expect(projectsService.createFromTemplate).toHaveBeenCalledWith(
      templateId,
      userCtx.dEntidadeId,
      orgId,
      { idPai },
    );
  });

  it('(l) novoNome/novoIcone + orgId explicito membro → passthrough completo', async () => {
    projectsService.resolveOrgIdsForUser.mockResolvedValueOnce([BigInt(orgId), BigInt(otherOrgId)]);

    await router.dispatch(
      'tools/call',
      {
        name: 'create_from_template',
        arguments: {
          templateId: '-402',
          orgId: otherOrgId,
          novoNome: 'Espaco Cliente Y',
          novoIcone: 'rocket',
        },
      },
      userCtx,
    );

    expect(projectsService.createFromTemplate).toHaveBeenCalledWith(
      '-402',
      userCtx.dEntidadeId,
      otherOrgId,
      { novoNome: 'Espaco Cliente Y', novoIcone: 'rocket' },
    );
  });

  it('(m) templateId faltando → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_from_template', arguments: {} },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'templateId', issue: 'required string' },
      }),
    );
    expect(projectsService.createFromTemplate).not.toHaveBeenCalled();
  });

  it('(n) templateId nao-BigInt → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_from_template', arguments: { templateId: 'xyz' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: { field: 'templateId', issue: 'valid bigint string expected' },
      }),
    );
    expect(projectsService.createFromTemplate).not.toHaveBeenCalled();
  });

  it('(o) expoe create_from_template em tools/list', async () => {
    const result = await router.dispatch('tools/list', undefined, userCtx);

    expect(result.result).toEqual({
      tools: expect.arrayContaining([expect.objectContaining({ name: 'create_from_template' })]),
    });
  });
});
