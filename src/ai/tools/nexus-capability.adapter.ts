import { Injectable } from '@nestjs/common';

import { Capability } from '../../common/tool-capabilities/capability.interface';
import { CapabilityError } from '../../common/tool-capabilities/capability-error';
import { CapabilityRegistry } from '../../common/tool-capabilities/capability-registry';
import { fromNexus, ToolPrincipal } from '../../common/tool-capabilities/tool-principal';
import { AiToolDefinition } from '../providers/ai-provider.interface';
import { AiToolContext } from './tool-context';

/**
 * Mapa RBAC -> scopes para a superficie Nexus.
 *
 * Recebe o contexto do request (user logado + org) e devolve o CONJUNTO de
 * scopes efetivos que o usuario detem, ja derivado do RBAC (DVincula -160..-179).
 * DEFAULT RESTRITIVO: o que este mapa nao conceder e negado por
 * {@link fromNexus} (fail-closed).
 *
 * Na Onda 0 (esqueleto) o mapa e injetado; ele amadurece de 0.2 -> 1 -> 4
 * conforme as writes so-MCP passam a exigir `principal.can(scope)` no chat.
 */
export type NexusScopeResolver = (ctx: AiToolContext) => Promise<readonly string[]>;

/**
 * `NexusCapabilityAdapter` — traduz `Capability` (neutra) -> `AiToolDefinition`
 * (Nexus / function calling).
 *
 * ESQUELETO da Onda 0.3: escrito e testado, mas **AINDA NAO plugado** no
 * `ToolRegistry.buildAll(ctx)`. O Nexus continua servindo suas 4 tools atuais
 * pelo caminho antigo. As Ondas 1..6 plugam este adapter, uma capability por vez.
 *
 * Responsabilidades do adapter (o que e de TRANSPORTE/superficie):
 *  - Constroi um `ToolPrincipal` Nexus a partir do JWT (closure do `ctx`),
 *    resolvendo os scopes efetivos via {@link NexusScopeResolver} (RBAC).
 *    `actorEntidadeId` vem SEMPRE do JWT — a IA nunca o escolhe (ADR-V2-042).
 *  - Aplica `requiredScopes` via `principal.can()` (default nega).
 *  - Repassa `CapabilityResult.data` como `unknown` ao loop de tool calling.
 *  - Traduz `CapabilityError` -> `Error` humanizado devolvido ao modelo.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 0.3
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class NexusCapabilityAdapter {
  constructor(private readonly registry: CapabilityRegistry) {}

  /**
   * Constroi a lista de `AiToolDefinition` para o contexto do request, a partir
   * das capabilities do registry. Na Onda 0 o registry esta vazio => lista
   * vazia (adapter nao plugado).
   *
   * @param ctx           - Contexto do request (JWT: userEntidadeId + org).
   * @param scopeResolver - Resolve os scopes efetivos do RBAC (default nega).
   */
  buildAll(ctx: AiToolContext, scopeResolver: NexusScopeResolver): AiToolDefinition[] {
    return this.registry.list().map((capability) =>
      this.toAiToolDefinition(capability, ctx, scopeResolver),
    );
  }

  /**
   * Traduz UMA capability neutra em um `AiToolDefinition` bem-formado.
   *
   * O `execute` fica preso na closure do `ctx` (mesma disciplina das tools
   * legadas do Nexus): a IA passa apenas `args`, nunca a identidade do ator.
   *
   * @param capability    - Capability neutra da camada unica.
   * @param ctx           - Contexto do request (JWT).
   * @param scopeResolver - Resolve os scopes efetivos do RBAC.
   * @returns `AiToolDefinition` com `name`/`description`/`parameters` mapeados.
   */
  toAiToolDefinition(
    capability: Capability,
    ctx: AiToolContext,
    scopeResolver: NexusScopeResolver,
  ): AiToolDefinition {
    return {
      name: capability.name,
      description: capability.description,
      parameters: capability.inputSchema,
      execute: async (args: Record<string, unknown>): Promise<unknown> => {
        const grantedScopes = await scopeResolver(ctx);
        const principal: ToolPrincipal = fromNexus({
          actorEntidadeId: ctx.userEntidadeId,
          grantedScopes,
          ...(ctx.organizationId ? { organizationId: BigInt(ctx.organizationId) } : {}),
        });

        // Gate de scope (default nega) — RBAC do user logado.
        for (const scope of capability.requiredScopes) {
          if (!principal.can(scope)) {
            throw new Error(
              `Permissao negada: esta acao requer o scope "${scope}", que seu usuario nao possui.`,
            );
          }
        }

        try {
          const result = await capability.run(args, principal);
          return result.data;
        } catch (error) {
          throw this.translateError(error);
        }
      },
    };
  }

  /**
   * Traduz um erro neutro para o Nexus. `CapabilityError` vira um `Error`
   * humanizado (mensagem apresentavel ao modelo); qualquer outro erro e
   * repassado inalterado para o orquestrador (`AiChatService`) tratar como hoje.
   */
  private translateError(error: unknown): unknown {
    if (error instanceof CapabilityError) {
      return new Error(error.message);
    }
    return error;
  }
}
