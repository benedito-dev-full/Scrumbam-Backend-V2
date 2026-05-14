---
name: orphan-pending-invites-etapa4
description: Etapa 4 orphan-workspace — endpoint GET /auth/pending-invites; padrões de circular dep AuthModule↔InvitesModule + ESLint hook loop com imports não-usados
metadata:
  type: project
---

# Etapa 4 orphan-workspace — `GET /auth/pending-invites`

**Data:** 2026-05-14
**Plano:** `workspace/plans/plan-orphan-workspace.md` (linhas 406-510)
**Commit prerequisito:** Etapas 1, 2, 3 já mergeadas (`@AllowOrphan`, `RequireWorkspaceGuard`, `isOrphan` em `/auth/me`).

## Resumo do que mudou

- **DTO novo:** `src/auth/dto/pending-invite-for-me.dto.ts` — visão CONVIDADO (vs `PendingInviteDto` visão ADMIN). 5 campos: `inviteId, orgId, orgName, role, expiresAt`. ZERO leak de `tokenHash/flow/targetUserId/invitedByUserId/email`.
- **Service:** método paralelo `listPendingInvitesForEmail(email)` em `src/invites/invites.service.ts` (após `listPendingInvites`). 2 queries Prisma (ZERO N+1): `dTabela.findMany` por email + `dEntidade.findMany` batch IN para resolver `orgName`. **DTabela NÃO tem relation Prisma para `locEscrituracao`** — só o escalar `idLocEscrituracao`; precisa ser resolvido manualmente.
- **Controller:** endpoint `GET /auth/pending-invites` em `src/auth/auth.controller.ts` com `@UseGuards(AuthCompositeGuard) + @AllowOrphan()`. Logger novo injetado no AuthController (não existia antes).
- **Module:** `AuthModule` agora importa `forwardRef(() => InvitesModule)` — circular dep recíproca (InvitesModule já importava AuthModule).
- **Specs:** 8 cenários novos em `invites.service.spec.ts` (PENDING ok, EXPIRED, expiresAt no passado, ACCEPTED via usedAt, REVOKED, org soft-deleted, lowercase normalization, batch IN dedupe, sanitização whitelist).

## Why: padrões importantes para reuso futuro

### Why: circular dep `AuthModule ↔ InvitesModule`
**Por que:** InvitesModule já dependia de AuthService (issueSessionForUser para auto-login pós-aceite). AuthController agora depende de InvitesService. Ambos os lados precisam de `forwardRef`. **Como aplicar:** `forwardRef(() => OtherModule)` no `imports` + `@Inject(forwardRef(() => OtherService))` no constructor. Nunca usar `imports` direto sem forwardRef quando há reciprocidade.

### Why: hook PostToolUse:Edit ESLint trava em import não-usado e isso bloqueia o fluxo natural "import primeiro, usar depois"
**Por que:** O `eslint --max-warnings 0` roda a cada Edit. Adicionar import sem usar = bloqueio imediato. **Como aplicar:** OU agrupar TUDO num único Edit grande (`old_string` cobrindo desde imports até método consumindo o tipo), OU usar `// eslint-disable-next-line @typescript-eslint/no-unused-vars` no import como ponte temporária e remover na Edit seguinte (que adiciona o uso). Confirmado: ESLint sem `reportUnusedDisableDirectives` aceita disable inerte sem erro.

### Why: `as unknown as Record<string, unknown>` em tests para verificação de whitelist de campos
**Por que:** TS bloqueia cast direto entre `PendingInviteForMeDto` e `Record<string, unknown>` por incompatibilidade estrutural (TS2352). **Como aplicar:** double-cast via `unknown` quando precisar acessar `Object.keys(...)` em DTO para verificar shape exato.

### Why: ordem dos `import { ... } from '@nestjs/common'` precisa ser ALPHA-ASC
**Por que:** Hook formatter (prettier) reordena imports automaticamente. Ao adicionar `forwardRef`, `Inject`, `Logger`, eles entram em posição alfabética entre os existentes. **Como aplicar:** ao montar o `new_string` do Edit, já colocar em ordem `Body, Controller, Delete, forwardRef, Get, GoneException, HttpCode, HttpStatus, Inject, Logger, Patch, Post, UseGuards`.

### Why: `dTabela.findMany` é a query primária, não `findFirst` em loop
**Por que:** N+1 obvio. O padrão correto: 1 query findMany por email + 1 query findMany batch IN das orgs. Filtros adicionais (status PENDING, expiresAt futuro, usedAt null) em memória — o volume por email é pequeno (<50). JSONB indexing em metaDados não compensa para uso esporádico do endpoint.

## Codepaths

- `src/auth/dto/pending-invite-for-me.dto.ts` (NOVO)
- `src/invites/invites.service.ts:763-836` — `listPendingInvitesForEmail`
- `src/auth/auth.controller.ts:65` — Logger; `:236-269` — endpoint `getPendingInvitesForMe`
- `src/auth/auth.module.ts:17-19, 67` — import + forwardRef de InvitesModule
- `src/invites/invites.service.spec.ts:838-1015` — 8 specs novos

## Smoke test rápido (manual)

```bash
# (com server rodando)
TOKEN=...  # JWT órfão (user sem DVincula)
curl http://localhost:3000/api/v1/auth/pending-invites -H "Authorization: Bearer $TOKEN"
# Espera: 200 { invites: [{ inviteId, orgId, orgName, role: "MEMBER", expiresAt }] }
```

## Pre-existing test failures (não relacionados, carryover Etapa 3)

`npx tsc --noEmit` reporta erros em:
- `src/automation/agents/__tests__/agents-{heartbeat,install,projects}.spec.ts` (TS2554: 8 args esperados, 7 dados)
- `src/automation/agents/__tests__/execution-result.service.spec.ts` (TS2554)
- `src/common/cache/ttl-cache.service.spec.ts` (TS2554)
- `src/executions/__tests__/execution-run.processor.spec.ts` (TS2554)

NÃO causados pela Etapa 4 — `make build` (`nest build`) ignora `**.spec.ts` e passa. Documentados na Etapa 3 memory.
