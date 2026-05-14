# ADR-V2-038 — JWT órfão é estado válido (usuário sem workspace ativa)

**Status:** PROPOSED (Documenter formaliza 2026-05-14)
**Data:** 2026-05-14
**Decisão:** Implementação F4 aprovada em ciclo de 5 etapas (score médio 8.6/10)
**Responsável:** Implementer (Etapas 1-5) + Documenter (formalização)

---

## Contexto e Problema

O Scrumban V2 herdou do legado uma premissa implícita: **todo JWT tem `organizationId`**. JwtStrategy enforçava isso, OrgTenantGuard usava o claim como ground-truth, e qualquer rota autenticada exigia uma workspace ativa.

**Cenários reais em que o usuário NÃO tem workspace:**

1. **Convidado via email** que abriu o link, criou conta e aterrissou na home antes de aceitar.
2. **Removido da única workspace** em que era membro (admin removeu, ou ele saiu).
3. **Convite expirado** entre criação da conta e o accept.
4. **Soft-delete de workspace** que era a única do usuário.

**Comportamento anterior à decisão:**

- Login falhava ou caía em fallback que escolhia primeira org disponível (escapando o problema, mas mascarando o estado real).
- Frontend não tinha sinal claro do estado órfão — exibia layout quebrado, ou cara de "session expired".

**Padrão das big techs (Linear, Jira, ClickUp, Slack, Notion):** login funciona normalmente; usuário aterrissa numa tela de **empty state** ("Você não está em nenhuma workspace") com 2 caminhos:
- Aceitar convites pendentes (se houver).
- Criar nova workspace.

---

## Decisão

**JWT sem `organizationId` é estado válido.** O backend emite JWT órfão (`organizationId` omitido) em `login`, `refresh` e `issueSessionForUser` quando o usuário não tem nenhuma DVincula org-scoped ativa.

Rotas marcadas com `@AllowOrphan()` aceitam JWT órfão; demais retornam **403 estruturado** com `{ code: 'NO_WORKSPACE', message: 'Você precisa criar ou aceitar uma workspace antes de acessar esta rota.' }`, sinalizando ao frontend que deve renderizar empty state.

### Rotas com `@AllowOrphan()`

| Rota | Justificativa |
|------|---------------|
| `GET /auth/me` | Frontend precisa saber `isOrphan: true` para decidir layout |
| `POST /auth/logout` | Usuário órfão deve conseguir sair |
| `POST /auth/switch-org` | Caminho de saída do estado órfão (entrar em outra org) |
| `GET /auth/pending-invites` | Listar convites pendentes para acelerar empty state |
| `POST /organizations` | Criar a primeira workspace e sair do estado órfão |

### Contrato 403 NO_WORKSPACE

```json
{
  "statusCode": 403,
  "code": "NO_WORKSPACE",
  "message": "Você precisa criar ou aceitar uma workspace antes de acessar esta rota."
}
```

### Sair do estado órfão

Dois caminhos:

1. **Criar workspace** — `POST /organizations` (cria DEntidade -152 + Default Team + Issue Counter + DVincula -161 ADMIN entre user e org, tudo em transaction atômica via `OrganizationsService.create`). Depois `POST /auth/switch-org` emite JWT novo com `organizationId`.

2. **Aceitar convite** — `POST /invites/:token/accept` (público, existing_user detectado pelo service). Cria DVincula e devolve par de tokens novo com `organizationId`.

---

## Consequências

### Positivas

- **UX alinhada ao mercado** — comportamento idêntico a Linear/Jira/ClickUp/Slack/Notion.
- **Eliminação de fallback ruim** — não escolhe org silenciosamente; usuário decide.
- **Frontend tem ground-truth claro** — `isOrphan: true` no `/auth/me` + 403 `NO_WORKSPACE` em rotas tenant-scoped permitem layout correto sem heurística.
- **Convites pendentes ficam visíveis** — `GET /auth/pending-invites` lista o que o usuário tem aguardando, acelerando onboarding.
- **Auditoria preserva o estado órfão** — DEvento -501 (login) tem `metaDados.orphan: true` para análise de funil.

### Negativas

- **Mais decorators espalhados** — 5 rotas marcadas `@AllowOrphan()`. Risco de esquecer em rota nova (mitigação: `RequireWorkspaceGuard` é o default fail-closed; esquecer o decorator quebra a rota imediatamente em desenvolvimento, sinalizando o problema).
- **JWT órfão tem `organizationId: undefined`** (omitido) em vez de `null` explícito. Decisão semântica: ausência ≠ valor nulo. Frontend deve fazer `payload.organizationId === undefined` (ou usar `isOrphan` do `/auth/me`).
- **Mais um path no fluxo de auth** — Etapas 1-5 do plano levaram ~5h totais (estimativa) entre código + tests + smoke.

