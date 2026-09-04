import { MCP_ERROR_CODES } from '../constants';
import { McpRouterService } from '../services/mcp-router.service';
import { GetProjectTool } from '../tools/get-project.tool';

/**
 * Specs para a tool MCP `get_project` (Task #6 — MCP Expansion).
 *
 * Cobre:
 * (a) happy path sem include — retorna apenas projeto base
 * (b) include=['members'] — adiciona campo members
 * (d) include=['stats'] — adiciona campo stats
 * (e) include múltiplo (['members','stats']) — todos services chamados 1× em paralelo
 * (f) projectId missing → INVALID_PARAMS, nenhum service chamado
 * (g) projectId BigInt inválido → INVALID_PARAMS
 * (h) include com valor fora do enum → INVALID_PARAMS
 * (i) include não-array (string) → INVALID_PARAMS
 * (j) projeto fora do scope (tenant isolation) → NotFoundException, NENHUM include chamado
 * (k) ctx.dEntidadeId propagado corretamente para findAccessibleProjectIds e findOne
 * (l) expoe get_project em tools/list
 * (m) tableFields objeto sai no payload base (Task 4a — leitura, ADR-V2-061)
 * (n) tableFields:null sai como null (chave presente, NAO omitida)
 *
 * Nota: Task 4a e LEITURA PURA — escrita de valores/schema de colunas e
 * escopo da Task 4b (futura).
 */
