# ADR-V2-042 — Tenant Isolation Defense-in-Depth

**Status:** Accepted
**Data Proposta:** 2026-05-14
**Data Aceita:** 2026-05-14
**Autor:** Strategist + Implementer V2 (rastreado por `workspace/plans/plan-tenant-isolation-fix.md`)
**Severidade do problema:** P0 — bloqueador de multi-tenancy em producao
**Vinculados:** ADR-V2-001, ADR-V2-003, ADR-V2-030, ADR-V2-038, ADR-V2-040

## Contexto

Producao reportou que ao trocar de workspace via `POST /auth/switch-org`,
recursos exibidos (projetos, tasks, agents, etc.) **permaneciam iguais entre
orgs**. JWT trocava `organizationId` corretamente, mas multiplos services
**ignoravam** `organizationId` e filtravam apenas por `userEntidadeId`
(membership via DVincula). Como um user pode ter vinculos em multiplas orgs,
DVincula retornava tudo — independente da org ativa.

A causa raiz foi confirmada em:
- `ProjectsService.findMany` / `findAccessibleProjectIds`.
- `TasksService.findMany` (nem recebia user/org).
- `AgentsService.listAgents`.
- Tools MCP (heranca de bugs acima).
- Outros endpoints "tenant-scoped" sem cruzamento explicito com
  `DProject.idEstab` / `DEntidade.idEstab`.

## Decisao

Adotar **defesa em profundidade** com 3 camadas complementares:

### Camada 1 — Guard `OrgTenantGuard` invocado pelo `AuthCompositeGuard`

`OrgTenantGuard` (já existia) ganha suporte ao decorator `@SkipTenantCheck()`
para rotas legitimamente cross-org. É **invocado internamente pelo
`AuthCompositeGuard`** (não registrado como APP_GUARD global, pelo mesmo
motivo do `RequireWorkspaceGuard`: APP_GUARDs rodam ANTES dos guards de
controller, `req.user` ficaria indefinido).

Estrategias (`@TenantConfig`):
- `JWT_ONLY` (default): confia no JWT validado pelo strategy.
- `PROJECT_ESTAB`: extrai `projectId` do path e cruza com `DProject.idEstab`.
- `PATH_PARAM`: compara `:orgId` do path com `JWT.organizationId`.

Bypass automatico:
- API Key auth (isola por `dEntidadeId`).
- MCP Key auth (cross-org por design — sem `organizationId`).
- JWT orfao (decidido por `RequireWorkspaceGuard`).
- Rotas `@Public()` ou `@SkipTenantCheck()`.

### Camada 2 — Filtro em service (`organizationId` propagado)

Services tenant-scoped recebem `organizationId: string` como parametro
**opcional** (compat com MCP cross-org). Quando informado:

- `ProjectsService.findMany` filtra `DProject.idEstab === BigInt(orgId)`.
- `ProjectsService.findAccessibleProjectIds(uid, orgId?)` faz batch:
  DVincula -> projectIds candidatos -> DProject filtrado por idEstab.
- `ProjectsService.findOne/update/delete/getStats` validam tenant antes
  de RBAC (404 anti-enumeration se mismatch).
- `TasksService.{findMany, findOne, create, update, updateStatus,
  updateSprint, delete}` recebem `accessibleProjectIds: string[]` ja
  resolvido pelo controller (que chama `findAccessibleProjectIds(uid,
  orgId)`). Filtra `DTask.idProject IN (accessibleProjectIds)`.
- `AgentsService.listAgents(query, orgId?)` filtra
  `DEntidade.idEstab === orgId`.

### Camada 3 — Helper compartilhado `TenantScopeService`

Novo service em `src/common/services/tenant-scope.service.ts`, exportado
pelo `CommonModule` (Global). Concentra:

- `scopeProjectIdsToOrg(userEntidadeId, orgId)` — projetos onde user e
  membro E projeto pertence a org (1 query JOIN-equivalente).
- `assertProjectInOrg(projectId, orgId)` — 404 anti-enumeration se cross.
- `assertTaskInOrg(taskId, orgId)` — resolve via `DTask.idProject ->
  DProject.idEstab`.
- `assertAgentInOrg(agentId, orgId)` — `DEntidade.idEstab`.
- `assertWorkspace(orgId)` — 403 NO_WORKSPACE para JWT orfao
  (defesa-em-profundidade redundante com `RequireWorkspaceGuard`).

Cobertura: **21 unit tests + 14 testes adversariais** (ver
`src/__tests__/tenant-isolation.adversarial.spec.ts`).

## Politica de Erros

