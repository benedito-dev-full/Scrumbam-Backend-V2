import { NotFoundException } from '@nestjs/common';

import { McpRouterService } from '../services/mcp-router.service';
import { GetTaskTool } from '../tools/get-task.tool';

/**
 * Specs para a tool MCP `get_task` (Task #1 — MCP Expansion).
 *
 * Cobre:
 * (a) happy path — busca task e retorna textResult
 * (b) param `taskId` ausente → INVALID_PARAMS, sem chamar service
 * (c) param `taskId` com tipo errado (number) → INVALID_PARAMS
 * (d) param `taskId` com BigInt invalido → INVALID_PARAMS
 * (e) NotFoundException do service propagada
 * (f) ctx.dEntidadeId propagado corretamente para findAccessibleProjectIds
 * (g) tenant isolation: task fora do scope retorna NotFound identico ao not-found
 *     (ADR-V2-042 anti enumeration; aqui validado pela passagem de
 *     accessibleProjectIds para o service, que cuida do tenant check).
 * (h) accessibleProjectIds vazio ainda invoca service (service decide 404)
 */
describe('MCP get_task tool', () => {
  const taskId = '9007199254740993';
  const projectId = '9007199254740995';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tools:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  let tasksService: { findOne: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let router: McpRouterService;

  beforeEach(() => {
    tasksService = {
      findOne: jest.fn().mockResolvedValue({
        id: taskId,
        projectId,
        nome: 'Task de teste',
        status: 'INBOX',
      }),
    };
    projectsService = {
      findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]),
    };

    router = new McpRouterService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new GetTaskTool(tasksService as never, projectsService as never),
    );
  });

  it('(a) happy path — busca task e retorna textResult com JSON serializado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_task', arguments: { taskId } },
      userCtx,
    );

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(userCtx.dEntidadeId);
    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, [projectId]);

    expect(response.result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            id: taskId,
            projectId,
            nome: 'Task de teste',
            status: 'INBOX',
          }),
        },
      ],
    });
  });

  it('(b) sem taskId → INVALID_PARAMS e nao chama service', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_task', arguments: {} },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        message: 'Invalid params',
        data: { field: 'taskId', issue: 'required string' },
      }),
    );
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
  });

  it('(c) taskId com tipo errado (number) → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_task', arguments: { taskId: 123 } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'taskId', issue: 'required string' },
      }),
    );
    expect(tasksService.findOne).not.toHaveBeenCalled();
  });

  it('(d) taskId nao parseavel como BigInt → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_task', arguments: { taskId: 'not-a-bigint' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'taskId', issue: 'valid bigint string expected' },
      }),
    );
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
  });

  it('(e) NotFoundException do service propaga ate o caller', async () => {
    const notFound = new NotFoundException(`Task ${taskId} não encontrada`);
    tasksService.findOne.mockRejectedValueOnce(notFound);

    await expect(
      router.dispatch('tools/call', { name: 'get_task', arguments: { taskId } }, userCtx),
    ).rejects.toThrow(notFound);

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(userCtx.dEntidadeId);
  });

  it('(f) propaga ctx.dEntidadeId (bigint) para findAccessibleProjectIds', async () => {
    await router.dispatch('tools/call', { name: 'get_task', arguments: { taskId } }, userCtx);

    const callArg = projectsService.findAccessibleProjectIds.mock.calls[0][0];
    expect(typeof callArg).toBe('bigint');
    expect(callArg).toBe(userCtx.dEntidadeId);
  });

  it('(g) tenant isolation — accessibleProjectIds passados ao service (defense-in-depth ADR-V2-042)', async () => {
    // Simula task de OUTRO tenant: accessibleProjectIds NAO contem o projectId da task.
    // O service e responsavel por lancar NotFound (mensagem identica — anti enumeration).
    // A tool DEVE delegar o tenant check ao service e nao tomar atalhos.
    const otherProjectId = '9007199254740001';
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce([otherProjectId]);
    tasksService.findOne.mockRejectedValueOnce(
      new NotFoundException(`Task ${taskId} não encontrada`),
    );

    await expect(
      router.dispatch('tools/call', { name: 'get_task', arguments: { taskId } }, userCtx),
    ).rejects.toThrow(NotFoundException);

    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, [otherProjectId]);
  });

  it('(h) accessibleProjectIds vazio ainda invoca service (service decide 404)', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce([]);
    tasksService.findOne.mockRejectedValueOnce(
      new NotFoundException(`Task ${taskId} não encontrada`),
    );

    await expect(
      router.dispatch('tools/call', { name: 'get_task', arguments: { taskId } }, userCtx),
    ).rejects.toThrow(NotFoundException);

    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, []);
  });

  it('expoe get_task em tools/list', async () => {
    const result = await router.dispatch('tools/list', undefined, userCtx);

    expect(result.result).toEqual({
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: 'get_task',
          description: 'Busca uma task por ID, escopada aos projetos acessiveis ao usuario MCP.',
        }),
      ]),
    });
  });
});
