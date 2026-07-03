import { NotFoundException } from '@nestjs/common';

import { MCP_ERROR_CODES } from '../constants';
import { McpRouterService } from '../services/mcp-router.service';
import { CreateBlockTool } from '../tools/create-block.tool';

/**
 * Specs para a tool MCP `create_block` (Task #1 — wrapper fino sobre
 * `TasksService.create` com idClasse=-200 fixo).
 *
 * Cobre:
 * (a) happy path raiz: projectId+titulo → DTO { nome, idClasse:'-200',
 *     projectId, source:'mcp' }; findOne chamado antes de create.
 * (b) sub-fase: descricao + idPai repassados ao service.
 * (c) scope ausente → FORBIDDEN (-32002), service nao chamado.
 * (d) projectId faltando → INVALID_PARAMS.
 * (e) titulo faltando → INVALID_PARAMS.
 * (f) projectId nao-BigInt → INVALID_PARAMS.
 * (g) idPai nao-BigInt → INVALID_PARAMS.
 * (h) titulo > 512 → INVALID_PARAMS.
 * (i) tenant: projectsService.findOne lanca NotFound → propaga, create nao chamado.
 * (j) expoe create_block em tools/list (guarda anti-footgun de registro).
 */
describe('MCP create_block tool', () => {
  const projectId = '9007199254740995';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tasks:write'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  const created = { id: '500', projectId, nome: 'Bloco A', idClasse: '-200' };

  let tasksService: { create: jest.Mock };
  let projectsService: { findOne: jest.Mock };
  let router: McpRouterService;

  /**
   * `create_block` e o ULTIMO tool no ctor posicional do router (indice 21,
   * apos list_my_tasks). Preenche 21 posicoes com undefined e injeta o tool
   * na posicao correta; configService (indice 22) fica undefined.
   */
  function buildRouter(tool: CreateBlockTool): McpRouterService {
    const args: unknown[] = new Array(21).fill(undefined);
    args.push(tool);
    return new McpRouterService(...(args as never[]));
  }

  beforeEach(() => {
    tasksService = {
      create: jest.fn().mockResolvedValue(created),
    };
    projectsService = {
      findOne: jest.fn().mockResolvedValue({ id: projectId }),
    };

    router = buildRouter(new CreateBlockTool(tasksService as never, projectsService as never));
  });

  it('(a) cria bloco raiz → DTO { nome, idClasse:-200, projectId, source mcp } apos findOne', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_block', arguments: { projectId, titulo: 'Bloco A' } },
      userCtx,
    );

    expect(projectsService.findOne).toHaveBeenCalledWith(projectId, userCtx.dEntidadeId);
    expect(tasksService.create).toHaveBeenCalledWith(
      {
        projectId,
        nome: 'Bloco A',
        idClasse: '-200',
        source: 'mcp',
      },
      userCtx.dEntidadeId,
    );
    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(created) }],
    });
  });

  it('(b) sub-fase: descricao + idPai repassados ao service', async () => {
    await router.dispatch(
      'tools/call',
      {
        name: 'create_block',
        arguments: { projectId, titulo: 'Sub-fase', descricao: 'desc', idPai: '77' },
      },
      userCtx,
    );

    expect(tasksService.create).toHaveBeenCalledWith(
      {
        projectId,
        nome: 'Sub-fase',
        idClasse: '-200',
        descricao: 'desc',
        idPai: '77',
        source: 'mcp',
      },
      userCtx.dEntidadeId,
    );
  });

  it('(c) scope ausente → FORBIDDEN, service nao chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_block', arguments: { projectId, titulo: 'Bloco A' } },
      { ...userCtx, scopes: [] },
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.FORBIDDEN,
        data: { requiredScope: 'tasks:write' },
      }),
    );
    expect(projectsService.findOne).not.toHaveBeenCalled();
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('(d) projectId faltando → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_block', arguments: { titulo: 'Bloco A' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'projectId', issue: 'required string' },
      }),
    );
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('(e) titulo faltando → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_block', arguments: { projectId } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'titulo', issue: 'required string' },
      }),
    );
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('(f) projectId nao-BigInt → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_block', arguments: { projectId: 'abc', titulo: 'Bloco A' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'projectId', issue: 'valid bigint string expected' },
      }),
    );
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('(g) idPai nao-BigInt → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_block', arguments: { projectId, titulo: 'Bloco A', idPai: 'xyz' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'idPai', issue: 'valid bigint string expected' },
      }),
    );
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('(h) titulo > 512 → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'create_block', arguments: { projectId, titulo: 'x'.repeat(513) } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'titulo', issue: 'max length 512 exceeded' },
      }),
    );
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('(i) tenant: findOne lanca NotFound → propaga, create nao chamado', async () => {
    projectsService.findOne.mockRejectedValueOnce(
      new NotFoundException(`Projeto ${projectId} não encontrado`),
    );

    await expect(
      router.dispatch(
        'tools/call',
        { name: 'create_block', arguments: { projectId, titulo: 'Bloco A' } },
        userCtx,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('(j) expoe create_block em tools/list', async () => {
    const result = await router.dispatch('tools/list', undefined, userCtx);

    expect(result.result).toEqual({
      tools: expect.arrayContaining([expect.objectContaining({ name: 'create_block' })]),
    });
  });
});
