/**
 * Erro neutro da camada de Capabilities (fonte unica de tools de IA).
 *
 * `CapabilityError` e agnostico a transporte: NAO conhece codigos JSON-RPC do
 * MCP nem `HttpException` do NestJS. Cada adapter fino (MCP / Nexus) traduz
 * este erro para o dialeto da sua superficie:
 *  - MCP: `CapabilityError` -> `McpToolError` (codigo JSON-RPC).
 *  - Nexus: `CapabilityError` -> `Error` humanizado devolvido ao modelo.
 *
 * A capability lanca `CapabilityError` com um `code` semantico; a traducao
 * para o wire e responsabilidade EXCLUSIVA do adapter (invariante de design —
 * a capability nunca fala o protocolo).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 0.2
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 */

/**
 * Codigos semanticos de erro de capability. Deliberadamente pequeno e neutro
 * — cada adapter mapeia para o seu dialeto:
 *  - `NOT_FOUND`     -> MCP METHOD_NOT_FOUND/dominio; Nexus NotFound.
 *  - `FORBIDDEN`     -> MCP FORBIDDEN (-32002); Nexus erro de permissao.
 *  - `INVALID_INPUT` -> MCP INVALID_PARAMS (-32602); Nexus erro de argumento.
 *  - `INTERNAL`      -> fallback (500-equivalente) — nunca vaza stack ao modelo.
 */
export type CapabilityErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_INPUT' | 'INTERNAL';

/**
 * Erro canonico emitido por capabilities e adapters da camada neutra.
 *
 * @example
 * ```typescript
 * throw new CapabilityError('FORBIDDEN', 'missing scope', { requiredScope: 'tasks:write' });
 * ```
 */
export class CapabilityError extends Error {
  /**
   * @param code    - Codigo semantico neutro (ver {@link CapabilityErrorCode}).
   * @param message - Mensagem legivel (NAO deve vazar detalhes sensiveis).
   * @param data    - Payload estruturado opcional para diagnostico do cliente
   *   (ex: `{ requiredScope }`, `{ field, issue }`). Repassado pelos adapters.
   */
  constructor(
    public readonly code: CapabilityErrorCode,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'CapabilityError';
    // Preserva a cadeia de prototipo ao transpilar para ES5/ES2015.
    Object.setPrototypeOf(this, CapabilityError.prototype);
  }
}
