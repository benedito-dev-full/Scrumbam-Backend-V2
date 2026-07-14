/**
 * `ToolPrincipal` — quem age e o que pode, de forma NEUTRA por superficie.
 *
 * Abstrai a diferenca de auth entre as duas cascas de IA (Onda 0.2):
 *  - **MCP**: a autoridade vem dos SCOPES da chave (DTabela -472). `can(scope)`
 *    e simples pertencimento ao array de scopes da key.
 *  - **Nexus**: a autoridade vem do RBAC do usuario logado (DVincula -160..-179).
 *    `can(scope)` deriva de um mapa RBAC->scopes com DEFAULT RESTRITIVO
 *    (nega se o scope nao estiver explicitamente concedido).
 *
 * Invariantes de seguranca:
 *  - `actorEntidadeId` SEMPRE vem do auth (JWT ou chave), NUNCA de input da IA
 *    (ADR-V2-042 — tenant isolation defense-in-depth). O service continua sendo
 *    a ultima linha de isolamento; o principal nunca o substitui.
 *  - No Nexus, scope nao mapeado => negado (fail-closed).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 0.2
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */

/** Superficie de IA que originou a chamada. */
export type ToolSurface = 'mcp' | 'nexus';

/**
 * Contrato neutro do ator de uma chamada de capability.
 *
 * `can()` e polimorfico por superficie (ver factories abaixo). O resto e
 * identidade de tenant, usada pelos services para isolamento.
 */
export interface ToolPrincipal {
  /** `DEntidade.chave` do ator — SEMPRE do auth, nunca de input da IA. */
  readonly actorEntidadeId: bigint;
  /** Org ativa do request (DEntidade -152). Opcional (alguns flows nao tem). */
  readonly organizationId?: bigint;
  /** Superficie que originou a chamada (para audit / decisoes de adapter). */
  readonly surface: ToolSurface;
  /**
   * Autorizacao polimorfica: `true` se o ator pode exercer `scope` NESTA
   * superficie. MCP consulta scopes da chave; Nexus deriva do RBAC (default nega).
   */
  can(scope: string): boolean;
}

/**
 * Constroi um `ToolPrincipal` para a superficie **MCP**.
 *
 * A autoridade e o conjunto de scopes concedido a chave (DTabela -472). `can()`
 * e pertencimento direto; sem scope na lista => negado.
 *
 * @param params.actorEntidadeId - `DEntidade.chave` resolvida pela MCP key.
 * @param params.scopes          - Scopes concedidos a chave (ex: ['tasks:read']).
 * @param params.organizationId  - Org ativa opcional.
 * @returns Principal MCP com `surface='mcp'`.
 */
export function fromMcp(params: {
  actorEntidadeId: bigint;
  scopes: readonly string[];
  organizationId?: bigint;
}): ToolPrincipal {
  const grantedScopes = new Set(Array.isArray(params.scopes) ? params.scopes : []);

  return {
    actorEntidadeId: params.actorEntidadeId,
    ...(params.organizationId !== undefined ? { organizationId: params.organizationId } : {}),
    surface: 'mcp',
    can: (scope: string): boolean => grantedScopes.has(scope),
  };
}

/**
 * Constroi um `ToolPrincipal` para a superficie **Nexus** (chat embutido).
 *
 * A autoridade e derivada do RBAC do usuario logado. Neste esqueleto (Onda 0),
 * o mapeamento RBAC->scopes e injetado como o CONJUNTO de scopes efetivos que o
 * usuario detem (`grantedScopes`), ja resolvido a partir do RBAC pelo chamador
 * (o `NexusCapabilityAdapter`, a maturecer nas Ondas 1/4). O `can()` aplica
 * DEFAULT RESTRITIVO: qualquer scope fora do conjunto e negado.
 *
 * O contrato e desenhado para NAO confiar em input da IA: `actorEntidadeId` vem
 * do JWT (closure do `ToolRegistry.buildAll(ctx)`), nunca de argumentos da tool.
 *
 * @param params.actorEntidadeId - `DEntidade.chave` do user logado (do JWT).
 * @param params.grantedScopes   - Scopes efetivos derivados do RBAC (default
 *   restritivo: o que nao esta aqui e negado).
 * @param params.organizationId  - Org ativa opcional (do JWT).
 * @returns Principal Nexus com `surface='nexus'`.
 */
export function fromNexus(params: {
  actorEntidadeId: bigint;
  grantedScopes: readonly string[];
  organizationId?: bigint;
}): ToolPrincipal {
  // Default restritivo: apenas os scopes explicitamente concedidos passam.
  const grantedScopes = new Set(Array.isArray(params.grantedScopes) ? params.grantedScopes : []);

  return {
    actorEntidadeId: params.actorEntidadeId,
    ...(params.organizationId !== undefined ? { organizationId: params.organizationId } : {}),
    surface: 'nexus',
    can: (scope: string): boolean => grantedScopes.has(scope),
  };
}
