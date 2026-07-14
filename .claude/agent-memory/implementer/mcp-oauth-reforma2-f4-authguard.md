---
name: mcp-oauth-reforma2-f4-authguard
description: F4 McpAuthGuard dual-auth (Bearer OU X-MCP-Key) + 401/WWW-Authenticate atrás de MCP_OAUTH_ENABLED; delega ao McpKeyGuard; risco nº1 = regressão Claude Code
metadata:
  type: project
---

# MCP OAuth Reforma 2 — F4: McpAuthGuard dual-auth (2026-07-05)

ADR-V2-072. Guard único que decide a política de auth INTEIRA do POST /mcp, substituindo `McpKeyGuard` na cadeia. Aditivo, stateless, flag default OFF.

**Cadeia final do `@Post()`:** `McpEnabledGuard, McpOriginGuard, McpAuthGuard` (Origin ANTES do auth). `McpKeyGuard` permanece como provider e é injetado DENTRO do McpAuthGuard (colaborador).

**Política (3 caminhos mutuamente exclusivos):**
1. `Authorization: Bearer <jwt>` presente → SEMPRE valida via `McpBearerService.validate` (independe da flag). Válido → seta userCtx, passa. Inválido → **401 real + WWW-Authenticate** (hard-fail). NUNCA cai no caminho X-MCP-Key.
2. Sem Bearer, com `X-MCP-Key` → **delega literalmente** `this.mcpKeyGuard.canActivate(context)` (soft-fail preservado). Claude Code IDÊNTICO.
3. Nenhuma credencial → flag `MCP_OAUTH_ENABLED==='true'` → 401+WWW-Authenticate; flag OFF (default) → delega ao McpKeyGuard (soft-fail → mcpAuthError → JSON-RPC 200).

**Semântica da flag (nota p/ ADR):** governa SÓ o caso "sem nenhuma credencial". Bearer inválido → 401 MESMO com flag OFF (cliente tentou OAuth explicitamente). Não afeta Claude Code (que só manda X-MCP-Key, nunca Authorization Bearer). Casos DoD (a) X-MCP-Key delega e (e) sem-cred+OFF delega são BLOQUEANTES.

**Helpers novos em `oauth.constants.ts` (aditivos):**
- `MCP_OAUTH_ENABLED_ENV`, `isMcpOAuthEnabled(cfg)` (só `'true'` liga, estilo tolerante).
- `MCP_OAUTH_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'`.
- `deriveResourceMetadataUrl(resource)` → extrai `new URL(resource).origin` + path (fallback string se não parseável, nunca lança).
- `buildWwwAuthenticate(url)` → `Bearer resource_metadata="<url>"`.

**401 helper (`throwUnauthorized`):** seta header via `context.switchToHttp().getResponse<Response>().setHeader(...)` ANTES de lançar `UnauthorizedException`. Se OAuth não configurado (sem `MCP_OAUTH_RESOURCE_URI`) → 401 sem header + logger.warn (defensivo; caso flag ON sem envs é misconfig).

**GOTCHA net-zero (crítico):** trocar McpKeyGuard→McpAuthGuard no @Post QUEBRA 2 specs de fases anteriores que hardcodam a cadeia: `mcp-method-not-allowed.controller.spec.ts` e `mcp-conformance.controller.spec.ts` (asserts `arrayContaining([...,'McpKeyGuard'])` + `indexOf('McpOriginGuard') < indexOf('McpKeyGuard')`). NÃO é dívida pré-existente — é a mudança correta do F4; atualizar os asserts para `McpAuthGuard`. (Obs: o label "F4" nesses specs antigos refere-se ao F4 da Reforma 1/origin, coincidência de nome.)

**Teste de ordem de guards:** `Reflect.getMetadata('__guards__', McpController.prototype.handle)` retorna `[McpEnabledGuard, McpOriginGuard, McpAuthGuard]` (classes, não instâncias) → `toEqual([...])`. Importar controller/guards via `await import(...)` dentro do it para evitar custo de carga no describe do guard puro.

**Baseline net-zero (confirmado):** tsc 41 (inalterado); mcp suite 4 suites/3 tests failing pré-existentes (execute-task.integration, mcp-block-d, update-timer.integration, update-timer.tool) — intactos. Meu spec `mcp-auth.guard.spec.ts`: +1 suite/+8 tests, todos passam.
