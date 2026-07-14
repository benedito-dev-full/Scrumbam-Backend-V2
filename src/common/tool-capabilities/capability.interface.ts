import { ToolPrincipal } from './tool-principal';

/**
 * `Capability` — a fonte UNICA de uma tool de IA (Onda 0.2).
 *
 * Uma capability descreve uma capacidade de dominio (ex: `create_task`) de
 * forma AGNOSTICA a transporte. Dois adapters finos a traduzem:
 *  - `McpCapabilityAdapter`   : Capability -> `McpTool` (envelope JSON-RPC).
 *  - `NexusCapabilityAdapter` : Capability -> `AiToolDefinition` (function calling).
 *
 * A capability:
 *  - NAO conhece JSON-RPC, rate-limit, nem `HttpException` (isso e transporte,
 *    fica no adapter — invariante de design, Risco MEDIO do plano).
 *  - Delega a logica de dominio ao service correspondente (`TasksService` etc.).
 *    NUNCA fala com Prisma direto em tabela transacional; capabilities que
 *    terminam em DPedido -300..-303 (ex: `execute_task`) chamam o
 *    `ExecutionsService`/`OperacaoExecucaoClaude` (Pilar 1 preservado).
 *  - Recebe o `ToolPrincipal` (quem age + o que pode) e aplica `requiredScopes`
 *    de forma neutra (`principal.can(scope)`); a FONTE do `can()` varia por
 *    superficie (scopes da chave no MCP; RBAC no Nexus).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 0.2
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 */
export interface Capability {
  /** Nome canonico em snake_case (ex: 'create_task'). Unico no registry. */
  readonly name: string;
  /** Descricao exposta ao modelo (identica nos dois adapters). */
  readonly description: string;
  /** JSON Schema (Draft-07) dos argumentos de entrada. */
  readonly inputSchema: Record<string, unknown>;
  /**
   * Scopes exigidos para executar. `[]` = sem gate. No MCP a fonte e a chave;
   * no Nexus e o RBAC (default nega). Os adapters aplicam via `principal.can()`.
   */
  readonly requiredScopes: readonly string[];
  /**
   * Executa a capacidade de dominio. Recebe o input ja parseado e o principal
   * neutro. Devolve um {@link CapabilityResult} (objeto neutro); cada adapter
   * embrulha `data` no envelope da sua superficie.
   *
   * @throws {import('./capability-error').CapabilityError} Erro neutro (NOT_FOUND
   *   / FORBIDDEN / INVALID_INPUT / INTERNAL) — traduzido pelo adapter.
   */
  run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult>;
}

/**
 * Resultado neutro de uma capability. `data` e um objeto de dominio agnostico:
 *  - MCP embrulha em `textResult(data)` (`{ content: [{ type:'text', text }] }`).
 *  - Nexus repassa `data` como `unknown` ao loop de tool calling.
 */
export interface CapabilityResult {
  readonly data: unknown;
}
