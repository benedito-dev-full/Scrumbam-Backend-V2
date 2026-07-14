---
name: unificacao-nexus-mcp-onda4
description: Onda 4 (ADR-V2-079) — 9 writes so-MCP viram Capabilities neutras (exceto execute_task); wiring module+router+specs; golden intacto
metadata:
  type: project
---

# Unificação Nexus↔MCP Onda 4 (9 writes só-MCP)

Concluída 2026-07-12. Finalizei os 5 writes restantes + wiring das 9 capabilities.

**Why:** ADR-V2-079 — camada única de tools de IA (Capability neutra + 2 adapters MCP/Nexus). Onda 4 migra os 9 writes só-MCP (update_task, update_status, update_timer, delete_task, create_project, update_project, create_block, create_from_template, update_notification). `execute_task` fica FORA (Pilar 1 — DPedido -300..-303).

**How to apply:** ao migrar uma tool legada `src/mcp/tools/<n>.tool.ts` para Capability:
- Casca fina em `src/common/tool-capabilities/capabilities/<dominio>/<n>.capability.ts`. Espelha inputSchema/description BYTE-A-BYTE com `tools.schema.json` (validar com spec importando o JSON e `toEqual`).
- Scope gate NÃO vai no corpo — declara via `requiredScopes` (adapter aplica). MCP_SCOPES literais: `tasks:write`, `projects:write`, `notifications:write`.
- `actorEntidadeId` SEMPRE de `principal.actorEntidadeId` (nunca de input). Legado usa `ctx.dEntidadeId`.
- Traduzir: `McpToolError(INVALID_PARAMS)`→`CapabilityError('INVALID_INPUT')`; `FORBIDDEN`→`CapabilityError('FORBIDDEN')`. NotFoundException/BadRequestException/ForbiddenException de services PROPAGAM unchanged (não embrulhar).
- Ordem de validação idêntica ao legado (ex: create_project valida `nome` min-length ANTES de `color` — meu teste inicial errou usando nome='X').

**Wiring (3 pontos):**
1. `tool-capabilities.module.ts`: import + providers + constructor param + `registerIfAbsent` em `onModuleInit`. As 4 pré-escritas (update-task/status/timer, create-block) NÃO estavam registradas — registrei as 9.
2. `mcp-router.service.ts`: trocar entrada legada crua por `resolveToolWithFallback('<name>', legacyTool, capabilityAdapter)`. Legacy fica como fallback (removido só na Onda 5).
3. Schema: NÃO tocar `tools.schema.json` nem o golden baseline.

**Golden test intacto:** `tools/list` do router lê o JSON estático (`cachedToolDefinitions`), independente das tools resolvidas → golden não muda. `tools/call` representativo instancia router com tools legadas e SEM adapter → cai no fallback.

**Bidirecionalidade:** `NexusCapabilityAdapter.buildAll` itera TODO o registry → as 9 agora aparecem no Nexus também. `tool-registry.spec.ts` usa `arrayContaining` + registry próprio manual (não o módulo) → não quebra.

**Arquivos criados (5 caps + 5 specs):**
- tasks/delete-task.capability.ts, projects/create-project.capability.ts, projects/update-project.capability.ts, blocks/create-from-template.capability.ts, notifications/update-notification.capability.ts (+ subfolder notifications/)

**GOTCHA — mcp-block-d.spec.ts "timeout em tools/call"**: PRÉ-EXISTENTE flaky (fake-timers, `advanceTimersByTime(5)` não resolve a tempo). Falha COM meu router stashed também. Não é regressão — não perder tempo nisso.

**Verificação:** `npx jest "tool-capabilities" "mcp-capability.adapter" "mcp-wire.golden"` = 26 suites/154 tests green. `npm run build` exit 0 (`make` indisponível no Windows). `tsc --noEmit` limpo em não-test (erros de tsc são só specs desatualizados de outros módulos — TaskResponseDto ganhou hasChildren/timeSpentIsRollup).
