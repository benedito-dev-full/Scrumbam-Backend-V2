import { BadRequestException, NotFoundException } from '@nestjs/common';

import { McpRouterService } from '../services/mcp-router.service';
import { UpdateTaskTool } from '../tools/update-task.tool';

/**
 * Specs para a tool MCP `update_task` (Task #2 — MCP Expansion).
 *
 * Cobre:
 * (a) sucesso so com `name` (basicos) — chama update + findOne
 * (b) sucesso so com `status` — chama updateStatus + findOne
 * (c) sucesso so com `sprintId` — chama updateSprint + findOne
 * (d) sucesso combinando 2 campos (name + status) — chama update + updateStatus
 * (e) sucesso combinando 3+ campos (name + status + sprintId)
 * (f) erro: nenhum campo de update enviado (so taskId) → INVALID_PARAMS
 * (g) erro: taskId missing → INVALID_PARAMS
 * (h) erro: taskId nao parseavel como BigInt → INVALID_PARAMS
 * (i) erro: priority com enum invalido
 * (j) tenant isolation — NotFoundException propagada (task de outro tenant)
 * (k) ctx.dEntidadeId (bigint) propagado para findAccessibleProjectIds
 * (l) ordem de chamada: update → updateSprint → updateStatus → findOne
 *
 * Casos extras de qualidade:
 * (m) assigneeId === null → traduzido em '' (semantica "limpar")
 * (n) status invalido → INVALID_PARAMS sem invocar service
 * (o) name com tipo errado (number) → INVALID_PARAMS
 * (p) BadRequestException de transicao invalida propagada
 * (q) expoe update_task em tools/list
 */