| Cenario | Status | Mensagem |
|---|---|---|
| Listagem (findMany) cross-tenant | 200 | Lista vazia (sem leak) |
| GET single cross-tenant via path | 404 | "X nao encontrado" (anti-enumeration) |
| POST/PATCH cross-tenant via path | 404 | Mesmo |
| JWT orfao em rota tenant-scoped | 403 | `{ code: 'NO_WORKSPACE' }` |
| Agente standalone (idEstab=null) | nao listado | Idem |
| Projeto sem idEstab (legado) | nao listado | Operador roda backfill |

**Rationale 404 vs 403:** 403 explicito permite enumeration ("este projeto
existe mas nao e meu"). 404 e indistinguivel de "nao existe" — atacante nao
distingue ID validos em outras orgs.

## Endpoints Cross-Org Legitimos (`@SkipTenantCheck()`)

Decoradores aplicados com comentario do motivo:

- `/auth/*` — operacao sobre o user, nao tenant-scoped.
- `/agents/install` — autenticado por install-token, nao JWT.
- `/agents/:id/heartbeat` — autenticado por HMAC.
- `/agents/:id/execution-result` — autenticado por HMAC.

Outros endpoints cross-org by design ficam SEM `AuthCompositeGuard`
(usam `JwtAuthGuard`/`@Public()` direto): `/invites/:token`,
`/health`, `/teams/mine` (precisam de comentario explicativo no controller).

## Auditoria

Reviewer/CI deve rodar:

```bash
# Controllers sem ALGUMA forma de auth declarada
grep -rL "AuthCompositeGuard\|@SkipTenantCheck\|OrgTenantGuard\|@Public\|JwtAuthGuard\|AgentAuthGuard\|TelegramSecretGuard\|McpKeyGuard" src/**/*.controller.ts | xargs grep -l "@Controller" 2>/dev/null
# Esperado: apenas controllers internos sem rota HTTP, ou documentados.

# Services com findMany sem filtro de org (deve retornar apenas helpers internos)
grep -rn "findMany\|findFirst" src/projects/projects.service.ts src/tasks/tasks.service.ts src/automation/agents/agents.service.ts | grep -v "organizationId\|idEstab\|excluido\|accessibleProjectIds"
```

## Compatibilidade

- **MCP keys:** continuam cross-org. `findAccessibleProjectIds(uid)` SEM
  orgId retorna todos os projetos do user (modo legado).
- **Channels (Telegram):** cross-org by design — handler resolve `accessibleProjectIds` sem orgId.
- **Background jobs (processors):** mesmo (ex:
  `execution-run.processor.moveLinkedTaskToExecuting`).
- **Backfill de `idEstab`:** projetos legados sem `idEstab` ficam
  inacessiveis via JWT scopado. Operador deve rodar migration ou
  `dProject.update({ idEstab: ... })`. Documentado em
  `prisma/scripts/backfill-project-idEstab.ts` (futuro).

## Riscos e Mitigacoes

1. **Endpoint esquecido durante refactor** — comando de auditoria roda no CI.
2. **Performance:** `findAccessibleProjectIds` ja era usado em MCP — sem
   regressao. `scopeProjectIdsToOrg` adiciona 1 query ao banco em
   listagens; mitigado por indice em `DProject(idEstab, excluido)`.
3. **Quebra cross-org legitimo:** mitigado por `@SkipTenantCheck()` com
   comentario obrigatorio. Cada uso revisado.

## Status de Implementacao (em-flight)

- [x] `TenantScopeService` + 21 unit tests + 14 adversariais.
- [x] `@SkipTenantCheck` decorator + `OrgTenantGuard` integrado ao
  `AuthCompositeGuard`.
- [x] `ProjectsService` refatorado (findMany / findOne / update / delete /
  getStats / findAccessibleProjectIds com orgId).
- [x] `TasksService` refatorado (todos os metodos recebem
  `accessibleProjectIds?`).
- [x] `AgentsService.listAgents` filtra por `idEstab`.
- [x] `ProjectsController`, `TasksController`, `AgentsController` migrados
  para `AuthCompositeGuard` ou passam orgId.
- [x] MCP tools propagam scope (cross-org by design via auth path).
- [x] Channels (`tasks.handler`, `status.handler`) propagam scope.
- [x] `WebhookOwnerGuard` cruza idEstab antes de validar membership.

## Conclusao

Defesa em profundidade aplicada. Atacante teria que furar 3 camadas
(guard HTTP, filtro service, helper centralizado) para vazar dados entre
orgs. Cobertura adversarial estabelece regressao automatica.
