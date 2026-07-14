---
name: mcp-streamable-http-f5-conformance-adr
description: F5 (última) da Reforma Streamable HTTP — suíte de conformidade + regressão do cliente legado + ADR-V2-071 (NÃO 069); só testes/doc, zero lógica
metadata:
  type: project
---

# MCP F5 — Conformidade + ADR (plano `plan-mcp-streamable-http-transport-task1.md`)

Última fase da Reforma 1. **Só ADICIONA testes + ADR + corrige refs de comentário**. Zero mudança de lógica de produção. Ver [[mcp-streamable-http-f2-accept-202]] e [[mcp-origin-guard-f4]] para as fases anteriores.

**CORREÇÃO DE NUMERAÇÃO CRÍTICA:** plano dizia "ADR-V2-069", mas 069 (`ADR-V2-069-mcp-camada-a-visibilidade-admin.md`) e 070 (`ADR-V2-070-mcp-create-project-extends-projects-write.md`) JÁ EXISTEM. Usei **ADR-V2-071**. Antes de criar qualquer ADR, `ls docs/decisions/ | grep <num>` — a numeração no plano pode estar defasada.

**Refs de comentário corrigidas 069→071** (comment-only, zero lógica): `mcp-origin.guard.ts` (1 `@see`), `mcp.controller.ts` (2 `@see` em methodNotAllowedGet/Delete + 1 inline "sem sessão — ADR-V2-069"), `constants.ts` (3 `@see` em MCP_SUPPORTED_PROTOCOL_VERSIONS/HTTP_STATUS_OK/MCP_ALLOWED_ORIGINS_ENV), spec F1 comment. **NÃO tocar** `create-from-template.tool.ts`/`create-project.tool.ts` (esses ADR-V2-069/070 são a Camada-A admin, corretos). `sed -i` no Bash tool funciona p/ os comentários em massa.

**GOTCHA DEFAULT protocolVersion:** o plano diz "default = 2025-03-26 (mais alta)". FALSO no código: `negotiateProtocolVersion` devolve `MCP_PROTOCOL_VERSION` = **`2024-11-05`** para ausente/desconhecida (preserva Claude Code). Meu teste falhou por assumir o plano; corrigi p/ assertar `MCP_PROTOCOL_VERSION`. Allow-list = `['2025-03-26','2024-11-05']` (só ecoa se pedido exato).

**Suíte nova:** `src/mcp/__tests__/mcp-conformance.controller.spec.ts` (15 testes). Regressão nomeada do cliente legado = handshake `initialize`(2024-11-05)→`tools/list`→`tools/call`(list_tasks) via controller real. Setup COPIADO de `mcp-accept-202.controller.spec.ts` (McpController + McpJsonRpcService + McpRouterService reais; tools mockadas com services fake; sem rateLimit/audit — construtor com 2 args). Matriz reusa metadata-reflection de `mcp-method-not-allowed` (HTTP_CODE_METADATA/HEADERS_METADATA/GUARDS_METADATA) p/ 405, e o padrão de `mcp-origin.guard.spec` (contextFor/configFor) p/ Origin. `tools/call` chama `tool.handler(params?.arguments, userCtx)` — arguments={} basta p/ list_tasks.

**NET-ZERO (baseline→final):** `npx jest src/mcp --silent | grep -E "Tests:|Test Suites:"`. Baseline: 4 suites failed / 36 passed (40), 3 tests failed / 364 passed (367). Final: 4 failed / 37 passed (41), 3 failed / 379 passed (382). Delta falhas = 0 (+1 suite minha, +15 testes meus). tsc `src/mcp` = 3 erros TS2352 pré-existentes (execute-task.integration x2, update-timer.integration x1) — nenhum meu. 4 suites de débito INTOCADAS: `execute-task.integration`, `mcp-block-d`, `update-timer.integration`, `update-timer.tool`.
