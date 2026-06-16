import { McpRouterService } from '../services/mcp-router.service';
import { UpdateTaskTool } from '../tools/update-task.tool';

/**
 * Specs para o parametro `fields` (valores de colunas customizaveis) da tool
 * MCP `update_task` (Task 4b-valores).
 *
 * `fields` segue a filosofia do `idBloco` (ADR-V2-065): top-level controlado,
 * empacotado em `dados.fields` e mesclado com `idBloco` numa UNICA chave
 * `dados`. Semantica: presente=merge (o service mescla por chave), ausente=nao
 * toca; `null` DENTRO de fields limpa aquela coluna. A MCP NAO valida o tipo
 * dos valores — o backend valida server-side contra `DProject.tableFields`.
 *
 * Cobre:
 * (a) fields sozinho → update com `dados: { fields }`; findOne; sem status.
 * (b) fields + idBloco JUNTOS → update com `dados: { idBloco, fields }` (merge!).
 * (c) fields ausente → update nao recebe `dados` (quando ha outro basico).
 * (d) valor null DENTRO de fields → repassado fiel.
 * (e) fields como unica atualizacao e aceito (anyOf) — nao cai em INVALID_PARAMS.
 * (f) fields nao-objeto (string) → INVALID_PARAMS, service nao chamado.
 * (g) fields como array → INVALID_PARAMS, service nao chamado.
 */
describe('MCP update_task tool — parametro fields', () => {
  const taskId = '9007199254740993';
  const projectId = '9007199254740995';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tasks:write'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  const finalTask = { id: taskId, projectId, nome: 'Final', status: 'READY' };

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

  it('(a) fields sozinho → update com dados.fields, findOne, sem updateStatus', async () => {
    await router.dispatch(
      'tools/call',
      {
        name: 'update_task',
        arguments: { taskId, fields: { f_a1b2: 'o_1', f_c3d4: 42 } },
      },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledWith(
      taskId,
      { dados: { fields: { f_a1b2: 'o_1', f_c3d4: 42 } } },
      [projectId],
    );
    expect(tasksService.updateStatus).not.toHaveBeenCalled();
    expect(tasksService.findOne).toHaveBeenCalledWith(taskId, [projectId]);
  });

  it('(b) fields + idBloco JUNTOS → update com dados.idBloco e dados.fields (prova do merge)', async () => {
    await router.dispatch(
      'tools/call',
      {
        name: 'update_task',
        arguments: { taskId, idBloco: '77', fields: { f_a1b2: 'o_1' } },
      },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledWith(
      taskId,
      { dados: { idBloco: '77', fields: { f_a1b2: 'o_1' } } },
      [projectId],
    );
  });

  it('(c) fields ausente → update nao recebe dados (so o campo basico enviado)', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, name: 'Novo nome' } },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledWith(taskId, { nome: 'Novo nome' }, [projectId]);
    const dto = tasksService.update.mock.calls[0][1];
    expect(dto).not.toHaveProperty('dados');
  });

  it('(d) valor null DENTRO de fields → repassado fiel', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, fields: { f_a1b2: null } } },
      userCtx,
    );

    expect(tasksService.update).toHaveBeenCalledWith(
      taskId,
      { dados: { fields: { f_a1b2: null } } },
      [projectId],
    );
  });

  it('(e) fields como unica atualizacao e aceito (anyOf), nao cai em INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, fields: { f_a1b2: 'o_1' } } },
      userCtx,
    );

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(finalTask) }],
    });
    expect(tasksService.update).toHaveBeenCalledTimes(1);
  });

  it('(f) fields nao-objeto (string) → INVALID_PARAMS, service nao chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, fields: 'nope' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'fields', issue: 'object expected' },
      }),
    );
    expect(tasksService.update).not.toHaveBeenCalled();
  });

  it('(g) fields como array → INVALID_PARAMS, service nao chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId, fields: ['a', 'b'] } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'fields', issue: 'object expected' },
      }),
    );
    expect(tasksService.update).not.toHaveBeenCalled();
  });
});
