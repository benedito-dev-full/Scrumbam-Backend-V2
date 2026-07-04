# ADR-V2-071: MCP — Transporte Streamable HTTP (aditivo, stateless, JSON-only)

**Status:** Proposto
**Data:** 2026-07-04
**Decisores:** Strategist Agent V2 + Implementer Agent V2 + CEO (a ratificar)
**Tags:** #V2 #fase-F11 #mcp #transport #streamable-http #back-compat

---

## Contexto e Problema

O endpoint `POST /mcp` do V2 servia exclusivamente o transporte legado: JSON-RPC
2.0 sobre HTTP, cliente Claude Code autenticando via header `X-MCP-Key` e
esperando sempre `application/json`. Esse transporte **não é reconhecido pelo
Claude WEB**, que fala o transporte **Streamable HTTP** moderno (spec MCP
`2025-03-26`): negocia `protocolVersion`, honra `Accept`, responde `202` para
payloads sem request, e usa `GET`/`DELETE` no mesmo path para stream/sessão.

O objetivo desta reforma (F11, "Reforma 1") foi **habilitar o Claude WEB a
conectar** ao mesmo `/mcp` **sem quebrar o Claude Code atual** — a restrição
não-negociável. A dificuldade central: evoluir o transporte de forma que
qualquer request com `id` continue `200 + JSON` (o caminho do Claude Code),
enquanto o servidor passa a honrar as convenções do transporte novo.

### Estado antes da reforma

- `POST /mcp`: único método, `@HttpCode(200)`, sempre `application/json`.
- `initialize`: devolvia `protocolVersion` **hardcodado** (`2024-11-05`), sem ecoar
  a versão pedida.
- Guards (`McpEnabledGuard`, `McpKeyGuard`) fazem **soft-fail** (stash
  `request.mcpAuthError`, retornam `true`); erro de auth vira JSON-RPC error com
  HTTP 200. Padrão do módulo, preservado.
- `GET`/`DELETE` em `/mcp`: 404 (rota inexistente).
- Sem validação de `Origin`.

---

## Alternativas Consideradas

### Opção A — Sessão stateful mínima com `Mcp-Session-Id` (Redis)

Emitir `Mcp-Session-Id` no `initialize`, exigir/validar em requests subsequentes,
com store Redis + TTL + invalidação.

**Prós:** aderência máxima à spec; porta aberta para server-push futuro.

**Contras:** exige store + expiração + validação em toda request + tratamento de
404/400 de sessão inválida; superfície de regressão real sobre o Claude Code;
nada disso é requisito para o Claude WEB conectar (que funciona perfeitamente
com servidor stateless respondendo `application/json`). O rate-limit e o audit
já são keyed por `keyHash` (identidade da chave), não por sessão.

**Rejeitada** — over-engineering para o objetivo atual. Registrada como
**evolução futura** caso surja necessidade de server-push.

### Opção B — Segundo endpoint `/mcp/stream` só para o transporte novo

Isolar o legado em `/mcp` e criar um path novo para Streamable HTTP.

**Prós:** isola totalmente o cliente legado.

**Contras:** viola o princípio "mesmo path" da spec Streamable HTTP (o cliente
espera **um único endpoint** que aceita POST/GET/DELETE); o Claude WEB não
descobriria um path alternativo; duplica guards/rate-limit/audit.

**Rejeitada.**

### Opção C — **Evoluir o único `/mcp` de forma aditiva e stateless (escolhida)**

Incrementos isolados sobre o mesmo endpoint, sem sessão, respondendo sempre
`application/json` no POST. Melhor relação custo/risco/objetivo.

**Adotada.**

---

## Decisão

O transporte **Streamable HTTP** (spec `2025-03-26`) foi adicionado ao `/mcp` de
forma **ADITIVA**, **STATELESS** (sem `Mcp-Session-Id`) e **JSON-only no POST**
(nunca abre SSE), com **back-compat total** do cliente legado X-MCP-Key.

A reforma foi entregue em 5 fases (F1–F5):

