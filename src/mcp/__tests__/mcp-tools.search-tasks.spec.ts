import { McpRouterService } from '../services/mcp-router.service';
import { SearchTasksTool } from '../tools/search-tasks.tool';
import { TaskSearchResultDto } from '../../search/dto/search-response.dto';

/**
 * Specs para a tool MCP `search_tasks` (Task #4 — MCP Expansion).
 *
 * Cobre:
 * (a) happy path — busca retorna tasks
 * (b) com projectId específico acessível — filtra corretamente
 * (c) accessibleIds vazio → resultado vazio sem chamar searchService
 * (d) q ausente → INVALID_PARAMS, nenhum service chamado
 * (e) q com menos de 2 chars → INVALID_PARAMS
 * (f) projectId não está em accessibleIds → INVALID_PARAMS (anti-enumeration)
 * (g) limit passado corretamente para searchForMcp
 * (h) ctx.dEntidadeId passado como bigint para findAccessibleProjectIds
 * (i) expoe search_tasks em tools/list
 */
describe('MCP search_tasks tool', () => {
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tools:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  const mockTask: TaskSearchResultDto = {
    chave: '100',
    nome: 'Login com OAuth',
    descricao: 'Implementar login',
    idProject: '200',
    projectNome: 'Backend API',
    idStatus: '300',
    criadoEm: '2026-05-01T00:00:00.000Z',
  };

  const mockSearchResult = {
    tasks: [mockTask],
    total: 1,
    q: 'login',
  };

  let projectsService: {
    findAccessibleProjectIds: jest.Mock;
  };
  let searchService: {
    searchForMcp: jest.Mock;
  };
  let router: McpRouterService;

  beforeEach(() => {
    projectsService = {
      findAccessibleProjectIds: jest.fn().mockResolvedValue(['200', '300']),
    };
    searchService = {
      searchForMcp: jest.fn().mockResolvedValue(mockSearchResult),
    };

    router = new McpRouterService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new SearchTasksTool(projectsService as never, searchService as never),
    );
  });

  it('(a) happy path — busca retorna tasks', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'search_tasks', arguments: { q: 'login' } },
      userCtx,
    );

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledTimes(1);
    expect(searchService.searchForMcp).toHaveBeenCalledTimes(1);
    expect(searchService.searchForMcp).toHaveBeenCalledWith(
      'login',
      userCtx.dEntidadeId,
      ['200', '300'],
      { projectId: undefined, limit: 20 },
    );

    expect(response.result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(mockSearchResult),
        },
      ],
    });
  });

  it('(b) com projectId específico acessível — filtra corretamente', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'search_tasks', arguments: { q: 'login', projectId: '200' } },
      userCtx,
    );

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledTimes(1);
    expect(searchService.searchForMcp).toHaveBeenCalledWith(
      'login',
      userCtx.dEntidadeId,
      ['200', '300'],
      { projectId: '200', limit: 20 },
    );

    expect(response.result).toBeDefined();
    expect(response.error).toBeUndefined();
  });

  it('(c) accessibleIds vazio → resultado vazio sem chamar searchService', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce([]);

    const response = await router.dispatch(
      'tools/call',
      { name: 'search_tasks', arguments: { q: 'login' } },
      userCtx,
    );

    expect(searchService.searchForMcp).not.toHaveBeenCalled();
    expect(response.result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ tasks: [], total: 0, q: 'login' }),
        },
      ],
    });
  });

  it('(d) q ausente → INVALID_PARAMS, nenhum service chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'search_tasks', arguments: { limit: 10 } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        message: 'Invalid params',
        data: { field: 'q', issue: 'required string' },
      }),
    );
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
    expect(searchService.searchForMcp).not.toHaveBeenCalled();
  });

  it('(e) q com menos de 2 chars → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'search_tasks', arguments: { q: 'a' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        message: 'Invalid params',
        data: { field: 'q', issue: 'q deve ter no mínimo 2 caracteres' },
      }),
    );
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
    expect(searchService.searchForMcp).not.toHaveBeenCalled();
  });

  it('(f) projectId não está em accessibleIds → INVALID_PARAMS (anti-enumeration)', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'search_tasks', arguments: { q: 'login', projectId: '999' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        message: 'Invalid params',
        data: { field: 'projectId', issue: 'projeto não acessível' },
      }),
    );
    expect(searchService.searchForMcp).not.toHaveBeenCalled();
  });

  it('(g) limit passado corretamente para searchForMcp', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'search_tasks', arguments: { q: 'login', limit: 5 } },
      userCtx,
    );

    expect(searchService.searchForMcp).toHaveBeenCalledWith(
      'login',
      userCtx.dEntidadeId,
      ['200', '300'],
      { projectId: undefined, limit: 5 },
    );
  });

  it('(h) ctx.dEntidadeId passado como bigint para findAccessibleProjectIds', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'search_tasks', arguments: { q: 'login' } },
      userCtx,
    );

    const callArgs = projectsService.findAccessibleProjectIds.mock.calls[0];
    expect(typeof callArgs[0]).toBe('bigint');
    expect(callArgs[0]).toBe(userCtx.dEntidadeId);
  });

  it('(i) expoe search_tasks em tools/list', async () => {
    const result = await router.dispatch('tools/list', undefined, userCtx);

    expect(result.result).toEqual({
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: 'search_tasks',
          description:
            'Busca tasks por texto livre em projetos acessíveis ao usuário. Escopo automático por tenant — retorna apenas tasks de projetos dos quais o usuário é membro.',
        }),
      ]),
    });
  });
});
