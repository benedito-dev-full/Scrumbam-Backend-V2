---
name: org-context-stale-f4
description: F4 do auth hardening — 401 ORG_CONTEXT_STALE, 403 FORBIDDEN_ROLE vs 404 na escrita de task, e o bug sub-vs-entidadeId do ProjectScopeGuard
metadata:
  type: project
---

# F4 — ORG_CONTEXT_STALE + semântica de erro (2026-07-13)

Plano: `workspace/plans/plan-sessao-auth-hardening.md` §5 FASE 4. Item **4.1 (Redis L2 + pub/sub) NÃO foi feito** — CEO confirmou produção em **UMA réplica**, então LRU in-process é o correto e Redis seria SPOF novo.

**Why:** o backend respondia **200 com lista vazia** quando o `organizationId` do JWT não batia com membership real → "sumiram meus projetos" sem nada acusar. E a escrita de task negava com 404 mesmo quando o usuário tinha leitura.

**How to apply:**

## A distinção que é a alma do item (lista vazia NÃO decide nada)
O claim `organizationId` **só é emitido a partir de uma DVincula de org existente** (`AuthService.login` ~l244: `DVincula idClasse in [-161,-162,-163]`). Logo:
- claim presente + membership **ausente** → revogada DEPOIS da emissão → **401 ORG_CONTEXT_STALE**
- claim presente + membership **presente** + zero projetos → usuário/org NOVOS → **200 `[]`** (nunca 401 — senão trava todo usuário novo em loop de refresh)
- claim **ausente** → órfão (ADR-V2-038) → 200 `[]`, quem responde é o `RequireWorkspaceGuard` (403 NO_WORKSPACE)

Fonte única: `ProjectsService.assertOrgContextFresh(entidadeId, organizationId?, source)` → `'orphan'|'fresh'`, lança 401. **Fail-open** se a query de membership explodir (infra ≠ invalid_token, RFC 6750).

## Onde a decisão mora (e por que NÃO no service de tasks)
`TasksService.findMany` recebe só `accessibleProjectIds` — **nunca o claim** — é incapaz por construção de distinguir. A checagem está em `TasksController.resolveScopedProjectIds` (único ponto HTTP com o claim). **`findAccessibleProjectIds` NÃO lança** — é consumida por MCP/Telegram/realtime/AI, que são cross-org por design e legitimamente não têm org.

## 403 vs 404 na escrita (item 4.3)
`TasksService.assertTaskWritable(id, idProject, accessibleProjectIds)` nos 3 write paths (update/updateStatus/delete):
- fora do escopo E **não** é template global → **404** (anti-enumeração, OWASP — inalterado)
- é **template GLOBAL** (-401/-402 `idEstab=NULL`, único caso hoje de "tem leitura, não tem escrita" — `findOne` o libera via ADR-V2-061) → **403 `FORBIDDEN_ROLE`**
Não há RolesGuard em rotas de task hoje — VIEWER escreve; introduzir isso seria mudança de comportamento fora do escopo.

## Gotchas
- `ORG_CONTEXT_STALE` **não existia** em `src/common/errors/error-codes.ts` (só em `docs/auth-error-codes.md`) — tive de adicionar.
- `ProjectScopeGuard` usava `BigInt(user.sub)` (DUserGroup.chave) onde `getProjectRole` espera `DVincula.idEntidade` (DEntidade.chave). Zero usos fora do auth → nunca explodiu. Corrigido.
- `isGlobalTemplate` faz `p !== null`: mock de `dProject.findFirst` que resolve `undefined` LIBERA por engano. Default do spec é `mockResolvedValue(null)` — mantenha.
- **`auth.service.spec.ts` é FLAKY sob carga paralela** (full suite): runs idênticos do mesmo subset alternam 7/8 suites falhando. Passa isolada. Não confunda com regressão — compare por suite, não pelo total.
- Baseline `src/projects src/tasks src/auth`: **9 suites / 84 testes falhando** (pré-existentes: `doneStatusRows` undefined em projects.service.spec + create-phase/custom-fields).

Ver [[auth-hardening-fase2-frontend]] e [[sessoes-multidevice-f3]] (fases irmãs).
