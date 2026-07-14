import { Injectable } from '@nestjs/common';

import { Capability } from '../../common/tool-capabilities/capability.interface';
import { CapabilityError } from '../../common/tool-capabilities/capability-error';
import { CapabilityRegistry } from '../../common/tool-capabilities/capability-registry';
import { fromMcp, ToolPrincipal } from '../../common/tool-capabilities/tool-principal';
import { MCP_ERROR_CODES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { assertRecord, requireScope, textResult } from './tool-params';
import { McpTool, McpToolError, McpToolResult } from './tool.interface';

/**
 * `McpCapabilityAdapter` — traduz `Capability` (neutra) -> `McpTool` (MCP).
 *
 * ESQUELETO da Onda 0.3: escrito e testado, mas **AINDA NAO plugado** no
 * `McpRouterService`. O router continua servindo suas 24 tools atuais pelo
 * caminho antigo — o golden test prova que o wire nao mudou. As Ondas 1..6
 * plugam este adapter, uma capability por vez.
 *
 * Responsabilidades do adapter (o que e de TRANSPORTE, nao de capability):
 *  - Constroi um `ToolPrincipal` MCP a partir do `McpUserContext` (scopes da
 *    chave = fonte de `can()`).
 *  - Aplica `requiredScopes` via `requireScope` (mesmo helper das tools legadas
 *    — envelope FORBIDDEN -32002 identico).
 *  - Embrulha `CapabilityResult.data` em `textResult(...)` (envelope MCP padrao).
 *  - Traduz `CapabilityError` -> `McpToolError` (codigo JSON-RPC).
 *
 * Escrito uma vez e congelado (ADR-V2-079): a paridade do wire e garantida por
 * este mapeamento estavel + golden test.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 0.3
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 */
@Injectable()
export class McpCapabilityAdapter {
  constructor(private readonly registry: CapabilityRegistry) {}

  /**
   * Constroi a lista de `McpTool` a partir das capabilities do registry.
   * Na Onda 0 o registry esta vazio => lista vazia (adapter nao plugado).
   */
  buildAll(): McpTool[] {
    return this.registry.list().map((capability) => this.toMcpTool(capability));
  }

  /**
   * Busca UMA capability pelo nome canonico no registry subjacente.
   *
   * Usado pelo `McpRouterService` (Onda 1+) para decidir, tool a tool, se o
   * wire deve ser servido pelo adapter (capability registrada) ou pelo
   * wrapper `*.tool.ts` legado (capability ainda nao migrada).
   *
   * @param name - Nome canonico snake_case (ex: 'create_task').
   * @returns A `Capability`, ou `undefined` se nao registrada.
   */
  getCapability(name: string): Capability | undefined {
    return this.registry.get(name);
  }

  /**
   * Traduz UMA capability neutra em um `McpTool` bem-formado.
   *
   * @param capability - Capability neutra da camada unica.
   * @returns `McpTool` com `name`/`description`/`inputSchema` identicos e um
   *   `handler` que aplica scope, executa a capability e embrulha o resultado.
   */
  toMcpTool(capability: Capability): McpTool {
    return {
      name: capability.name,
      description: capability.description,
      inputSchema: capability.inputSchema,
      handler: (params: unknown, ctx: McpUserContext): Promise<McpToolResult> =>
        this.dispatch(capability, params, ctx),
    };
  }

  private async dispatch(
    capability: Capability,
    params: unknown,
    ctx: McpUserContext,
  ): Promise<McpToolResult> {
    // Gate de scope na CAMADA DE ADAPTER (transporte). Fonte = scopes da chave.
    for (const scope of capability.requiredScopes) {
      requireScope(ctx, scope);
    }

    const input = assertRecord(params);
    const principal: ToolPrincipal = fromMcp({
      actorEntidadeId: ctx.dEntidadeId,
      scopes: ctx.scopes,
    });

    try {
      const result = await capability.run(input, principal);
      return textResult(result.data);
    } catch (error) {
      throw this.translateError(error);
    }
  }

  /**
   * Traduz um erro neutro para o dialeto do MCP. `CapabilityError` vira
   * `McpToolError` com o codigo JSON-RPC correspondente; qualquer outro erro
   * (incl. `HttpException` de services legados, ex: `NotFoundException`) e
   * repassado inalterado para o `McpRouterService` tratar como hoje.
   */
  private translateError(error: unknown): unknown {
    if (error instanceof CapabilityError) {
      return new McpToolError(this.mapErrorCode(error.code), error.message, error.data);
    }
    // Nao-CapabilityError: preserva o comportamento atual do router (ex:
    // NotFoundException propagada tal como as tools legadas fazem).
    return error;
  }

  private mapErrorCode(code: CapabilityError['code']): number {
    switch (code) {
      case 'NOT_FOUND':
        return MCP_ERROR_CODES.METHOD_NOT_FOUND;
      case 'FORBIDDEN':
        return MCP_ERROR_CODES.FORBIDDEN;
      case 'INVALID_INPUT':
        return MCP_ERROR_CODES.INVALID_PARAMS;
      case 'INTERNAL':
      default:
        return MCP_ERROR_CODES.INVALID_REQUEST;
    }
  }
}
