import { McpRouterService } from '../services/mcp-router.service';
import { CreateTaskTool } from '../tools/create-task.tool';

/**
 * Specs para o parametro `fields` (valores de colunas customizaveis) da tool
 * MCP `create_task` (Task 4b-valores).
 *
 * O backend valida `fields` server-side contra `DProject.tableFields` — a MCP
 * apenas EMPACOTA o objeto top-level `fields` em `dados.fields`, mesclando com
 * `idBloco` numa UNICA chave `dados`. Estes testes provam o transporte fiel e
 * o merge correto, NAO a validacao de tipo por coluna (responsabilidade do
 * backend).
 *
 * Cobre:
 * (a) fields sozinho → DTO com `dados: { fields }`, sem `idBloco`.
 * (b) fields + idBloco JUNTOS → DTO com `dados: { idBloco, fields }` (merge!).
 * (c) fields ausente → DTO sem chave `dados`.
 * (d) valor null DENTRO de fields → repassado fiel.
 * (e) fields nao-objeto (string) → INVALID_PARAMS, service nao chamado.
 * (f) fields como array → INVALID_PARAMS, service nao chamado.
 */
describe('MCP create_task tool — parametro fields', () => {
  const projectId = '9007199254740995';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tools:write'],
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

  it('(a) fields sozinho → DTO com dados.fields, sem idBloco', async () => {
    await router.dispatch(
      'tools/call',
      {
        name: 'create_task',
        arguments: {
          projectId,
          titulo: 'Com fields',
          fields: { f_a1b2: 'o_1', f_c3d4: 42, f_done: true },
        },
      },
      userCtx,
    );

    expect(tasksService.create).toHaveBeenCalledWith(
      {
        projectId,
        nome: 'Com fields',
        dados: { fields: { f_a1b2: 'o_1', f_c3d4: 42, f_done: true } },
        source: 'mcp',
      },
      userCtx.dEntidadeId,
    );
  });

  it('(b) fields + idBloco JUNTOS → DTO com dados.idBloco e dados.fields (prova do merge)', async () => {
    await router.dispatch(
      'tools/call',
      {
        name: 'create_task',
        arguments: {
          projectId,
          titulo: 'Bloco + fields',
          idBloco: '77',
          fields: { f_a1b2: 'o_1' },
        },
      },
      userCtx,
    );

    expect(tasksService.create).toHaveBeenCalledWith(
      {
        projectId,
        nome: 'Bloco + fields',
        dados: { idBloco: '77', fields: { f_a1b2: 'o_1' } },
        source: 'mcp',
      },
      userCtx.dEntidadeId,
    );
  });

  it('(c) fields ausente → DTO sem chave dados', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'create_task', arguments: { projectId, titulo: 'Sem fields' } },
      userCtx,
    );

    expect(tasksService.create).toHaveBeenCalledWith(
      { projectId, nome: 'Sem fields', source: 'mcp' },
      userCtx.dEntidadeId,
    );
    const dto = tasksService.create.mock.calls[0][0];
    expect(dto).not.toHaveProperty('dados');
  });

  it('(d) valor null DENTRO de fields → repassado fiel', async () => {
    await router.dispatch(
      'tools/call',
      {
        name: 'create_task',
        arguments: {
          projectId,
          titulo: 'Limpa coluna',
          fields: { f_a1b2: null },
        },
      },
      userCtx,
    );

    expect(tasksService.create).toHaveBeenCalledWith(
      {
        projectId,
        nome: 'Limpa coluna',
        dados: { fields: { f_a1b2: null } },
        source: 'mcp',
      },
      userCtx.dEntidadeId,
    );
  });

  it('(e) fields nao-objeto (string) → INVALID_PARAMS, service nao chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      {
        name: 'create_task',
        arguments: { projectId, titulo: 'X', fields: 'nope' },
      },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'fields', issue: 'object expected' },
      }),
    );
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('(f) fields como array → INVALID_PARAMS, service nao chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      {
        name: 'create_task',
        arguments: { projectId, titulo: 'X', fields: ['a', 'b'] },
      },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'fields', issue: 'object expected' },
      }),
    );
    expect(tasksService.create).not.toHaveBeenCalled();
  });
});