### Neutras

- `OrgTenantGuard` e `RolesGuard` foram **relaxados** para usuário órfão (retornam `true` em vez de bloquear). O bloqueio fica concentrado em `RequireWorkspaceGuard` injetado dentro do `AuthCompositeGuard`. Isso é correto: bloqueio único, mensagem única.

---

## Alternativas consideradas

### Alt A — Bloquear login do usuário órfão (rejeitada)

> "Se não tem workspace, não pode logar."

**Problemas:**
- UX horrível: usuário convidado clica no link de email, registra, mas não consegue mais entrar?
- Não permite ver convites pendentes — não há como sair do estado órfão se não pode logar.
- Padrão das big techs é o oposto.

### Alt B — Onboarding automático (rejeitada)

> "Se não tem workspace, cria uma workspace 'Personal' automática no login."

**Problemas:**
- Cria workspace fantasma que polui a base.
- Remove a escolha do usuário — ele pode preferir aceitar convite, não criar nova.
- Não resolve o caso de convite pendente.

### Alt C — Empty state (ESCOLHIDA)

> "Login emite JWT órfão; frontend renderiza empty state com 2 caminhos (criar / aceitar)."

**Por quê:** padrão Linear/Jira/ClickUp/Slack/Notion. UX previsível, sem mágica, alinhada com expectativa de usuário SaaS B2B.

---

## Componentes implementados

### Decoradores novos

- `src/auth/decorators/allow-orphan.decorator.ts` — `@AllowOrphan()` + chave `ALLOW_ORPHAN_KEY`.

### Guards novos

- `src/auth/guards/require-workspace.guard.ts` — injetado dentro do `AuthCompositeGuard`. Lê `@AllowOrphan()` da rota; bloqueia JWT órfão em rotas sem o decorator com 403 `{ code: 'NO_WORKSPACE' }`.
- `src/auth/guards/require-workspace.guard.spec.ts` — 5 cenários (rota pública / com `@AllowOrphan` / sem decorator + JWT órfão / JWT normal / sem `req.user`).

### Guards modificados

- `src/auth/guards/auth-composite.guard.ts` — injeta `RequireWorkspaceGuard` e chama após autenticação Passport.
- `src/auth/guards/org-tenant.guard.ts` — retorna `true` para órfão (deixa `RequireWorkspaceGuard` cuidar).
- `src/auth/guards/roles.guard.ts` — retorna `true` para órfão (idem).

### Strategy modificada

- `src/auth/strategies/jwt.strategy.ts` — `validate()` aceita payload sem `organizationId` sem fazer lookup em DVincula. Order matter: rotas `@AllowOrphan` recebem `req.user` com `organizationId: undefined`.

### AuthService

- `src/auth/auth.service.ts`:
  - `login()`, `refresh()`, `issueSessionForUser()` aceitam usuário sem DVincula e emitem JWT órfão.
  - `getMe()` retorna `isOrphan: boolean` (derivado de `availableOrgs.length === 0`).
  - DEvento -501 (login) ganha `metaDados.orphan: true` (spread condicional — false não serializa).
  - `switchOrg()` aceita JWT órfão (não exige `organizationId` no claim de entrada).

### DTOs

- `src/auth/dto/auth-response.dto.ts` — `UserProfileDto.isOrphan: boolean` (obrigatório).
- `src/auth/dto/pending-invite.dto.ts` — `PendingInviteForMeDto` (5 campos: `inviteId, orgId, orgName, role, expiresAt`; **zero leak** de `tokenHash/flow/targetUserId/invitedByUserId/email`).

### Endpoint novo

- `GET /auth/pending-invites` (em `AuthController`):
  - Lê email do usuário autenticado via `dUserGroup` + `JwtPayload`.
  - Chama `InvitesService.listPendingInvitesForEmail(email)`.
  - Retorna `{ invites: PendingInviteForMeDto[] }`.
  - Marcado `@AllowOrphan()` (órfão precisa ver convites para sair do estado).

### InvitesService

- `src/invites/invites.service.ts` — método `listPendingInvitesForEmail(email)`:
  - 2 queries Prisma — `dTabela.findMany` por email (status PENDING, não expirado, não usado, não revogado) + `dEntidade.findMany` batch IN para resolver `orgName`.
  - **Zero N+1** (resolução em lote).
  - Sanitização total — retorna apenas os 5 campos do DTO.

### Módulos

- `AuthModule.imports` ganha `forwardRef(() => InvitesModule)` (circular dep recíproca resolvida).
- `InvitesModule.imports` mantém `forwardRef(() => AuthModule)`.

### Rotas com `@AllowOrphan()` aplicado

