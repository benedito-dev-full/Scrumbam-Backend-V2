---
name: sessoes-multidevice-f3
description: F3 do auth-hardening — sessões multi-device em DTabela (-485), dual-read/dual-write, denylist no /tabelas, morte do full scan take:1000. Gotchas de seed, hook e specs.
metadata:
  type: project
---

# F3 — Sessões multi-device (ADR-V2-077, 2026-07-13)

Fecha o incidente de sessão. **Antes:** slot único em `DUserGroup.dados` — `generate()`
(usado no LOGIN) sobrescrevia o slot e limpava `prevHash`, então **logar no celular matava a
sessão do notebook e ainda a acusava de REUSE ATTACK**. A grace da F1 não cobria (protege a
*rotação*; o login não rotaciona, sobrescreve).

**Why:** era o bug que derrubava o CEO. RFC 9700 manda revogar o *grant* (família), não a conta.
OWASP ASVS exige enumerar/revogar sessões individualmente.

**How to apply:** ao mexer em auth/refresh, a verdade da sessão é `DTabela idClasse=-485`
(`codigo`=sha256(RT corrente), `nome`=familyId, `dEntidadeId`=DEntidade -150, `metaDados`=
{userGroupId, jti, prevHash, prevHashValidUntil, idle/absoluteExpiresAt, lastUsedAt, revokedReason}).
`SESSIONS_V2_ENABLED=false` volta ao caminho F1 (rollback).

## Fatos que custaram tempo (não re-derivar)

- **Chaves:** SESSION = **-485** (a -476 do plano está OCUPADA por INVITE_TOKEN). DEventos livres
  usados: -504 SESSION_CREATED, -509 SESSION_REVOKED, -523 SECURITY_REFRESH_REUSE_DETECTED,
  -524 SECURITY_ALL_SESSIONS_REVOKED. ADR = **077** (061/075/076 já ocupados).
  Seed foi 166 → **171** (45 fixas + 126 específicas). Validar com `npm run seed:classes:dry`
  (o `/seed-validate` faz grep por `chave:` e NÃO pega o helper `esp()`).
- **Hook `enforce-canonical-tables.sh` NÃO bloqueia índice** — só `CREATE TABLE` e `model` novo
  no schema. Migration de `CREATE INDEX` passa limpo (confirmado nesta fase).
- **`DTabela.codigo` é `VarChar(64)`** — cabe um sha256 hex exato. Sem alteração de schema.
- **Filtro Json do Prisma é não-confiável neste projeto** (já existia o fallback `cas_fallback` em
  `RefreshTokenService.rotateFrom`). Por isso os 2 lookups por hash usam `$queryRaw` + índices de
  expressão. Não "simplificar" para `where: { metaDados: { path: [...] } }`.
- **Full scan morto:** `auth.controller.findUserGroupByRefreshToken` (`take: 1000`) foi DELETADO.
  O caminho de rollback resolve o dono por índice
  (`DUserGroup_legacy_refresh_hash_idx`) dentro do AuthService.

## Dual-read/dual-write (o que evita logout em massa no deploy)

- `SessionService.migrateLegacySlot`: não achou sessão em DTabela → procura o slot legado
  (indexado) → **materializa a sessão naquele instante**. Base migra sozinha em ≤ 7 d.
- `RefreshTokenService.mirrorLegacySlot`: toda emissão/rotação espelha o hash no slot legado →
  desligar a flag não desloga (usuário fica com a sessão mais recente).
- Contador `auth.refresh.legacy_slot_hit` = o gatilho para a task de descarte do fallback.

## Gotchas de teste

- `FakePrisma` (`src/auth/__tests__/fake-prisma.ts`) ganhou `dTabela`, `$queryRaw`, `$executeRaw`,
  `$transaction([])`. O `$queryRaw` distingue as queries por `strings.join()` conter `"DTabela"`,
  e replica o `ORDER BY excluido ASC` — é ele que decide entre `replay` e `reuse_escalation`.
- Specs antigos (`auth.service.spec.ts`, `refresh-hardening.spec.ts`) cobrem o caminho F1 →
  passam `SESSIONS_V2_ENABLED: 'false'` / mock `{ isEnabled: () => false }`. Sem isso, quebram.
- **Prova antes/depois:** flipar `SESSIONS_V2_ENABLED` para `'false'` no
  `session-multidevice.spec.ts` roda a mesma suíte contra o código pré-F3 → **10 fail**; com F3 →
  **18 pass**. Vale como evidência de "teste falha primeiro".
- DTO precisa de `!:` (strictPropertyInitialization) — padrão do repo.

## Segurança que NÃO pode regredir

- **Denylist de -485 no `TabelaService`** (list/get/create/update/delete → 404). Sem ela,
  `GET /tabelas?idClasse=-485` devolve `codigo` = hash do refresh token de todo mundo.
- Escalação "revoga TODAS as sessões" só quando o replay vem de sessão revogada **por replay**
  (`revokedReason: 'reuse_detected'`). Logout benigno + retry atrasado NÃO pode nukar o usuário.
- Claim `sid` no JWT identifica a sessão (logout cirúrgico, `current: true`). Ausente em tokens
  pré-F3 → degradação benigna (logout cai no fail-safe "revoga todas").

Ver [[MEMORY]] e `docs/decisions/ADR-V2-077-sessoes-multidevice-dtabela.md`.
