---
name: F3 Review Score e Padrões
description: Score histórico e padrões identificados no review da F3 Auth + RBAC Duplo
type: project
---

## Score F3 — Auth + RBAC Duplo (Task 1): APPROVED 7.8/10

**Why:** Implementação correta e completa. Build limpo, TS/ESLint zerados, 78/78 testes, 3 Pilares OK, 17 modelos exatos. Score reduzido por dois issues MEDIUM aceitos como dívidas F14: bracket notation para acessar campo privado do service (authService['prisma']) e N+1 em write path (revokeApiKeys com loop sequencial). Funcionalidade principal — refresh token rotativo, reuse detection, LRU cache para roles — correta e testada.

**How to apply:** Em fases de auth/segurança, qualidade de 7.8 indica código funcional com dívidas técnicas documentadas. Issues estruturais de encapsulamento (acesso privado via bracket) e N+1 em write path são penalizados mas não bloqueantes se volume é baixo e o issue está registrado para correção futura.

---

## Issues Identificados em F3

### MEDIUM — Acesso privado via bracket notation em Controller
`AuthController.findUserGroupByRefreshToken` acessa `this.authService['prisma']` para contornar visibilidade `private`.
Correção: expor método `findUserGroupByRefreshTokenHash` no AuthService.
Pattern a rejeitar em F5+: Controller NUNCA deve acessar campo privado de Service via bracket.

### MEDIUM — N+1 em write path (revokeApiKeys)
Loop `for...of` com `await apiKeyService.revoke(id)` gera N queries sequenciais.
Correção: `updateMany` com `where: { dEntidadeId: projectId, excluido: false }`.
Pattern a rejeitar em F5+: loop com await em operações de UPDATE/DELETE bulk.

### MEDIUM — Refresh token sem índice: scan O(n)
`findUserGroupByRefreshToken` faz `findMany(take:1000)` e filtra em app.
Funcional para F3 (volume baixo). F14 deve adicionar campo indexado ou exigir userGroupId no body do refresh.

---

## Padrões de Qualidade Positivos (F3)

- Composite Guard com OR logic: implementação correta — guards internos retornam false/undefined, NUNCA lançam exceção. Apenas o Composite lança.
- LRU cache em RoleResolverService: cache key `org:${orgId}:${userId}`, TTL 5min, invalidação manual ao criar/revogar DVincula.
- Bcrypt rounds via constante nomeada: `const BCRYPT_ROUNDS = 12` com comentário ADR — padrão a exigir.
- DClasses como constantes BigInt: `const ID_CLASSE_ORG_ADMIN = BigInt(-161)` — sem magic numbers inline.
- Transaction correta no register: 5 operações (DUserGroup + DEntidade user + DEntidade org + DVincula + DEvento) em $transaction atômica.
- DEvento APÓS persistência: todos os eventos de audit são emitidos após o $transaction bem-sucedido.
- login_failed com try/catch não-bloqueante: correto — falha de audit não deve bloquear resposta ao cliente.

---

## Calibração de Score para Fases de Auth/Segurança

- F3 com acesso privado + N+1 write: 7.8 (APPROVED com dívidas documentadas)
- F3 sem esses issues: esperado ~8.5-9.0
- F3 com coluna `role` detectada: < 5.0 (REJECTED)
- F3 com bcrypt rounds < 12: < 5.0 (REJECTED)
- F3 sem spec de reuse detection: < 7.0 (NEEDS_CHANGES)