| Fase | Entrega |
|------|---------|
| **F1** | `initialize` **ecoa** a `protocolVersion` negociada (allow-list `['2025-03-26','2024-11-05']`); versão ausente/desconhecida → default do servidor `MCP_PROTOCOL_VERSION` (`2024-11-05`). Nunca ecoa string arbitrária. |
| **F2** | `Accept` + resposta **`202 Accepted` sem corpo** para body só-notifications/responses (nenhum item com `method` **e** `id`). Body com ≥1 request → `200 + JSON`. Elevação a 202 via `@Res({ passthrough: true })`; audit reflete o httpCode real. |
| **F3** | `GET /mcp` → **405** + `Allow: POST`; `DELETE /mcp` → **405** + `Allow: POST`. Sem guards de auth nesses handlers (405 é protocolo, não credencial). |
| **F4** | `McpOriginGuard` (anti DNS-rebinding): `Origin` ausente → **passa** (Claude Code); presente e na allow-list → passa; presente e fora → **403**; allow-list vazia → fail-open + `warn`. Ordem no POST: `McpEnabledGuard, McpOriginGuard, McpKeyGuard`. |
| **F5** | Suíte de conformidade + regressão do cliente legado + este ADR. |

### Garantias

1. **Back-compat bloqueante:** `initialize` com `protocolVersion:'2024-11-05'`
   ecoa `2024-11-05`; qualquer request com `id` continua `200 + JSON`; `Origin`
   ausente sempre passa. Handshake completo do Claude Code
   (`initialize → tools/list → tools/call`) idêntico ao baseline.
2. **Stateless:** nenhum estado de sessão é criado, armazenado ou validado.
3. **JSON-only no POST:** o servidor **nunca** abre SSE no POST — responde sempre
   `application/json`, conforme a spec (o cliente Streamable deve aceitar JSON).
4. **Ortogonalidade:** scopes (ADR-V2-068), rate limit (ADR-V2-011) e as tools
   ficam **intocados** — o transporte é uma camada HTTP/protocolo.

---

## Consequências

### Positivas

- **Claude WEB conecta** ao mesmo `/mcp` (negocia `2025-03-26`, honra 202/405/Origin).
- **Claude Code intacto** — teste de regressão nomeado prova o handshake completo.
- **Sem infraestrutura nova** — nada de Redis para sessão, nada de tabela/DClasse.
- **Zero mudança nas 3 dimensões do modelo** — sem tabela nova, sem DClasse nova,
  sem Engine, sem alterar scopes/rate-limit.

### Negativas / limitações aceitas

- **Sem server-push** (SSE via GET) nem retomada de stream — não são requisitos de
  F11. GET é 405.
- **Sem sessão** — clientes que dependessem de `Mcp-Session-Id` não são atendidos
  (nenhum cliente-alvo depende).

### Riscos residuais

- **R1 — Origin guard mal-configurado bloquear o Claude Code.** Mitigado: `Origin`
  ausente sempre passa; allow-list vazia → fail-open + warn; guard nunca inspeciona
  `X-MCP-Key`.
- **R2 — Elevar 202 num caminho com request.** Mitigado: definição estrita
  "request = tem `method` e `id`"; dupla checagem no controller; testado.

---

## Evolução futura (escopo explicitamente excluído)

- **Sessão stateful (`Mcp-Session-Id` + Redis):** reabrir SOMENTE se surgir
  necessidade de **server-push** ou retomada de stream (Opção A acima).
- **SSE no GET/POST:** idem — depende de requisito de push.
- **Extração de um `McpTransport` genérico para o template Devari-Core:**
  a negociação de `protocolVersion`, o padrão 202, o `GET/DELETE → 405` e o guard
  de `Origin` são genéricos de MCP e candidatos a promoção ao template
  (follow-up, não implementado aqui).

---

## Referências

- ADR-V2-011 — MCP Keys + rate limit Redis (ver `CLAUDE.md`, tabela de Regras de Ouro)
- [ADR-V2-068 — MCP scope catalog](./ADR-V2-068-mcp-scope-catalog.md)
- Plan: `workspace/plans/plan-mcp-streamable-http-transport-task1.md` (§5 fases F1–F5, §8 critérios de sucesso)
- Specs: `src/mcp/__tests__/mcp-router.protocol-version.spec.ts` (F1),
  `mcp-accept-202.controller.spec.ts` (F2),
  `mcp-method-not-allowed.controller.spec.ts` (F3),
  `mcp-origin.guard.spec.ts` (F4),
  `mcp-conformance.controller.spec.ts` (F5 — matriz + regressão do cliente legado)

---

> **Nota de numeração:** o plano original propunha "ADR-V2-069", mas esse número
> (e o 070) já foram atribuídos a outros temas MCP (visibilidade admin da Camada A
> e `create_project` estende `projects:write`). Esta decisão foi registrada como
> **ADR-V2-071**, e as referências `@see ADR-V2-069` no código de transporte
> (F1/F3/F4) foram corrigidas para `ADR-V2-071`.

---

**Redigido por:** Implementer Agent V2
**Aceito em:** _pendente CEO_
