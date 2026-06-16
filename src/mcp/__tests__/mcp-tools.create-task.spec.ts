import { NotFoundException } from '@nestjs/common';

import { McpRouterService } from '../services/mcp-router.service';
import { CreateTaskTool } from '../tools/create-task.tool';

/**
 * Specs para a tool MCP `create_task` (Task #2 — paridade de campos).
 *
 * Cobre:
 * (a) cria com todos os novos campos (priority/dueDate/idPai/assigneeTeamId/
 *     idBloco) — DTO recebido com `dados: { idBloco }` e `source: 'mcp'`.
 * (b) back-compat: cria so com projectId+titulo — DTO minimo, sem extras.
 * (c) priority invalido → INVALID_PARAMS, service nao chamado.
 * (d) dueDate mal-formado → INVALID_PARAMS.
 * (e) idPai nao-BigInt → INVALID_PARAMS.
 * (f) idBloco nao-BigInt → INVALID_PARAMS.
 * (g) assigneeTeamId nao-BigInt → INVALID_PARAMS.
 * (h) tenant: projectsService.findOne lanca NotFound → propaga, create nao chamado.
 * (i) expoe create_task em tools/list.
 */
describe('MCP create_task tool', () => {
  const projectId = '9007199254740995';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tasks:write'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  const created = { id: '123', projectId, nome: 'Nova task' };

  let tasksService: { create: jest.Mock };
  let projectsService: { findOne: jest.Mock };
  let router: McpRouterService;

  beforeEach(() => {
    tasksService = {
      create: jest.fn().mockResolvedValue(created),
    };
    projectsService = {
      findOne: jest.fn().mockResolvedValue({ id: projectId }),
    };

    router = new McpRouterService(
      undefined,
      new CreateTaskTool(tasksService as never, projectsService as never),
    );
  });

  it('(a) cria com priority/dueDate/idPai/assigneeTeamId/idBloco → DTO completo com dados.idBloco e source mcp', async () => {
    const response = await router.dispatch(
      'tools/call',
      {
        name: 'create_task',
        arguments: {
          projectId,
          titulo: 'Nova task',
          descricao: 'desc',
          assigneeId: '100',
          priority: 'HIGH',
          dueDate: '2026-06-30',
          idPai: '5',
          assigneeTeamId: '42',
          idBloco: '77',
        },
      },
      userCtx,
    );

    expect(projectsService.findOne).toHaveBeenCalledWith(projectId, userCtx.dEntidadeId);
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
        dados: { idBloco: '77' },
        source: 'mcp',
      },
      userCtx.dEntidadeId,
    );
    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(created) }],
    });
  });

  it('(b) back-compat: cria so com projectId+titulo → DTO minimo sem campos extras', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'create_task', arguments: { projectId, titulo: 'Minima' } },
      userCtx,
    );

    expect(tasksService.create).toHaveBeenCalledWith(
      { projectId, nome: 'Minima', source: 'mcp' },
      userCtx.dEntidadeId,
    );
  });

  it('(c) priority invalido → INVALID_PARAMS, service nao chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      {
        name: 'create_task',
        arguments: { projectId, titulo: 'X', priority: 'NUCLEAR' },
      },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'priority', issue: 'one of [LOW|MEDIUM|HIGH|URGENT] expected' },
      }),
    );
    expect(tasksService.create).not.toHaveBeenCalled();
    expect(projectsService.findOne).not.toHaveBeenCalled();
  });

  it('(d) dueDate mal-formado → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      {
        name: 'create_task',
        arguments: { projectId, titulo: 'X', dueDate: 'amanha' },
      },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'dueDate', issue: 'ISO 8601 date string expected' },
      }),
    );
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('(e) idPai nao-BigInt → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      {
        name: 'create_task',
        arguments: { projectId, titulo: 'X', idPai: 'abc' },
      },
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

  it('(f) idBloco nao-BigInt → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      {
        name: 'create_task',
        arguments: { projectId, titulo: 'X', idBloco: 'xyz' },
      },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'idBloco', issue: 'valid bigint string expected' },
      }),
    );
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('(g) assigneeTeamId nao-BigInt → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      {
        name: 'create_task',
        arguments: { projectId, titulo: 'X', assigneeTeamId: 'team' },
      },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'assigneeTeamId', issue: 'valid bigint string expected' },
      }),
    );
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('(h) tenant: projectsService.findOne lanca NotFound → propaga, create nao chamado', async () => {
    projectsService.findOne.mockRejectedValueOnce(
      new NotFoundException(`Projeto ${projectId} não encontrado`),
    );

    await expect(
      router.dispatch(
        'tools/call',
        { name: 'create_task', arguments: { projectId, titulo: 'X' } },
        userCtx,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('(i) expoe create_task em tools/list', async () => {
    const result = await router.dispatch('tools/list', undefined, userCtx);

    expect(result.result).toEqual({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: 'create_task' }),
      ]),
    });
  });
});
