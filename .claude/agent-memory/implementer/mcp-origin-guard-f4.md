---
name: mcp-origin-guard-f4
description: F4 MCP Streamable HTTP — McpOriginGuard anti DNS-rebinding, aditivo e tolerante ao Claude Code
metadata:
  type: project
---

# MCP Streamable HTTP F4 — McpOriginGuard (ADR-V2-069, 2026-07-04)

Guard `src/mcp/guards/mcp-origin.guard.ts` valida header `Origin` no `@Post() /mcp`.
Regras: Origin AUSENTE → SEMPRE permite (Claude Code / não-browser é o caso bloqueante);
presente+allow-list → permite; presente+fora → `ForbiddenException` (HARD 403, NÃO soft-fail
como McpKeyGuard); allow-list vazia/ausente → fail-open + `logger.warn`. NUNCA inspeciona X-MCP-Key.

- Env: constante `MCP_ALLOWED_ORIGINS_ENV = 'MCP_ALLOWED_ORIGINS'` (CSV) em `constants.ts`.
  parseAllowList faz split(',')+trim+filter(len>0) → `[]` sinaliza fail-open.
- Ordem no `@UseGuards`: `McpEnabledGuard, McpOriginGuard, McpKeyGuard` (origin ANTES de key, barra cedo).
  NÃO aplicado aos handlers 405 (methodNotAllowedGet/Delete — continuam sem guards).
- Registrado no `providers` do `mcp.module.ts`.

**Why:** spec MCP 2025-03-26 exige validar Origin só quando PRESENTE (anti DNS-rebinding).
**How to apply:** ao mexer em guards do POST /mcp, lembrar que a ordem importa e Origin ausente
= sempre passa (não travar Claude Code).

## GOTCHA regressão F3
`mcp-method-not-allowed.controller.spec.ts` tinha `guardsOf('handle').toHaveLength(2)` hardcoded.
Adicionar 3º guard quebra esse assert — é teste que MINHA mudança invalida intencionalmente (não é
debt a ignorar). Atualizei p/ length 3 + arrayContaining os 3 nomes + novo teste de ordering
(indexOf McpOriginGuard < indexOf McpKeyGuard).

## NET-ZERO
Baseline e final idênticos: 4 suites / 3 tests failed (debt pré-existente: update-timer.tool,
mcp-block-d, update-timer.integration + execute-task.integration — as 2 integration falham em tsc
TS2352 pré-existente). 6 testes novos no origin.guard.spec + 1 assert de ordering. tsc: 3 erros
pré-existentes, zero novos.
