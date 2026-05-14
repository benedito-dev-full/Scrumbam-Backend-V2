import { NotFoundException } from '@nestjs/common';

import { McpRouterService } from '../services/mcp-router.service';
import { ListMembersTool } from '../tools/list-members.tool';

/**
 * Specs para a tool MCP `list_members` (Task #5 — MCP Expansion).
 *
 * Cobre:
 * (a) happy path — lista membros e retorna textResult
 * (b) param `projectId` ausente → INVALID_PARAMS, sem chamar service
 * (c) param `projectId` com tipo errado (number) → INVALID_PARAMS
 * (d) param `projectId` com BigInt invalido → INVALID_PARAMS
 * (e) projeto fora do scope do usuario MCP → NotFoundException (anti enumeration ADR-V2-042)
 * (f) findAccessibleProjectIds vazio → NotFound (sem chamar getMembers)
 * (g) ctx.dEntidadeId (bigint) propagado para findAccessibleProjectIds
 * (h) expoe list_members em tools/list
 * (i) tools/call invoca getMembers com projectId correto apos passar gate
 */
describe('MCP list_members tool', () => {
  const projectId = '9007199254740995';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tools:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  let projectMembersService: { getMembers: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let router: McpRouterService;

  beforeEach(() => {
    projectMembersService = {
      getMembers: jest.fn().mockResolvedValue({
        members: [
          {
            userId: '200',
            nome: 'Alice',
            email: 'alice@example.com',
            role: 'MANAGER',
            cargo: 'Project Manager',
          },
          {
            userId: '201',
            nome: 'Bob',
            email: 'bob@example.com',
            role: 'MEMBER',
            cargo: null,
          },
        ],
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
      undefined,
      undefined,
      new ListMembersTool(projectMembersService as never, projectsService as never),
    );
  });

  it('(a) happy path — lista membros e retorna textResult com JSON serializado', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_members', arguments: { projectId } },
      userCtx,
    );

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(userCtx.dEntidadeId);
    expect(projectMembersService.getMembers).toHaveBeenCalledWith(projectId);

    expect(response.result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            members: [
              {
                userId: '200',
                nome: 'Alice',
                email: 'alice@example.com',
                role: 'MANAGER',
                cargo: 'Project Manager',
              },
              {
                userId: '201',
                nome: 'Bob',
                email: 'bob@example.com',
                role: 'MEMBER',
                cargo: null,
              },
            ],
          }),
        },
      ],
    });
  });

  it('(b) sem projectId → INVALID_PARAMS e nao chama services', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_members', arguments: {} },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        message: 'Invalid params',
        data: { field: 'projectId', issue: 'required string' },
      }),
    );
    expect(projectMembersService.getMembers).not.toHaveBeenCalled();
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
  });

  it('(c) projectId com tipo errado (number) → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_members', arguments: { projectId: 123 } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'projectId', issue: 'required string' },
      }),
    );
    expect(projectMembersService.getMembers).not.toHaveBeenCalled();
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
  });

  it('(d) projectId nao parseavel como BigInt → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'list_members', arguments: { projectId: 'not-a-bigint' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: { field: 'projectId', issue: 'valid bigint string expected' },
      }),
    );
    expect(projectMembersService.getMembers).not.toHaveBeenCalled();
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
  });

  it('(e) projeto fora do scope (tenant isolation ADR-V2-042) → NotFoundException, nao chama getMembers', async () => {
    // Usuario tem acesso a OUTROS projetos, nao a este.
    const otherProjectId = '9007199254740001';
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce([otherProjectId]);

    await expect(
      router.dispatch('tools/call', { name: 'list_members', arguments: { projectId } }, userCtx),
    ).rejects.toThrow(NotFoundException);

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(userCtx.dEntidadeId);
    expect(projectMembersService.getMembers).not.toHaveBeenCalled();
  });

  it('(f) findAccessibleProjectIds vazio → NotFound (gate bloqueia, sem chamar getMembers)', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce([]);

    await expect(
      router.dispatch('tools/call', { name: 'list_members', arguments: { projectId } }, userCtx),
    ).rejects.toThrow(NotFoundException);

    expect(projectMembersService.getMembers).not.toHaveBeenCalled();
  });

  it('(g) propaga ctx.dEntidadeId (bigint) para findAccessibleProjectIds', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'list_members', arguments: { projectId } },
      userCtx,
    );

    const callArg = projectsService.findAccessibleProjectIds.mock.calls[0][0];
    expect(typeof callArg).toBe('bigint');
    expect(callArg).toBe(userCtx.dEntidadeId);
  });

  it('(h) expoe list_members em tools/list', async () => {
    const result = await router.dispatch('tools/list', undefined, userCtx);

    expect(result.result).toEqual({
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: 'list_members',
          description:
            'Lista os membros de um projeto (com seus roles), escopada aos projetos acessiveis ao usuario MCP.',
        }),
      ]),
    });
  });

  it('(i) chama getMembers exatamente uma vez com o projectId resolvido', async () => {
    // Cenario: usuario tem acesso a multiplos projetos, inclusive ao target.
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce(['1', projectId, '999']);

    await router.dispatch(
      'tools/call',
      { name: 'list_members', arguments: { projectId } },
      userCtx,
    );

    expect(projectMembersService.getMembers).toHaveBeenCalledTimes(1);
    expect(projectMembersService.getMembers).toHaveBeenCalledWith(projectId);
  });
});
