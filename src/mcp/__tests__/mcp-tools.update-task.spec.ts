import { BadRequestException, NotFoundException } from '@nestjs/common';

import { MCP_ERROR_CODES } from '../constants';
import { McpRouterService } from '../services/mcp-router.service';
import { UpdateTaskTool } from '../tools/update-task.tool';

/**
 * Specs para a tool MCP `update_task` (Task #2 — MCP Expansion).
 *
 * Cobre:
 * (a) sucesso so com `name` (basicos) — chama update + findOne
 * (b) sucesso so com `status` — chama updateStatus + findOne
 * (d) sucesso combinando 2 campos (name + status) — chama update + updateStatus
 * (e) sucesso combinando 3+ campos (name + description + priority + assignee + status)
 * (f) erro: nenhum campo de update enviado (so taskId) → INVALID_PARAMS
 * (g) erro: taskId missing → INVALID_PARAMS
 * (h) erro: taskId nao parseavel como BigInt → INVALID_PARAMS
 * (i) erro: priority com enum invalido
 * (j) tenant isolation — NotFoundException propagada (task de outro tenant)
 * (k) ctx.dEntidadeId (bigint) propagado para findAccessibleProjectIds
 * (l) ordem de chamada: update → updateStatus → findOne
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
    scopes: ['tasks:write'],
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
    findOne: jest.Mock;
  };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let router: McpRouterService;

  beforeEach(() => {
    tasksService = {
      update: jest.fn().mockResolvedValue({ id: taskId }),
      updateStatus: jest.fn().mockResolvedValue({ id: taskId }),
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
      new UpdateTaskTool(tasksService as never, projectsService as never),
    );
  });

  // ── Casos de sucesso ──────────────────────────────────────────────────

  it('(a) sucesso so com `name` — chama update + findOne, NAO chama updateStatus', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, name: 'Novo nome' } },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledWith(taskId, { nome: 'Novo nome' }, [projectId]);
    expect(tasksService.updateStatus).not.toHaveBeenCalled();
    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, [projectId]);

    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(finalTask) }],
    });
  });

  it('(b) sucesso so com `status` — chama updateStatus + findOne, NAO chama update', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, status: 'READY' } },
      userCtx,
    );

    expect(tasksService.update).not.toHaveBeenCalled();
    expect(tasksService.updateStatus).toHaveBeenCalledWith(
      taskId,
      { status: 'READY', movedBy: userCtx.dEntidadeId.toString() },
      userCtx.dEntidadeId,
      [projectId],
    );
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
    // Task #794: findOne é chamado 2x — 1x no início (gate de tenant + trava de
    // concorrência, carrega o estado atual) e 1x no fim (snapshot pós-mutação).
    expect(tasksService.findOne).toHaveBeenCalledTimes(2);
  });

  it('(e) sucesso combinando 3+ campos (name + description + priority + assignee + status)', async () => {
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
    expect(tasksService.updateStatus).toHaveBeenCalledWith(
      taskId,
      { status: 'READY', movedBy: userCtx.dEntidadeId.toString() },
      userCtx.dEntidadeId,
      [projectId],
    );
    // Task #794: findOne é chamado 2x — 1x no início (gate de tenant + trava de
    // concorrência, carrega o estado atual) e 1x no fim (snapshot pós-mutação).
    expect(tasksService.findOne).toHaveBeenCalledTimes(2);
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

  it('(j) tenant isolation — NotFoundException do findOne (task de outro tenant) propaga', async () => {
    const otherProjectId = '9007199254740001';
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce([otherProjectId]);
    // Task #794: update_task carrega a task ANTES de mutar (gate de tenant +
    // trava de concorrência). Com scope alheio, o findOne inicial lança NotFound
    // — a mutação nunca é alcançada.
    tasksService.findOne.mockRejectedValueOnce(
      new NotFoundException(`Task ${taskId} não encontrada`),
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, name: 'X' } },
      userCtx,
    );
    expect(response.error).toEqual(expect.objectContaining({ code: MCP_ERROR_CODES.NOT_FOUND }));

    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, [otherProjectId]);
    expect(tasksService.update).not.toHaveBeenCalled();
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

  it('(l) ordem de chamada: findOne(gate) → update → updateStatus → findOne(snapshot)', async () => {
    const callOrder: string[] = [];
    tasksService.update.mockImplementationOnce(async () => {
      callOrder.push('update');
      return { id: taskId };
    });
    tasksService.updateStatus.mockImplementationOnce(async () => {
      callOrder.push('updateStatus');
      return { id: taskId };
    });
    // Task #794: findOne agora é chamado 2x (gate/trava no início + snapshot no
    // fim). Empurra em TODA chamada para verificar a ordem completa.
    tasksService.findOne.mockImplementation(async () => {
      callOrder.push('findOne');
      return finalTask;
    });

    await router.dispatch(
      'tools/call',
      {
        name: 'update_task',
        arguments: { taskId, name: 'X', status: 'READY' },
      },
      userCtx,
    );

    expect(callOrder).toEqual(['findOne', 'update', 'updateStatus', 'findOne']);
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

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, status: 'DONE' } },
      userCtx,
    );
    expect(response.error).toEqual(
      expect.objectContaining({ code: MCP_ERROR_CODES.INVALID_PARAMS }),
    );
  });

  // ── Novos campos: dueDate / idPai / idBloco (Task #2 paridade) ────────

  it('(r) dueDate string → update recebe { dueDate }', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, dueDate: '2026-06-30' } },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledWith(taskId, { dueDate: '2026-06-30' }, [
      projectId,
    ]);
  });

  it('(s) dueDate null → update recebe { dueDate: null } (remove)', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, dueDate: null } },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledWith(taskId, { dueDate: null }, [projectId]);
  });

  it('(t) idPai string → update recebe { idPai }', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, idPai: '5' } },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledWith(taskId, { idPai: '5' }, [projectId]);
  });

  it('(u) idPai null → update recebe { idPai: null } (move para raiz)', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, idPai: null } },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledWith(taskId, { idPai: null }, [projectId]);
  });

  it('(v) idBloco string → update recebe { dados: { idBloco } }', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, idBloco: '77' } },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledWith(taskId, { dados: { idBloco: '77' } }, [
      projectId,
    ]);
  });

  it('(w) idBloco null → update recebe { dados: { idBloco: null } } (desvincula)', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, idBloco: null } },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledWith(taskId, { dados: { idBloco: null } }, [
      projectId,
    ]);
  });

  it('(x) combinacao idPai + idBloco + dueDate → 1 chamada a update, sem updateStatus', async () => {
    await router.dispatch(
      'tools/call',
      {
        name: 'update_task',
        arguments: { taskId, idPai: '5', idBloco: '77', dueDate: '2026-06-30' },
      },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledTimes(1);
    expect(tasksService.update).toHaveBeenCalledWith(
      taskId,
      { dueDate: '2026-06-30', idPai: '5', dados: { idBloco: '77' } },
      [projectId],
    );
    expect(tasksService.updateStatus).not.toHaveBeenCalled();
  });

  it('(y) dueDate mal-formado → INVALID_PARAMS sem chamar service', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, dueDate: 'amanha' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'dueDate', issue: 'ISO 8601 date string expected' },
      }),
    );
    expect(tasksService.update).not.toHaveBeenCalled();
  });

  it('(z) idPai nao-BigInt → INVALID_PARAMS sem chamar service', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, idPai: 'abc' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'idPai', issue: 'valid bigint string expected' },
      }),
    );
    expect(tasksService.update).not.toHaveBeenCalled();
  });

  it('(aa) tenant: idBloco nao burla scope — NotFound do findOne(gate) propaga', async () => {
    // Task #794: o gate de tenant é o findOne inicial; scope alheio → NotFound
    // antes de qualquer mutação (idBloco não alcança o service).
    tasksService.findOne.mockRejectedValueOnce(
      new NotFoundException(`Task ${taskId} não encontrada`),
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, idBloco: '77' } },
      userCtx,
    );
    expect(response.error).toEqual(expect.objectContaining({ code: MCP_ERROR_CODES.NOT_FOUND }));

    expect(tasksService.update).not.toHaveBeenCalled();
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
