---
name: mcp-streamable-http-f2-accept-202
description: F2 da Reforma Streamable HTTP — POST notifications-only responde 202 sem corpo via @Res passthrough; request com id mantém 200+JSON
metadata:
  type: project
---

# MCP F2 — Accept + 202 Accepted (plano `plan-mcp-streamable-http-transport-task1.md`)

Fase de MAIOR risco da reforma (mexe no corpo do POST `/mcp`). ADR-V2-069 (proposto). Aditivo/stateless.

**Regra:** body só com notifications/responses (zero requests) → HTTP 202 sem corpo. Body com ≥1 request (item com `method` E `id`) → 200 + JSON (inalterado, Claude Code intacto). Erro/rate-limit/body-inválido NUNCA viram 202.

**Escolha de implementação:** `@Res({ passthrough: true }) res?: Response` (do express), NÃO interceptor. Motivo: decisão de status é local a `handle()` (depende do result já computado + classificação do input); interceptor teria de re-parsear o body. `passthrough:true` preserva serialização do Nest nos casos 200; só chamo `res.status(202)` no caminho notifications-only. `res` é OPCIONAL (`res?`) → back-compat: specs antigos que chamam `handle(body, req)` com 2 args continuam retornando `null` sem tocar status.

**Como 202 é decidido:** `containsRequest = bodyContainsRequest(body)` (helper novo: `itemIsRequest` = objeto com `typeof method==='string' && id!==undefined`; batch usa `.some`). Eleva a 202 SÓ quando `result===null && !containsRequest && res`. Dupla checagem (result null E zero requests) blinda: em batch misto `containsRequest` é true → 200.

**Audit httpCode (era hardcoded 200):** parametrizei `scheduleAudit(...,httpCode)`. Computo `httpCode = containsRequest ? 200 : 202` em `handle()` e passo por `handleSingle`/`handleBatch`. Branch de request-com-id sempre audita `HTTP_STATUS_OK` (erro JSON-RPC ainda é 200); branch noResponse/sem-id audita o `httpCode` agregado (202 se body só-notifications, 200 se batch misto). Rate-limit audita `HTTP_STATUS_OK`. Constantes novas em `constants.ts`: `HTTP_STATUS_OK=200`, `HTTP_STATUS_ACCEPTED=202`.

**Spec novo:** `src/mcp/__tests__/mcp-accept-202.controller.spec.ts` (7 testes, cobre 5 DoD). Controller instanciado direto (padrão de `mcp-router-envelope.controller.spec.ts`), NÃO via Nest TestingModule. Mock de `Response`: `{ status: jest.fn().mockReturnValue(res) }`. Audit mockado como 4º arg do construtor (`{ record: jest.fn() }`), 3º arg (rateLimit) = `undefined`.

**GOTCHA fake timers p/ audit:** `scheduleAudit` usa `setImmediate`. Para verificar httpCode do audit: `jest.useFakeTimers()` → chamar handle → `jest.runAllTimers()` + `await Promise.resolve()` → assert. Modern fake timers do jest fakeiam `setImmediate`. Sem isso o audit não roda dentro do teste.

**Baseline net-zero (capturado antes):** tsc = 41 erros (todos em `__tests__`, intactos). Suite `src/mcp` = 4 suites failed / 33 passed, 3 tests failed / 345 passed. Suites pré-quebradas (débito, NÃO consertar): `update-timer.tool`, `mcp-block-d`, `update-timer.integration`, `execute-task.integration`. Depois: tsc 41, suite 4 failed/34 passed, 3 failed/352 passed (+7 meus, +1 suite). Delta falhas = 0.

**Build/gate no Win:** `npx tsc --noEmit` (não `make`), `npx eslint <arquivos>`, `npx jest src/mcp`. F1 (protocolVersion) já mergeada antes.
