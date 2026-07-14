---
name: mcp-oauth-reforma2-f3-ratelimit-audit
description: F3 OAuth Reforma2 — provar (só testes) coerência rate-limit/audit no caminho Bearer; ZERO código de produção
metadata:
  type: project
---

# OAuth Reforma 2 — F3 (rate-limit + audit coerentes no caminho Bearer)

Fato: F3 NÃO alterou código de produção. Entregável = só testes provando o DoD.
**Why:** a F2 (`mcp-bearer.service.ts`) já produz `McpUserContext` completo com valores
sintéticos não-opcionais (dEntidadeId=SHA-256(sub) 63-bit; keyChave=0n; keyPrefix='oauth';
keyHash=`oauth:`+SHA-256(iss|sub|aud)). Os consumidores já operam corretamente com eles:
- `mcp.controller.ts::applyRateLimit` → `rateLimit.check(userCtx.keyHash)` (string pura; nunca parseia keyChave).
- `mcp-rate-limit.service.ts::check(keyHash)` → chave Redis `mcp:rl:${keyHash}` ⇒ `oauth:<hash>` é chave válida/estável.
- `mcp-audit.service.ts::record` → DEvento -495 (`MCP_CALL_EVENT_CLASS_ID`) com `idEntidade=dEntidadeId`, `metaDados.keyPrefix`.
**How to apply:** ao mexer em F4+ (wiring/guard), NÃO tornar keyChave/keyPrefix/keyHash opcionais;
`McpUserContext` segue com todos os campos obrigatórios (evita ondas tsc no tipo compartilhado).

Arquivos de teste (test-only, aditivo):
- `src/mcp/services/mcp-audit.service.spec.ts` (NOVO) — DoD (b): grava -495 com idEntidade sintético + keyPrefix='oauth'; params hasheados; falha de persistência não propaga. Mock: `{ dEvento: { create: jest.fn() } }`.
- `src/mcp/services/mcp-bearer.service.spec.ts` (estendido, describe "coerência com rate-limit e X-MCP-Key (F3)") — DoD (a) keyHash Bearer é chave rate-limit válida/estável (roda pelo `McpRateLimitService.check` REAL com Redis stub stateful); DoD (c) `oauth:<hex>` disjunto do keyHash real X-MCP-Key (`McpKeyService.sha256Hex(plaintext)` = 64 hex sem prefixo).

GOTCHAS:
- Redis stub p/ rate-limit: contrato é `multi().incr(key).expire(key,s).exec()`; `exec()` deve devolver `[[null, count],[null,1]]` — `extractCount` lê `result[0][1]`.
- `McpRateLimitService` construtor recebe ConfigService; instanciar direto com `{ get: () => undefined }` e chamar `setRedisClientForTesting(stub)`.
- `grep -c "it("` MENTE aqui: casa `buildRateLimit(` também. Bearer spec tem 17 `it()` reais (14 F2 + 3 F3), não 20.

NET-ZERO (baseline pré-F3 → pós-F3): tsc 41→41; suites 4 failed/43→4 failed/44 (+1 = audit spec passa); tests 3 failed/405→3 failed/411 (+6 net-new, 0 novo fail).

Nota ADR-V2-072 (F6): documentar que rate-limit e audit do Bearer reusam keyHash/dEntidadeId/keyPrefix
sintéticos SEM tocar ADR-V2-011 (rate-limit) nem ADR-V2-008 (audit/-495). Limitação viva: dEntidadeId é
SINTÉTICO (não DEntidade real) — mapeamento rico Auth0↔DEntidade é follow-up, não bloqueia conectar/listar.
```
