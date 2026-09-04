import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { MCP_ERROR_CODES } from '../constants';
import { McpRouterService } from '../services/mcp-router.service';
import { McpTool, McpToolResult } from '../tools/tool.interface';

/**
 * Regressão do incidente 2026-09-04: `get_project`, `get_project_metrics`,
 * `list_members`, `list_block_tasks` e `get_task_tree` lançam
 * `NotFoundException` (NestJS) direto do handler para sinalizar
 * anti-enumeration (ADR-V2-042). Como `dispatchTool` só capturava
 * `McpToolError`/`McpTimeoutError`, a `HttpException` escapava até o filtro
 * global e virava um HTTP 404 CRU — quebrando o envelope JSON-RPC que o
 * transporte Streamable HTTP exige para todo request com `id`. O cliente MCP
 * (Claude Code/Web) via isso como sessão morta e reconectava em loop.
 *
 * Este teste prova que QUALQUER `HttpException` escapando de um tool handler
 * (não só as 5 já auditadas) é traduzida para um erro JSON-RPC válido —
 * defesa centralizada no router, não por tool individual.
 */
describe('McpRouterService — HttpException de tool NUNCA escapa como HTTP cru (regressão)', () => {
  const userCtx = {
    dEntidadeId: BigInt(1),
    scopes: ['tasks:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  function fakeTool(name: string, handler: () => Promise<McpToolResult>): McpTool {
    return { name, description: 'fake', inputSchema: {}, handler };
  }

  /**
   * Injeta a fake tool na posição de `getProjectTool` (8o parâmetro
   * posicional). Todos os demais tools/config/adapter ficam `undefined` —
   * o router cai no wrapper legado (sem capabilityAdapter).
   */
  function routerWithFakeGetProjectTool(handler: () => Promise<McpToolResult>): McpRouterService {
    const tool = fakeTool('get_project', handler) as never;
    return new McpRouterService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      tool,
    );
  }

  it('NotFoundException → JSON-RPC error NOT_FOUND (-32004), sem lançar', async () => {
    const router = routerWithFakeGetProjectTool(() => {
      throw new NotFoundException('Projeto 88 não encontrado');
    });

    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project', arguments: {} },
      userCtx,
    );

    expect(response.error).toEqual({
      code: MCP_ERROR_CODES.NOT_FOUND,
      message: 'Projeto 88 não encontrado',
    });
    expect(response.result).toBeUndefined();
  });

  it('ForbiddenException → JSON-RPC error FORBIDDEN (-32002), sem lançar', async () => {
    const router = routerWithFakeGetProjectTool(() => {
      throw new ForbiddenException('sem permissao');
    });

    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project', arguments: {} },
      userCtx,
    );

    expect(response.error).toEqual({
      code: MCP_ERROR_CODES.FORBIDDEN,
      message: 'sem permissao',
    });
  });
});
