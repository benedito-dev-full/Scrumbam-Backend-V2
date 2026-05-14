---
name: tenant-isolation-adr-v2-042
description: Padrao defense-in-depth de tenant isolation (ADR-V2-042) — TenantScopeService + @SkipTenantCheck + filtro em service
metadata:
  type: project
---

# ADR-V2-042 — Tenant Isolation Defense-in-Depth (implementado 2026-05-14)

**Why:** Bug P0 em producao — usuario em multiplas orgs via `/auth/switch-org` continuava vendo recursos da org anterior. Services ignoravam `JWT.organizationId` e filtravam apenas por membership.

**How to apply:**

1. **Novo endpoint tenant-scoped** → migrar para `AuthCompositeGuard` (que invoca `OrgTenantGuard` internamente apos `RequireWorkspaceGuard`).
2. **Service-level filter:** passar `organizationId?: string` do controller (`req.user.organizationId`); service cruza `DProject.idEstab` ou `DEntidade.idEstab` com BigInt(orgId).
3. **TasksService specific:** controller resolve `accessibleProjectIds = projectsService.findAccessibleProjectIds(uid, orgId)` e passa para todos os metodos de TasksService. TasksService filtra `DTask.idProject IN(...)`.
4. **Helper centralizado:** `TenantScopeService` em `src/common/services/` (Global) com `scopeProjectIdsToOrg`, `assertProjectInOrg`, `assertTaskInOrg`, `assertAgentInOrg`.
5. **Cross-org by design:** anotar com `@SkipTenantCheck()` + comentario do motivo. Usar APENAS em rotas legitimas: `/auth/*`, `/agents/install`, `/agents/:id/heartbeat`, `/agents/:id/execution-result` (HMAC), MCP keys (cross-org natural).
6. **404 anti-enumeration:** cross-tenant via path param retorna 404 identico (NUNCA 403 explicito).

**Gotchas:**
- `OrgTenantGuard` NAO e APP_GUARD global — invocado pelo `AuthCompositeGuard` (mesma razao do `RequireWorkspaceGuard`: APP_GUARDs rodam ANTES dos guards de controller, `req.user` indefinido).
- `organizationId` em services e **opcional** para preservar uso cross-org legitimo (MCP keys, Telegram handlers, background processors).
- `findAccessibleProjectIds(uid)` SEM `orgId` = modo MCP/legado (todos os projetos do user).
- `nextCursor` da paginacao em `findMany` segue o ultimo membership da pagina (DVincula), nao o ultimo project — se org filtrou tudo, `hasMore=true` continua valido.
- Agente standalone (`DEntidade.idEstab=null`) NAO aparece em listagem scopada. Operador deve linkar agente via `POST /agents/:id/projects` ou rodar backfill manual.
- `tsconfig.build.json` exclui specs → build passa mesmo com `TS2554` em specs desatualizados. Rodar `npx jest` para detectar quebras de spec apos refactor de assinatura.
- Hook ESLint `no-unused-vars` bloqueia Edit que adiciona import sem uso imediato — agrupar import + uso (provider, decorator @, etc.) no MESMO Edit.

**Codepaths:**
- `src/common/services/tenant-scope.service.ts` — helper (4 metodos + assertWorkspace).
- `src/auth/decorators/skip-tenant-check.decorator.ts` — `@SkipTenantCheck()`.
- `src/auth/guards/org-tenant.guard.ts` — Guard com bypass para `@Public()` + `@SkipTenantCheck`.
- `src/auth/guards/auth-composite.guard.ts` — encadeia `RequireWorkspaceGuard` → `OrgTenantGuard`.
- `src/projects/projects.service.ts` — findMany/findOne/findAccessibleProjectIds com `organizationId?` opcional.
- `src/tasks/tasks.service.ts` — todos os metodos publicos com `accessibleProjectIds?: string[]`.
- `src/automation/agents/agents.service.ts` — `listAgents(query, orgId?)`.
- `src/webhooks/guards/webhook-owner.guard.ts` — cruza idEstab antes de RBAC.
- `src/__tests__/tenant-isolation.adversarial.spec.ts` — 14 cenarios adversariais.

**Comando de auditoria (Reviewer/CI):**
```bash
grep -rL "AuthCompositeGuard\|@SkipTenantCheck\|OrgTenantGuard\|@Public\|JwtAuthGuard\|AgentAuthGuard\|TelegramSecretGuard\|McpKeyGuard" src/**/*.controller.ts | xargs grep -l "@Controller" 2>/dev/null
```

Cada `@SkipTenantCheck` deve ter comentario explicando motivo. Reviewer aprova caso a caso.

Ver `[[ADR-V2-042-tenant-isolation-defense-in-depth]]`.