describe('MCP get_project tool', () => {
  const projectId = '9007199254740995';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tasks:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  const projectBase = {
    chave: projectId,
    nome: 'Project Alpha',
    organizationId: '50',
    teamId: null,
  };

  const membersPayload = {
    members: [
      {
        userId: '200',
        nome: 'Alice',
        email: 'alice@example.com',
        role: 'MANAGER',
        cargo: null,
      },
    ],
  };

  const statsPayload = {
    statusCounts: { INBOX: 3, DONE: 1 },
    totalTasks: 4,
  };

  let projectsService: {
    findAccessibleProjectIds: jest.Mock;
    findOne: jest.Mock;
    getStats: jest.Mock;
  };
  let projectMembersService: { getMembers: jest.Mock };
  let router: McpRouterService;

  beforeEach(() => {
    projectsService = {
      findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]),
      findOne: jest.fn().mockResolvedValue(projectBase),
      getStats: jest.fn().mockResolvedValue(statsPayload),
    };
    projectMembersService = {
      getMembers: jest.fn().mockResolvedValue(membersPayload),
    };

    router = new McpRouterService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new GetProjectTool(projectsService as never, projectMembersService as never),
    );
  });

  it('(a) happy path sem include — retorna apenas projeto base', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project', arguments: { projectId } },
      userCtx,
    );

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(userCtx.dEntidadeId);
    expect(projectsService.findOne).toHaveBeenCalledWith(projectId, userCtx.dEntidadeId);
    expect(projectMembersService.getMembers).not.toHaveBeenCalled();
    expect(projectsService.getStats).not.toHaveBeenCalled();

    expect(response.result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(projectBase),
        },
      ],
    });
  });

  it('(b) include=["members"] — adiciona campo members', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project', arguments: { projectId, include: ['members'] } },
      userCtx,
    );

    expect(projectMembersService.getMembers).toHaveBeenCalledTimes(1);
    expect(projectMembersService.getMembers).toHaveBeenCalledWith(projectId);
    expect(projectsService.getStats).not.toHaveBeenCalled();

    expect(response.result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ...projectBase, members: membersPayload }),
        },
      ],
    });
  });

  it('(d) include=["stats"] — adiciona campo stats', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project', arguments: { projectId, include: ['stats'] } },
      userCtx,
    );

    expect(projectsService.getStats).toHaveBeenCalledTimes(1);
    expect(projectsService.getStats).toHaveBeenCalledWith(projectId, userCtx.dEntidadeId);
    expect(projectMembersService.getMembers).not.toHaveBeenCalled();

    expect(response.result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ...projectBase, stats: statsPayload }),
        },
      ],
    });
  });

  it('(e) include múltiplo — todos services chamados 1× em paralelo', async () => {
    // Captura ordem de inicio das calls para validar paralelizacao.
    // Cada mock resolve apos um setImmediate — se rodassem em sequencia,
    // a soma das chamadas seria observavel; em paralelo, todas iniciam
    // ANTES de qualquer uma resolver.
    const callOrder: string[] = [];
    projectsService.findOne.mockImplementation(async () => {
      callOrder.push('findOne:start');
      await new Promise((resolve) => setImmediate(resolve));
      callOrder.push('findOne:end');
      return projectBase;
    });
    projectMembersService.getMembers.mockImplementation(async () => {
      callOrder.push('getMembers:start');
      await new Promise((resolve) => setImmediate(resolve));
      callOrder.push('getMembers:end');
      return membersPayload;
    });
    projectsService.getStats.mockImplementation(async () => {
      callOrder.push('getStats:start');
      await new Promise((resolve) => setImmediate(resolve));
      callOrder.push('getStats:end');
      return statsPayload;
    });

    const response = await router.dispatch(
      'tools/call',
      {
        name: 'get_project',
        arguments: { projectId, include: ['members', 'stats'] },
      },
      userCtx,
    );

    // Todos os 3 services chamados exatamente 1×.
    expect(projectsService.findOne).toHaveBeenCalledTimes(1);
    expect(projectMembersService.getMembers).toHaveBeenCalledTimes(1);
    expect(projectsService.getStats).toHaveBeenCalledTimes(1);

    // Paralelizacao: TODOS os :start ocorrem antes de QUALQUER :end.
    const starts = callOrder.filter((c) => c.endsWith(':start'));
    const firstEndIdx = callOrder.findIndex((c) => c.endsWith(':end'));
    const lastStartIdx = callOrder.lastIndexOf(starts[starts.length - 1]);
    expect(starts).toHaveLength(3);
    expect(lastStartIdx).toBeLessThan(firstEndIdx);

    expect(response.result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ...projectBase,
            members: membersPayload,
            stats: statsPayload,
          }),
        },
      ],
    });
  });

  it('(f) sem projectId → INVALID_PARAMS e nao chama services', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project', arguments: {} },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        message: 'Invalid params',
        data: { field: 'projectId', issue: 'required string' },
      }),
    );
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
    expect(projectsService.findOne).not.toHaveBeenCalled();
    expect(projectMembersService.getMembers).not.toHaveBeenCalled();
    expect(projectsService.getStats).not.toHaveBeenCalled();
  });

  it('(g) projectId nao parseavel como BigInt → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project', arguments: { projectId: 'not-a-bigint' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'projectId', issue: 'valid bigint string expected' },
      }),
    );
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
    expect(projectsService.findOne).not.toHaveBeenCalled();
  });

  it('(h) include com valor fora do enum → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project', arguments: { projectId, include: ['members', 'activity'] } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: {
          field: 'include',
          issue: 'each item must be one of: members, stats',
        },
      }),
    );
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
    expect(projectsService.findOne).not.toHaveBeenCalled();
    expect(projectMembersService.getMembers).not.toHaveBeenCalled();
  });

  it('(i) include não-array (string) → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project', arguments: { projectId, include: 'members' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'include', issue: 'array expected' },
      }),
    );
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
    expect(projectsService.findOne).not.toHaveBeenCalled();
  });

  it('(j) projeto fora do scope (tenant isolation ADR-V2-042) → NotFoundException, nenhum include chamado', async () => {
    const otherProjectId = '9007199254740001';
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce([otherProjectId]);

    const response = await router.dispatch(
      'tools/call',
      {
        name: 'get_project',
        arguments: { projectId, include: ['members', 'stats'] },
      },
      userCtx,
    );
    expect(response.error).toEqual(expect.objectContaining({ code: MCP_ERROR_CODES.NOT_FOUND }));

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(userCtx.dEntidadeId);
    expect(projectsService.findOne).not.toHaveBeenCalled();
    expect(projectMembersService.getMembers).not.toHaveBeenCalled();
    expect(projectsService.getStats).not.toHaveBeenCalled();
  });

  it('(k) propaga ctx.dEntidadeId (bigint) para findAccessibleProjectIds e findOne', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'get_project', arguments: { projectId, include: ['stats'] } },
      userCtx,
    );

    const findAccessibleArg = projectsService.findAccessibleProjectIds.mock.calls[0][0];
    expect(typeof findAccessibleArg).toBe('bigint');
    expect(findAccessibleArg).toBe(userCtx.dEntidadeId);

    expect(projectsService.findOne).toHaveBeenCalledWith(projectId, userCtx.dEntidadeId);
    expect(projectsService.getStats).toHaveBeenCalledWith(projectId, userCtx.dEntidadeId);
  });

  it('(l) expoe get_project em tools/list', async () => {
    const result = await router.dispatch('tools/list', undefined, userCtx);

    expect(result.result).toEqual({
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: 'get_project',
          description:
            'Busca dados de um projeto por ID. Retorna o projeto base (incluindo tableFields — schema das colunas customizáveis da Lista, null para não-Lista). Suporta include opcional (members, stats) para reduzir round-trips do LLM.',
        }),
      ]),
    });
  });

  it('(m) tableFields objeto sai no payload base (sem include) — Task 4a leitura', async () => {
    const tableFields = {
      version: 1,
      columns: [
        { key: 'f_prioridade', type: 'dropdown', label: 'Prioridade', order: 0 },
        { key: 'f_estimativa', type: 'number', label: 'Estimativa', order: 1 },
      ],
    };
    const projectWithFields = { ...projectBase, tableFields };
    projectsService.findOne.mockResolvedValueOnce(projectWithFields);

    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project', arguments: { projectId } },
      userCtx,
    );

    // tableFields vem do findOne (payload base) — NAO e um include opt-in.
    expect(projectMembersService.getMembers).not.toHaveBeenCalled();
    expect(projectsService.getStats).not.toHaveBeenCalled();

    const text = (response.result as { content: { type: string; text: string }[] }).content[0].text;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.tableFields).toEqual(tableFields);
    expect(response.result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(projectWithFields),
        },
      ],
    });
  });

  it('(n) tableFields:null sai como null (chave presente, NAO omitida) — Task 4a leitura', async () => {
    const projectNonList = { ...projectBase, tableFields: null };
    projectsService.findOne.mockResolvedValueOnce(projectNonList);

    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project', arguments: { projectId } },
      userCtx,
    );

    const text = (response.result as { content: { type: string; text: string }[] }).content[0].text;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect('tableFields' in parsed).toBe(true);
    expect(parsed.tableFields).toBeNull();
  });
});
