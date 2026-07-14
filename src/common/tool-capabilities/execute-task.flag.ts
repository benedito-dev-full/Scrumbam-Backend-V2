/**
 * Feature-flag da Onda 6 (ADR-V2-079) — habilita `execute_task` no Nexus.
 * **Default OFF.**
 *
 * Mora em arquivo PROPRIO (sem dependencias do Nest) para poder ser lido tanto
 * pelo `ToolCapabilitiesModule` (registro condicional da capability) quanto pelo
 * `capability-parity.manifest.ts` (isencao condicional) SEM criar ciclo de
 * import entre modulo <-> manifesto.
 *
 * Lida via `process.env` no MESMO padrao ja usado no projeto (ex:
 * `ENABLE_USER_LEVEL_KEYS` em `src/ai/ai-key-resolver.service.ts`). Avaliada uma
 * vez no load do modulo: um checkout limpo, sem override, NAO expoe
 * `execute_task` no chat.
 *
 * Ligar exige set explicito `NEXUS_EXECUTE_TASK_ENABLED=true` no ambiente. Mesmo
 * ligada, o disparo pelo chat ainda passa por `executions:create` (RBAC, default
 * nega) + confirmacao explicita (`confirm=true`) na capability.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 6
 * @see ADR-V2-079, ADR-V2-066/067 (scope executions:create + async fire-and-poll)
 */
export const NEXUS_EXECUTE_TASK_ENABLED = process.env.NEXUS_EXECUTE_TASK_ENABLED === 'true';
