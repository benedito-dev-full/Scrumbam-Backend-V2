/**
 * Contexto extraido do JWT do request HTTP original e propagado a cada
 * `execute()` de tool.
 *
 * A IA NUNCA escolhe quem é o user — `userEntidadeId` e `organizationId` vêm
 * sempre do auth do request original (tenant isolation natural via services).
 *
 * Reaproveitado por todas as 4 tools v1.
 */
export interface AiToolContext {
  /** `DEntidade.chave` do user logado (autor das chamadas). */
  readonly userEntidadeId: bigint;
  /** Org ativa (vinda do JWT). Opcional — alguns flows nao tem (MCP legacy). */
  readonly organizationId?: string;
}
