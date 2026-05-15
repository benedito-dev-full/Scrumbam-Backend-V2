import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { McpRouterService } from '../services/mcp-router.service';
import { UpdateProjectTool } from '../tools/update-project.tool';

/**
 * Specs para a tool MCP `update_project` (Task #7 — MCP Expansion).
 *
 * Cobre:
 * (a) happy path — atualiza `nome` com sucesso
 * (b) happy path — atualiza múltiplos campos (nome + description + gitRepo)
 * (c) params inválidos — `projectId` ausente → INVALID_PARAMS, nenhum service chamado
 * (d) params inválidos — nenhum campo além de projectId → INVALID_PARAMS
 * (e) ForbiddenException (caller não é MANAGER) → propagada como exception
 * (f) NotFoundException (projeto inexistente) → propagada como exception
 * (g) organizationId NÃO é passado para projectsService.update
 * (h) campos ausentes não são incluídos no DTO (spy no call args)
 * (i) teamId=null → DTO contém teamId: null (desvincular time)
 * (j) automationEnabled=false → campo incluído corretamente
 * (k) teamId ausente → campo NÃO incluído no DTO (vínculo inalterado)
 * (l) projectId não parseable como BigInt → INVALID_PARAMS
 * (m) expoe update_project em tools/list
 */
describe('MCP update_project tool', () => {
  const projectId = '9007199254740995';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tools:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  const updatedProject = {
    chave: projectId,
    nome: 'Novo Nome',
    description: null,
    organizationId: '50',
    teamId: null,
  };

  let projectsService: {
    update: jest.Mock;
  };
  let router: McpRouterService;

  beforeEach(() => {
    projectsService = {
      update: jest.fn().mockResolvedValue(updatedProject),
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
      new UpdateProjectTool(projectsService as never),
    );
  });

  it('(a) happy path — atualiza nome com sucesso', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_project', arguments: { projectId, nome: 'Novo Nome' } },
      userCtx,
    );

    expect(projectsService.update).toHaveBeenCalledTimes(1);
    expect(projectsService.update).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({ nome: 'Novo Nome' }),
      userCtx.dEntidadeId,
    );

    expect(response.result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(updatedProject),
        },
      ],
    });
  });

  it('(b) happy path — atualiza múltiplos campos (nome + description + gitRepo)', async () => {
    const args = {
      projectId,
      nome: 'Projeto Atualizado',
      description: 'Descrição nova',
      gitRepo: 'https://github.com/org/repo',
    };

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_project', arguments: args },
      userCtx,
    );

    expect(projectsService.update).toHaveBeenCalledTimes(1);
    expect(projectsService.update).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({
        nome: 'Projeto Atualizado',
        description: 'Descrição nova',
        gitRepo: 'https://github.com/org/repo',
      }),
      userCtx.dEntidadeId,
    );

    expect(response.result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(updatedProject),
        },
      ],
    });
  });

  it('(c) sem projectId → INVALID_PARAMS, nenhum service chamado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_project', arguments: { nome: 'Teste' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        message: 'Invalid params',
        data: { field: 'projectId', issue: 'required string' },
      }),
    );
    expect(projectsService.update).not.toHaveBeenCalled();
  });

  it('(d) nenhum campo de update além de projectId → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_project', arguments: { projectId } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        message: 'Invalid params',
        data: {
          field: 'body',
          issue: expect.stringContaining('at least one field'),
        },
      }),
    );
    expect(projectsService.update).not.toHaveBeenCalled();
  });

  it('(e) ForbiddenException (caller não é MANAGER) → propagada como exception', async () => {
    projectsService.update.mockRejectedValueOnce(new ForbiddenException('Sem permissão'));

    await expect(
      router.dispatch(
        'tools/call',
        { name: 'update_project', arguments: { projectId, nome: 'Teste' } },
        userCtx,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(projectsService.update).toHaveBeenCalledTimes(1);
  });

  it('(f) NotFoundException (projeto inexistente) → propagada como exception', async () => {
    projectsService.update.mockRejectedValueOnce(
      new NotFoundException(`Projeto ${projectId} não encontrado`),
    );

    await expect(
      router.dispatch(
        'tools/call',
        { name: 'update_project', arguments: { projectId, nome: 'Teste' } },
        userCtx,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(projectsService.update).toHaveBeenCalledTimes(1);
  });

  it('(g) organizationId NÃO é passado para projectsService.update (MCP é cross-org)', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_project', arguments: { projectId, nome: 'Teste' } },
      userCtx,
    );

    // update(id, dto, userEntidadeId) — 3 args; NÃO deve ter 4º arg (organizationId).
    const callArgs = projectsService.update.mock.calls[0];
    expect(callArgs).toHaveLength(3);
    expect(callArgs[0]).toBe(projectId);
    expect(callArgs[2]).toBe(userCtx.dEntidadeId);
  });

  it('(h) campos ausentes não são incluídos no DTO', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_project', arguments: { projectId, automationEnabled: true } },
      userCtx,
    );

    const callDto = projectsService.update.mock.calls[0][1] as Record<string, unknown>;

    // automationEnabled foi fornecido — deve estar no DTO.
    expect(callDto).toHaveProperty('automationEnabled', true);

    // Campos não fornecidos NÃO devem estar no DTO.
    expect(callDto).not.toHaveProperty('nome');
    expect(callDto).not.toHaveProperty('description');
    expect(callDto).not.toHaveProperty('prefix');
    expect(callDto).not.toHaveProperty('gitRepo');
    expect(callDto).not.toHaveProperty('teamId');
  });

  it('(i) teamId=null → DTO contém teamId: null (desvincular time)', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_project', arguments: { projectId, teamId: null } },
      userCtx,
    );

    const callDto = projectsService.update.mock.calls[0][1] as Record<string, unknown>;
    expect('teamId' in callDto).toBe(true);
    expect(callDto.teamId).toBeNull();
  });

  it('(j) automationEnabled=false → campo incluído corretamente (não ignorado como falsy)', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_project', arguments: { projectId, automationEnabled: false } },
      userCtx,
    );

    const callDto = projectsService.update.mock.calls[0][1] as Record<string, unknown>;
    expect(callDto).toHaveProperty('automationEnabled', false);
  });

  it('(k) teamId ausente → campo NÃO incluído no DTO (vínculo inalterado)', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'update_project', arguments: { projectId, nome: 'Sem TeamId' } },
      userCtx,
    );

    const callDto = projectsService.update.mock.calls[0][1] as Record<string, unknown>;
    expect('teamId' in callDto).toBe(false);
  });

  it('(l) projectId não parseable como BigInt → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'update_project', arguments: { projectId: 'nao-e-bigint', nome: 'Teste' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'projectId', issue: 'valid bigint string expected' },
      }),
    );
    expect(projectsService.update).not.toHaveBeenCalled();
  });

  it('(m) expoe update_project em tools/list', async () => {
    const result = await router.dispatch('tools/list', undefined, userCtx);

    expect(result.result).toEqual({
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: 'update_project',
          description:
            'Atualiza propriedades de um projeto. Requer role MANAGER no projeto. Use get_project para consultar antes de editar.',
        }),
      ]),
    });
  });
});