describe('MCP update_task tool', () => {
  const taskId = '9007199254740993';
  const projectId = '9007199254740995';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tools:write'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  const finalTask = {
    id: taskId,
    projectId,
    nome: 'Final',
    status: 'READY',
  };

  let tasksService: {
    update: jest.Mock;
    updateStatus: jest.Mock;
    updateSprint: jest.Mock;
    findOne: jest.Mock;
  };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let router: McpRouterService;

  beforeEach(() => {
    tasksService = {
      update: jest.fn().mockResolvedValue({ id: taskId }),
      updateStatus: jest.fn().mockResolvedValue({ id: taskId }),
      updateSprint: jest.fn().mockResolvedValue({ id: taskId }),
      findOne: jest.fn().mockResolvedValue(finalTask),
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
      undefined,
      new UpdateTaskTool(tasksService as never, projectsService as never),
    );
  });

  // ── Casos de sucesso ──────────────────────────────────────────────────

  it('(a) sucesso so com `name` — chama update + findOne, NAO chama updateStatus/updateSprint', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, name: 'Novo nome' } },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledWith(taskId, { nome: 'Novo nome' }, [projectId]);
    expect(tasksService.updateStatus).not.toHaveBeenCalled();
    expect(tasksService.updateSprint).not.toHaveBeenCalled();
    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, [projectId]);

    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(finalTask) }],
    });
  });

  it('(b) sucesso so com `status` — chama updateStatus + findOne, NAO chama update/updateSprint', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, status: 'READY' } },
      userCtx,
    );

    expect(tasksService.update).not.toHaveBeenCalled();
    expect(tasksService.updateSprint).not.toHaveBeenCalled();
    expect(tasksService.updateStatus).toHaveBeenCalledWith(
      taskId,
      { status: 'READY', movedBy: userCtx.dEntidadeId.toString() },
      userCtx.dEntidadeId,
      [projectId],
    );
    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, [projectId]);
  });

  it('(c) sucesso so com `sprintId` — chama updateSprint + findOne, NAO chama update/updateStatus', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, sprintId: '42' } },
      userCtx,
    );

    expect(tasksService.update).not.toHaveBeenCalled();
    expect(tasksService.updateStatus).not.toHaveBeenCalled();
    expect(tasksService.updateSprint).toHaveBeenCalledWith(taskId, { sprintId: '42' }, [projectId]);
    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, [projectId]);
  });

  it('(d) sucesso combinando name + status — chama update E updateStatus', async () => {
    await router.dispatch(
      'tools/call',
      {
        name: 'update_task',
        arguments: { taskId, name: 'X', status: 'EXECUTING' },
      },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledWith(taskId, { nome: 'X' }, [projectId]);
    expect(tasksService.updateStatus).toHaveBeenCalledWith(
      taskId,
      { status: 'EXECUTING', movedBy: userCtx.dEntidadeId.toString() },
      userCtx.dEntidadeId,
      [projectId],
    );
    expect(tasksService.updateSprint).not.toHaveBeenCalled();
    expect(tasksService.findOne).toHaveBeenCalledTimes(1);
  });

  it('(e) sucesso combinando 3+ campos (name + sprintId + status)', async () => {
    await router.dispatch(
      'tools/call',
      {
        name: 'update_task',
        arguments: {
          taskId,
          name: 'X',
          description: 'D',
          priority: 'HIGH',
          assigneeId: '999',
          sprintId: '42',
          status: 'READY',
        },
      },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledWith(
      taskId,
      { nome: 'X', descricao: 'D', priority: 'HIGH', assigneeId: '999' },
      [projectId],
    );
    expect(tasksService.updateSprint).toHaveBeenCalledWith(taskId, { sprintId: '42' }, [projectId]);
    expect(tasksService.updateStatus).toHaveBeenCalledWith(
      taskId,
      { status: 'READY', movedBy: userCtx.dEntidadeId.toString() },
      userCtx.dEntidadeId,
      [projectId],
    );
    expect(tasksService.findOne).toHaveBeenCalledTimes(1);
  });

  // ── Casos de erro INVALID_PARAMS ──────────────────────────────────────

  it('(f) sem nenhum campo de update (so taskId) → INVALID_PARAMS, NAO chama services', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        message: 'Invalid params',
        data: { field: 'arguments', issue: 'at least one field to update is required' },
      }),
    );
    expect(tasksService.update).not.toHaveBeenCalled();
    expect(tasksService.updateStatus).not.toHaveBeenCalled();
    expect(tasksService.updateSprint).not.toHaveBeenCalled();
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
  });

  it('(g) taskId ausente → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { name: 'X' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'taskId', issue: 'required string' },
      }),
    );
    expect(tasksService.update).not.toHaveBeenCalled();
  });

  it('(h) taskId nao parseavel como BigInt → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId: 'not-a-bigint', name: 'X' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'taskId', issue: 'valid bigint string expected' },
      }),
    );
    expect(tasksService.update).not.toHaveBeenCalled();
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
  });

  it('(i) priority com enum invalido → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, priority: 'NUCLEAR' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: {
          field: 'priority',
          issue: 'one of [LOW|MEDIUM|HIGH|URGENT] expected',
        },
      }),
    );
    expect(tasksService.update).not.toHaveBeenCalled();
  });

  // ── Tenant isolation e propagacao de exceptions ───────────────────────

  it('(j) tenant isolation — NotFoundException do service propagada (task de outro tenant)', async () => {
    const otherProjectId = '9007199254740001';
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce([otherProjectId]);
    tasksService.update.mockRejectedValueOnce(
      new NotFoundException(`Task ${taskId} não encontrada`),
    );

    await expect(
      router.dispatch(
        'tools/call',
        { name: 'update_task', arguments: { taskId, name: 'X' } },
        userCtx,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(tasksService.update).toHaveBeenCalledWith(taskId, { nome: 'X' }, [otherProjectId]);
    expect(tasksService.findOne).not.toHaveBeenCalled();
  });

  it('(k) propaga ctx.dEntidadeId (bigint) para findAccessibleProjectIds', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, name: 'X' } },
      userCtx,
    );

    const callArg = projectsService.findAccessibleProjectIds.mock.calls[0][0];
    expect(typeof callArg).toBe('bigint');
    expect(callArg).toBe(userCtx.dEntidadeId);
  });

  it('(l) ordem de chamada: update → updateSprint → updateStatus → findOne', async () => {
    const callOrder: string[] = [];
    tasksService.update.mockImplementationOnce(async () => {
      callOrder.push('update');
      return { id: taskId };
    });
    tasksService.updateSprint.mockImplementationOnce(async () => {
      callOrder.push('updateSprint');
      return { id: taskId };
    });
    tasksService.updateStatus.mockImplementationOnce(async () => {
      callOrder.push('updateStatus');
      return { id: taskId };
    });
    tasksService.findOne.mockImplementationOnce(async () => {
      callOrder.push('findOne');
      return finalTask;
    });

    await router.dispatch(
      'tools/call',
      {
        name: 'update_task',
        arguments: { taskId, name: 'X', sprintId: '42', status: 'READY' },
      },
      userCtx,
    );

    expect(callOrder).toEqual(['update', 'updateSprint', 'updateStatus', 'findOne']);
  });

  // ── Casos extras de qualidade ─────────────────────────────────────────

  it('(m) assigneeId === null → traduzido em "" (semantica "limpar") no update', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, assigneeId: null } },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledWith(taskId, { assigneeId: '' }, [projectId]);
  });

  it('(n) status invalido → INVALID_PARAMS sem invocar service', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, status: 'PIZZA' } },
      userCtx,
    );

    expect(response.error?.code).toBe(-32602);
    expect(tasksService.updateStatus).not.toHaveBeenCalled();
  });

  it('(o) name com tipo errado (number) → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, name: 123 } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'name', issue: 'string expected' },
      }),
    );
    expect(tasksService.update).not.toHaveBeenCalled();
  });

  it('(p) BadRequestException de transicao invalida do service propaga', async () => {
    tasksService.updateStatus.mockRejectedValueOnce(
      new BadRequestException('Transicao invalida: INBOX → DONE'),
    );

    await expect(
      router.dispatch(
        'tools/call',
        { name: 'update_task', arguments: { taskId, status: 'DONE' } },
        userCtx,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('(q) expoe update_task em tools/list', async () => {
    const result = await router.dispatch('tools/list', undefined, userCtx);

    expect(result.result).toEqual({
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: 'update_task',
        }),
      ]),
    });
  });
});