- `GET /auth/me` (AuthController)
- `POST /auth/logout` (AuthController)
- `POST /auth/switch-org` (AuthController — migrou de `JwtAuthGuard` para `AuthCompositeGuard`)
- `GET /auth/pending-invites` (AuthController — novo)
- `POST /organizations` (OrganizationsController — esta etapa)

---

## Trade-offs e decisões pontuais

### 1. JWT órfão omite `organizationId` em vez de usar `null`

- **Decisão:** omitir a chave do payload.
- **Razão:** ausência ≠ valor nulo. `payload.organizationId === undefined` é semanticamente mais limpo que `=== null`. Reduz superfície de bugs em comparações.
- **Frontend:** usar `isOrphan` do `/auth/me` como single source of truth.

### 2. `RequireWorkspaceGuard` é injetado dentro do `AuthCompositeGuard`, não APP_GUARD global

- **Decisão:** composição manual via `@UseGuards(AuthCompositeGuard)` controller-by-controller.
- **Razão:** APP_GUARDs rodam **antes** dos guards route-level. Como `AuthCompositeGuard` é route-level, ele depende de Passport ter populado `req.user`. Se `RequireWorkspaceGuard` fosse APP_GUARD, rodaria antes do JWT validar o token — `req.user` seria `undefined` e a lógica quebraria.
- **Consequência:** controllers que ainda usam `JwtAuthGuard` raw (sem `AuthCompositeGuard`) **não passam** pelo `RequireWorkspaceGuard`. Mitigação: roadmap converge tudo para `AuthCompositeGuard` (já é o padrão V2).

### 3. `OrgTenantGuard` e `RolesGuard` relaxados para órfão

- **Decisão:** retornar `true` (pass-through) quando JWT é órfão.
- **Razão:** evitar dupla rejeição (403 NO_WORKSPACE pelo `RequireWorkspaceGuard` + 403 FORBIDDEN pelo `OrgTenantGuard` ou `RolesGuard`). Mensagem única, fonte única.
- **Risco:** se algum decorator de role/tenant for usado SEM `RequireWorkspaceGuard` no pipeline, JWT órfão passaria. Mitigação: `AuthCompositeGuard` sempre injeta `RequireWorkspaceGuard`; se o controller usa role/tenant, está usando `AuthCompositeGuard`.

### 4. `POST /auth/switch-org` migrou de `JwtAuthGuard` para `AuthCompositeGuard`

- **Decisão:** trocar o guard para que `@AllowOrphan()` seja efetivo.
- **Carryover:** mudança implementada na Etapa 2. Etapa 5 confirmou que continua funcionando.

### 5. Sem novas tabelas, schemas, ou migrations

- **Decisão:** tudo via JWT/decorators/guards. Zero mudança em `prisma/schema.prisma`.
- **Razão:** consistência com ADR-V2-001 (zero tabela nova). Estado órfão é derivado de **ausência** de DVincula -161/-162/-163 — não precisa de coluna nova.

---

## Componentes que NÃO mudaram (regressão zero)

- `OrganizationsService.create()` — já criava DVincula -161 ADMIN entre user e org em transaction atômica. Compatível com user órfão sem ajuste.
- `InvitesService.acceptInvite()` — fluxo público; gera novo par de tokens com `organizationId` populado. Continua funcionando.
- Rotas tenant-scoped (`/projects`, `/tasks`, `/executions`, etc.) — continuam respondendo 403 `NO_WORKSPACE` para JWT órfão (comportamento desejado).
- User normal (com org) — todos os fluxos continuam idênticos. Smoke E2E confirma.

---

## Métricas e validação

### Tests adicionados (cumulativo Etapas 1-5)

- `require-workspace.guard.spec.ts` — 5 cenários
- `auth-composite.guard.spec.ts` — atualização com injeção do `RequireWorkspaceGuard`
- `roles.guard.spec.ts` — atualização com bypass órfão
- `auth.service.spec.ts` — cenários de login/refresh órfão (8 novos)
- `invites.service.spec.ts` — 8 cenários de `listPendingInvitesForEmail`

### Smoke E2E

Documentado em `workspace/smoke/smoke-orphan-workspace-etapa5.md`:
- **Fluxo A:** register → login → `/auth/me` (isOrphan:true) → `/auth/pending-invites` → `POST /organizations` → `POST /auth/switch-org` → `/projects` acessível.
- **Fluxo B:** convite pendente → `/auth/pending-invites` → `POST /invites/:token/accept` → JWT novo → org ativa.

---

## Referências

- Plano completo: `workspace/plans/plan-orphan-workspace.md`
- Smoke E2E: `workspace/smoke/smoke-orphan-workspace-etapa5.md`
- ADR-V2-001: zero tabela nova
- ADR-V2-028: convite por email (base do `GET /auth/pending-invites`)
- ADR-V2-030: multi-tenant identity (base do JWT V2)
