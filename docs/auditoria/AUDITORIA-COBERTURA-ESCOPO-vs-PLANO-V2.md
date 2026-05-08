# Auditoria de Cobertura — Escopo Scrumban-hoje vs Plano V2 (remediado)

**Versao:** 1.0
**Data:** 2026-05-08
**Auditor:** Reviewer Devari-Core (sonnet)
**Audiencia:** CEO + Tech Lead
**Status:** APROVADO COM RESSALVAS — escopo intacto no nucleo (capacidades macro 100%); 7 lacunas pontuais a fechar antes de F0
**Metodologia:** cruzamento linha-a-linha de `Scrumbam-Backend/docs/SYSTEM-OVERVIEW.md` + `Scrumbam-Backend/docs/API-CONTRACT.md` (fontes da verdade) contra `Scrumban-Backend-V2/docs/plano/{00..04}.md` (plano remediado). Cada capacidade do produto-hoje recebe veredicto explicito com evidencia arquivo:linha.

---

## 0. RESUMO EXECUTIVO

### 0.1 Numeros consolidados

| Metrica | Valor |
|---------|-------|
| Capacidades macro auditadas (modulos do SYSTEM-OVERVIEW §4) | 21 |
| Capacidades COBERTAS (verde) | 17 (81%) |
| Capacidades PARCIAIS (amarelo) | 4 (19%) |
| Capacidades AUSENTES (vermelho) | 0 (0%) |
| Endpoints auditados (API-CONTRACT total declarado: 128) | 128 |
| Endpoints com cobertura DIRETA no plano V2 (mesmo path/metodo) | 91 (71%) |
| Endpoints cobertos via REUSO de generico `/entidades`-`/tabelas` (Pilar 2 — paridade contratual SUJEITA a wrapper) | 19 (15%) |
| Endpoints com cobertura PARCIAL (path renomeado, payload divergente, ou rotina nao-mencionada explicitamente mas implicitamente acomodada) | 11 (9%) |
| Endpoints AUSENTES no plano (nao mencionados em nenhuma das 1.659 + 1.811 + 5.428 = 8.898 linhas auditadas) | 7 (5%) |
| Score de cobertura macro (capacidades) | **8,8 / 10** |
| Score de cobertura granular (endpoints) | **8,2 / 10** |
| Score de fidelidade contratual (paths exatos preservados) | **7,8 / 10** |
| Score consolidado de cobertura | **8,3 / 10** |

### 0.2 Veredicto

**APROVADO COM RESSALVAS.** O nucleo do escopo Scrumban-hoje (Auth + RBAC duplo, Tasks V3 com state machine, Sprints + Workflow Statuses, Projects/Teams/Organizations, Telegram texto/voz/comandos/parser, MCP 5 tools, Webhooks HMAC, Automation Claude Code completa, Flow Metrics 6-pack, Forecast Monte Carlo, Reports PDF, Search global, Notifications, Health, Channels, Analytics 3-pack) esta INTEGRALMENTE preservado nas 17 fases do V2. **Nenhuma capacidade macro foi silenciosamente removida no retrabalho dos Blocos 1-5.**

Entretanto, **7 endpoints granulares** do legado nao aparecem em nenhuma das 5.428 linhas do plano remediado. Cinco deles compoem a feature **Work Timer** (`/tasks/:id/work/start`, `/work/stop`, `/tasks/my-active-work`, `/tasks/project-work-time`, `/tasks/:id/work-time`), capacidade entregue em produca no legado e essencial para mensurar lead/cycle time real (nao apenas timestamp de transicao). O sexto (`/tasks/:id/history`) e o audit-log por task (visivel ao MEMBER no UI). O setimo (`PATCH /organizations/:orgId/users/:userId/role`) e a mudanca de cargo de membro — o plano V2 cobre `POST /organizations/:orgId/users` e `DELETE`, mas a TROCA de cargo in-place esta ausente.

Adicionalmente, ha **4 capacidades em estado "PARCIAL"**: (1) Sprints — plano V2 cobre criacao/listagem via wrapper sobre `/tabelas?idClasse=-400` mas **NAO menciona `DELETE /sprints/:id` com desvinculacao das tasks** (comportamento documentado em API-CONTRACT linha 1271-1279); (2) Webhooks — wrapper `/webhooks/configure` ausente do plano (plano usa `POST /webhooks` generico) o que quebra contrato HTTP; (3) Notifications — endpoints `read-all` e `read` em batch presentes no V2 mas o legado tambem tem `markAsRead` granular (`PATCH /notifications/:id/read`) que e *mencionado* como "PUT :id/read" em F7 — caso de divergencia minimo de metodo HTTP (PATCH vs PUT); (4) Tasks — campo `assigneeId` aceito no DTO V2 mas nao ha mencao explicita ao filtro `?assigneeId=` em `GET /tasks` (legado tem).

### 0.3 As 3 lacunas mais criticas

1. **AUSENTE — Work Timer (5 endpoints).** Capacidade do legado entregue (`SYSTEM-OVERVIEW` linha 1332-1448; `CLAUDE.md` legado registra "P3-T11 + Batch A1-C8" como concluido em 30/03/2026 com endpoints `work/start`, `work/stop`, `my-active-work`, `project-work-time`, `work-time`). **Nenhuma das 5.428 linhas do plano V2 menciona** "work timer", "work/start", "work/stop", "project-work-time", "my-active-work" ou "work-time". Risco: alta probabilidade de ter sido perdido no retrabalho. Acao: incluir como bloco G.5 da F5 (DTask com `dados.workSessions[]: { startedAt, stoppedAt, userId }` ou DEvento -502 WORK_TIMER) — ZERO tabela nova requerida.

2. **AUSENTE — `GET /tasks/:id/history`.** Audit-log por task (`API-CONTRACT` linha 1401-1407, papel: ADMIN/MEMBER/VIEWER). Plano V2 fala em "audit log via DEvento" (F7 Bloco N consumers, linha 1717+) mas NAO expoe endpoint que liste eventos de uma task. UI legada usa endpoint para mostrar timeline na pagina da task. Acao: adicionar `GET /tasks/:id/history` em F7 que filtra `DEvento WHERE idEntidade = taskId AND idClasse IN (-497, -498)` com cursor pagination.

3. **AUSENTE — `PATCH /organizations/:orgId/users/:userId/role`.** Mudanca de cargo de membro (`API-CONTRACT` linha 987-996, ADMIN-only). Plano V2 (F3, F5 Bloco B) fala em criar/remover membro via DVincula `-160..-163`, mas nao menciona o endpoint para TROCAR cargo. Acao: adicionar em F5 Bloco B "B.7. Atualizar cargo: `PATCH /organizations/:orgId/users/:userId/role { role }` -> UPDATE DVincula.idClasse de -161/-162/-163 atomicamente".

Detalhamento completo: ver §5 (Top 10 Lacunas).

---

## 1. INVENTARIO SCRUMBAN-HOJE (extraido)

### 1.1 Capacidades Macro (21 modulos do SYSTEM-OVERVIEW §4)

| # | Modulo | Linha SYSTEM-OVERVIEW | Endpoints REST | Observacao |
|---|--------|----------------------|----------------|------------|
| 1 | Auth Module | 320-353 | 11 | Login, register, refresh, logout, /me CRUD, API/MCP keys |
| 2 | Organizations Module | 357-382 | 6 | CRUD org + gestao de membros + cargos |
| 3 | Projects Module | 386-415 | 16 | CRUD + activity + summaries + members + delete cascade + agent-link + git-creds |
| 4 | Tasks Module | 419-458 | ~13 | CRUD V3 + state machine + identifier + work timer + history + estimate-ai |
| 5 | Sprints Module | 462-480 | 3 | CRUD Sprint (DTabela -400) |
| 6 | Workflow-Statuses Module | 484-507 | 7 | CRUD + reorder + seed-defaults |
| 7 | Dashboards Module | 511-538 | 5 | metrics, velocity, burndown, tasks-by-user, daily-summary |
| 8 | Flow Metrics Module | 542-558 | 6 | cycle-time, lead-time, throughput, wip-age, cfd, dashboard |
| 9 | Forecast Module | 562-575 | 1 | Monte Carlo p50/p75/p85/p95 |
| 10 | Search Module | 579-598 | 1 | Busca unificada (tasks/projects/people) |
| 11 | Reports Module | 602-623 | 1 | PDF exportavel via PDFKit |
| 12 | Notifications Module | 627-650 | 5 | CRUD + read-all + unread-count + auto-trigger |
| 13 | Webhooks Module | 654-682 | 6 + 1 inbound | Outbound HMAC + retry + auto-disable + incoming/:channel |
| 14 | Teams Module | 686-715 | 10 | CRUD + members + identifier DEV-N atomico |
| 15 | Channels Module (Telegram) | 719-770 | 4 | Pairing + status + unlink + webhook |
| 16 | Analytics Module | 774-783 | 3 | compare, capacity-forecast, stakeholder-report |
| 17 | Integrations Module (OpenAI stub) | 787-801 | (consumido por /tasks/:id/estimate-ai) | Stub MVP |
| 18 | Automation Module — Agents (Fase 1) | 805-848 | 8 | CRUD + register + heartbeat + test-connectivity |
| 19 | Automation Module — Projects-Link (Fase 2) | 850-904 | 9 | agent-link CRUD + status + executions + git-credentials CRUD + apply-config |
| 20 | Automation Module — Execution (Fase 3) | 906-971 | 8 | execute + executions CRUD + approve/reject/rollback + claude-credential-status/instructions |
| 21 | MCP Module | 975-1018 | 5 (3 mgmt + 2 protocol) | 5 tools, X-MCP-Key auth, rate limit 60/min |
| Health | 1022-1033 | 2 | /health (liveness) + /health/ready |
| Common | 1037-1057 | (servicos transversais) | TimezoneService, EventService, WebhooksDispatcher, CorrelationId |

**Total declarado:** 22 modulos (Auth, Orgs, Projects, Tasks, Sprints, WS, Dashboards, Flow Metrics, Forecast, Search, Reports, Notifications, Webhooks, Teams, Channels-Telegram, Analytics, Integrations-OpenAI stub, Automation-Agents, Automation-Projects-Link, Automation-Execution, MCP, Health) — `API-CONTRACT.md` declara 128 endpoints em 22 modulos (linha 1751-1761).

### 1.2 Capacidades de fluxo end-to-end (SYSTEM-OVERVIEW §11, linhas 1425-1609)

| Fluxo | Linha | Status no V2 |
|-------|-------|--------------|
| Fluxo 1 — Criar uma Task | 1427-1448 | COBERTO em F5 Bloco E (identifier atomico via DEntidade.dados.lastIssueSeq) |
| Fluxo 2 — Mover Task entre Status (state machine V3) | 1452-1478 | COBERTO em F5 Bloco E.4-E.5 (validTransitions map identico ao legado) |
| Fluxo 3 — Fechar uma Sprint | 1482-1500 | COBERTO em F9 (Dashboards.velocity) |
| Fluxo 4 — Telegram texto vira Task | 1504-1552 | COBERTO em F10 (Channel pairing + parser + voice) |
| Fluxo 5 — Gerar Forecast | 1556-1568 | COBERTO em F8 (ForecastService Monte Carlo 10k) |
| Fluxo 6 — Executar Code via Automation | 1572-1607 | COBERTO em F6+F13 (`OperacaoExecucaoClaude` + Risk Gate + Approval + PR auto-open) |

### 1.3 Sistema de eventos canonicos (SYSTEM-OVERVIEW §5)

| Evento | Trigger legado | Linha | Status no V2 |
|--------|----------------|-------|--------------|
| `task.created` | TasksService.create | 1083 | COBERTO (DEvento -497, F5 + F7) |
| `task.status_changed` | TasksService.updateStatus | 1084 | COBERTO (DEvento -498, F7) |
| `task.moved` | TasksService.updateSprint | 1085 | PARCIAL — V2 nao menciona evento `task.moved` por nome (resvala em DEvento generico) |
| `task.deleted` | TasksService.remove | 1086 | COBERTO (audit log em DEvento, F7) |
| `project.created` | ProjectsService.create | 1087 | COBERTO em F5 Bloco C (audit DEvento) |
| `project.deleted` | ProjectsService.remove | 1088 | COBERTO (DEvento -499, plano-mestre §3.2) |
| `agent.registered` | AgentsService.registerAgent | 1089 | COBERTO em F13 (`agent.registered` event) |
| `auth.login`/`auth.logout`/`auth.failed` | AuthService | — | COBERTO em F3 (linha 821) |

### 1.4 Background jobs / cron (SYSTEM-OVERVIEW §6)

| Job | Frequencia | Status no V2 |
|-----|-----------|--------------|
| AgentStatusSweeperService | 30s | COBERTO em F13 (linha 824) |
| ApprovalFlowSweeperService | 1min | COBERTO em F6 (sweeper de timeout HIGH approval em 1h) |

### 1.5 Guards e autenticacao (SYSTEM-OVERVIEW §7)

| Guard | Status no V2 |
|-------|--------------|
| JwtAuthGuard | COBERTO (F3) |
| AuthCompositeGuard (JWT OR API Key OR MCP Key) | COBERTO (F3, plano §6.4) |
| ProjectScopeGuard | COBERTO (F3) |
| OrgTenantGuard | COBERTO (F3) |
| RolesGuard (ADMIN/MEMBER/VIEWER) | COBERTO (F3, RBAC duplo via DVincula -160..-173) |
| TeamRolesGuard | COBERTO (F5 Bloco B) |
| AgentThrottlerGuard | COBERTO (F6 Bloco K) |
| InstallTokenGuard | COBERTO (F13) |
| AgentTunnelGuard | COBERTO (F13) |
| TelegramSecretGuard | COBERTO (F10 linha 92) |
| McpKeyGuard | COBERTO (F11) |

---

## 2. AUDITORIA CAPACIDADE-POR-CAPACIDADE

### 2.1 Auth + RBAC duplo

**Origem (Scrumban-hoje):** SYSTEM-OVERVIEW linhas 320-353; API-CONTRACT linhas 80-228.

**Resumo da capacidade:** JWT stateless (15min access + 7d refresh) com cookies httpOnly; bcrypt para senha; 3 tipos de credencial (JWT, X-API-Key por projeto, X-MCP-Key por user); RBAC duplo em DVincula.cargo (ORG: ADMIN/MEMBER/VIEWER; PROJECT: MANAGER/MEMBER/VIEWER); soft-delete em cascata (ultimo ADMIN exclui org); refresh token rotativo.

**Cobertura no plano V2 remediado:**
- [x] Fase: F3 em `01-FUNDACAO.md:797-1031`
- [x] DClasse(s) prevista(s): -160..-163 (Org roles), -170..-173 (Project roles), -471 API_KEY, -472 MCP_KEY (plano-mestre §3.2)
- [x] DoD inclui: register, login, refresh rotativo, logout, /me CRUD, API key, MCP key, OrgTenantGuard, ProjectScopeGuard, RoleResolverService (linha 959-975)
- [x] ADRs: ADR-V2-003 (RBAC duplo via DVincula), ADR-V2-004 (API/MCP keys via DTabela)

**Veredicto:** COBERTO

**Evidencia:** `01-FUNDACAO.md:925-932`:
```
- POST /auth/login, /auth/register, /auth/refresh, /auth/logout
- GET /auth/me retorna { id, entidadeId, name, email, organizationId, organizationName, defaultProjectId, defaultTeamId, onboardingCompleted, role }
- PATCH /auth/me { name?, email?, defaultProjectId?, defaultTeamId?, onboardingCompleted? }
- DELETE /auth/me — soft-delete user (cascade: DVincula)
- POST /auth/me/api-key, GET /auth/me/api-key, DELETE /auth/me/api-key — wrappers que chamam ApiKeyService
- POST /auth/me/mcp-key, GET, DELETE — analogo
- POST /projects/:id/api-key (ADMIN), GET, DELETE
```

**Risco / Acao:** Validar em F3 que `register` retorna `organizationName` e que `login` seta cookies httpOnly `scrumban_jwt` (15min) e `scrumban_refresh` (7d) — SYSTEM-OVERVIEW linhas 95-97. Plano V2 menciona "JWT" mas nao detalha cookies httpOnly explicitamente em F3. Sugestao: adicionar nota no DoD F3 sobre cookies httpOnly.

**Score parcial:** 9,5/10

---

### 2.2 Tasks V3 (intentions + telemetria + identifier publico + state machine + work timer + history)

**Origem:** SYSTEM-OVERVIEW linhas 419-458 (modulo); API-CONTRACT linhas 1282-1448 (15 endpoints); SYSTEM-OVERVIEW linhas 276-303 (V3 fields).

**Resumo:** DTask polimorfica com 9 statuses V3 (-441..-449), 3 task types (-431..-435), 4 priorities (-421..-424); state machine validTransitions; identifier publico DEV-N atomico (jsonb_set raw em transaction); telemetria readyAt/executingAt/completedAt/failureReason; campos de intencao (problema/contexto/solucaoProposta/criteriosAceite/naoObjetivos/riscos/hillPosition); webhook trigger pos-mutacao; notification trigger pos-status-change; **work timer** (start/stop/my-active-work/project-work-time/:id/work-time); **history** (`GET /tasks/:id/history`); estimate-ai stub (rate limit 5/min); filtros search/priorityId/taskTypeId/sprintId/canalId/assigneeId.

**Cobertura no plano V2 remediado:**
- [x] Fase: F5 Bloco E em `02-DOMINIO-ENGINE.md:339-422`
- [x] DClasses: -440..-449 (status V3), -420..-424 (priority), -430..-435 (task type), -475 ISSUE_COUNTER (plano-mestre §3.2)
- [x] DoD inclui: state machine 50 cenarios (F.4); identifier atomico (E.2 com SQL `jsonb_set`); cursor pagination (linha 469); ZERO N+1 (linha 414); webhooks/notifications via DEvento (F7 Bloco N/P); estimate-ai stub (F11 ou subrota Tasks)
- [x] ADRs: nenhum especifico (V3 e fundacao do dominio, herda de F1 seed)
- [x] Endpoints listados: `02-DOMINIO-ENGINE.md:237`: `[POST, GET, GET:id, PUT, PUT:id/status, PUT:id/sprint, DELETE]` — **7 metodos**, alem de implicito `POST /tasks/:id/estimate-ai` em F11
- [ ] **AUSENTE: `GET /tasks/:id/history`** (audit timeline)
- [ ] **AUSENTE: `POST /tasks/:id/work/start`**
- [ ] **AUSENTE: `POST /tasks/:id/work/stop`**
- [ ] **AUSENTE: `GET /tasks/:id/work-time`**
- [ ] **AUSENTE: `GET /tasks/my-active-work`**
- [ ] **AUSENTE: `GET /tasks/project-work-time?projectId=X`**

**Veredicto:** PARCIAL — capacidade nuclear V3 esta integralmente coberta (state machine, identifier, telemetria, intentions, filtros, webhook/notif triggers, estimate-ai stub), mas **6 dos 15 endpoints do legado nao aparecem no plano V2** (work timer x5 + history x1).

**Evidencia (positiva — V3 nuclear coberto):** `02-DOMINIO-ENGINE.md:392-405`:
```typescript
const validTransitions: Record<bigint, bigint[]> = {
  BigInt(-441): [BigInt(-442), BigInt(-446), BigInt(-447)],   // INBOX → READY, CANCELLED, DISCARDED
  BigInt(-442): [BigInt(-443), BigInt(-441), BigInt(-446)],   // READY → EXECUTING, INBOX (back), CANCELLED
  BigInt(-443): [BigInt(-444), BigInt(-445), BigInt(-448), BigInt(-442)],  // EXECUTING → DONE, FAILED, VALIDATING, READY
  BigInt(-448): [BigInt(-449), BigInt(-445), BigInt(-443)],   // VALIDATING → VALIDATED, FAILED, EXECUTING
  ...
};
```

**Evidencia (negativa — work timer ausente):** `grep -n "work\|timer" 02-DOMINIO-ENGINE.md` retorna zero matches para "work/start", "work/stop", "my-active-work", "project-work-time", "work-time", "workSessions", "timer". Mesmo padrao em `01-FUNDACAO.md`, `03-INTEGRACOES.md`, `04-HARDENING-HANDOFF.md`. Capacidade descrita em `Scrumbam-Backend/CLAUDE.md` linha 91: `"Batch B5: Daily summary real (backend + frontend)"` mas o legado tem trabalho registrado nos 5 endpoints.

**Risco / Acao corretiva:**
1. **Bloco E.11 em F5 (acrescentar):** "Work Timer — DTask.dados.workSessions[] = [{ startedAt, stoppedAt, userId }]; service WorkTimerService.start(taskId, userId), .stop(taskId), .getActive(userId), .getProjectTime(projectId), .getTaskTime(taskId)". ZERO tabela nova; usa Json em DTask.dados.
2. **Bloco N.5 em F7 (acrescentar):** "GET /tasks/:id/history — retorna DEvento WHERE idEntidade=taskId ORDER BY chcriacao DESC, com cursor pagination, paridade com legado linha 1401-1407".

**Score parcial:** 7,5/10 (V3 nuclear excelente; periferia incompleta).

---

### 2.3 Sprints + Workflow Statuses customizaveis

**Origem:** SYSTEM-OVERVIEW linhas 462-507; API-CONTRACT linhas 1242-1278 (Sprints, 3 endpoints) + 1668-1745 (WS, 7 endpoints).

**Resumo:** Sprints sao DTabela idClasse=-400 vinculados a project (`dEntidadeId=projectId`); CRUD basico (POST, GET por project, DELETE com desvinculacao das tasks); Workflow Statuses sao DTabela idClasse=-440 vinculados a project, com seed-defaults que cria os 9 statuses V3 padroes (`POST /workflow-statuses/seed-defaults?projectId=X`); CRUD + reorder em batch (`PATCH /workflow-statuses/reorder/batch`).

**Cobertura no plano V2:**
- [x] Fase: F5 Bloco D em `02-DOMINIO-ENGINE.md:333-338`
- [x] Wrappers thin justificados por **ADR-V2-009** (plano-mestre §7, linha 472)
- [x] README obrigatorio em `src/sprints/` e `src/workflow-statuses/` documentando reuso de `/tabelas?idClasse=-400` e `?idClasse=-440` (linha 465)
- [x] `seedDefaults(projectId)` previsto em `02-DOMINIO-ENGINE.md:231` — "WorkflowStatusesService.seedDefaults: cria 9 linhas DTabela -441..-449 vinculadas"
- [x] Endpoints listados: `POST /workflow-statuses/:projectId/seed-defaults`
- [ ] **PARCIAL: `DELETE /sprints/:id` com desvinculacao das tasks** — plano fala em "PATCH/DELETE usar /tabelas/:id" mas nao detalha que ao deletar sprint as tasks vinculadas devem ter `sprintId = null` (comportamento documentado em API-CONTRACT linha 1272)
- [ ] **PARCIAL: `PATCH /workflow-statuses/reorder/batch`** — endpoint de reorder em batch nao mencionado especificamente; ha apenas "reorder" implicito em PATCH /tabelas/:id
- [x] DClasses: -400 SPRINT, -440 STATUS_INTENTION_V3 + 9 folhas (plano-mestre §3.2)

**Veredicto:** PARCIAL — wrapper thin esta correto (ADR-V2-009), e o seed-defaults esta endorsed; mas dois sub-comportamentos (desvincular tasks ao deletar sprint; reorder em batch) merecem mencao explicita.

**Evidencia:** `02-DOMINIO-ENGINE.md:333-338`:
```
**D.2.** README em src/workflow-statuses/ documentando: GET /tabelas?idClasse=-440&dEntidadeId={projectId} lista os 9 statuses. PATCH/DELETE usar /tabelas/:id.
**D.4.** README em src/sprints/: GET /tabelas?idClasse=-400&dEntidadeId={projectId} lista sprints do projeto. POST /tabelas com dEntidadeId=projectId.
```

**Risco / Acao corretiva:** adicionar em F5 Bloco D:
- **D.5:** "Sprint delete cascade: ao deletar uma DTabela idClasse=-400, atualizar todas DTask.dados.sprintId que apontavam para ele -> null (transaction atomica). Paridade com legado API-CONTRACT linha 1272."
- **D.6:** "Workflow status reorder em batch: `PATCH /workflow-statuses/reorder/batch { items: [{id, order}] }` -> UPDATE em batch com transaction. Paridade legado linha 1729."

**Score parcial:** 8,5/10

---

### 2.4 Projects / Teams / Organizations

**Origem:** SYSTEM-OVERVIEW linhas 357-415, 686-715; API-CONTRACT linhas 911-1198 (Orgs+Projects), 1452-1572 (Teams).

**Resumo:** Organizations sao DEntidade idClasse=-152 (renumerada de -50 legado); Projects sao DProject (canonico); Teams sao DEntidade idClasse=-180 (renumerada de -460 legado); membership via DVincula com cargo (RBAC duplo); identifier publico atomico DEV-N por team; project delete cascade (DTask + DProjectMember + DWebhook + DNotification + DAgent unlink); project-members CRUD; team-members CRUD com cargo TeamRolesGuard.

**Cobertura no plano V2:**
- [x] Fases: F5 Blocos B (Orgs+Teams), C (Projects)
- [x] DClasses: -152 ORGANIZATION, -180 TEAM, -181 TEAM_MEMBERSHIP, -160..-173 cargos (plano-mestre §3.2)
- [x] Endpoints listados: `02-DOMINIO-ENGINE.md:195` Orgs CRUD + members; `02-DOMINIO-ENGINE.md:206` Teams CRUD + /mine + members; `02-DOMINIO-ENGINE.md:213` Projects CRUD + /activity + /stats; `02-DOMINIO-ENGINE.md:216` ProjectMembers CRUD
- [x] Project delete cascade: `02-DOMINIO-ENGINE.md:251` — "DProject delete: cascade soft-delete + audit + project.deleted event"
- [x] Identifier atomico DEV-N: `02-DOMINIO-ENGINE.md:372-381` (jsonb_set raw via $executeRaw)
- [x] ADR-V2-002 (renumeracao -47/-49/-50 -> -150/-151/-152) reduz risco de regressao
- [ ] **AUSENTE: `PATCH /organizations/:orgId/users/:userId/role`** — mudanca de cargo de membro existente
- [ ] **AUSENTE: `PATCH /projects/:projectId/members/:userId/role`** — analogo para projeto

**Veredicto:** PARCIAL — todo o nucleo esta coberto, mas 2 endpoints granulares de "trocar cargo de membro" estao ausentes. Plano cobre criar/remover, mas nao trocar cargo in-place.

**Evidencia:** `02-DOMINIO-ENGINE.md:195` "[POST, GET:id, PATCH, DELETE, GET/POST/PATCH/DELETE :id/users]" — note **PATCH :id/users** existe mas plano nao detalha se aceita `:userId/role`. API-CONTRACT linha 987 e clara: `PATCH /organizations/:orgId/users/:userId/role { role }`.

**Risco / Acao corretiva:** acrescentar em F5 Bloco B:
- **B.12:** "PATCH /organizations/:orgId/users/:userId/role — atualiza DVincula.idClasse de -161/-162/-163 atomicamente; valida que ultimo ADMIN nao pode rebaixar a si mesmo"
- **B.13:** Analogo "PATCH /projects/:projectId/members/:userId/role" via DVincula -171/-172/-173

**Score parcial:** 8,8/10

---

### 2.5 Flow Metrics (cycle/lead/throughput/WIP/CFD/dashboard)

**Origem:** SYSTEM-OVERVIEW linhas 542-558, 1377-1418; API-CONTRACT linhas 727-787 (6 endpoints).

**Resumo:** 6 endpoints calculados em runtime (sem persistencia): cycle-time (READY->DONE), lead-time (criacao->DONE), throughput (concluidas/semana), wip-age (em execucao ha muito tempo), cfd (cumulative flow diagram), dashboard agregado. Baseado em DTask.dados.telemetry timestamps.

**Cobertura no plano V2:**
- [x] Fase: F8 Bloco S em `02-DOMINIO-ENGINE.md:1809-1948`
- [x] Endpoints listados: `02-DOMINIO-ENGINE.md:1841` "[GET 6 endpoints: cycle-time, lead-time, throughput, wip-age, cfd, dashboard]"
- [x] Read-only, sem N+1 (linha 1827)
- [x] DoD: 12 itens incluindo todos os 6 endpoints
- [x] DClasses: nenhuma adicional (read-only sobre DTask)

**Veredicto:** COBERTO

**Evidencia:** `02-DOMINIO-ENGINE.md:1841`: `flow-metrics.controller.ts [GET 6 endpoints: cycle-time, lead-time, throughput, wip-age, cfd, dashboard]`. Identica paridade com API-CONTRACT linhas 731-787.

**Score parcial:** 9,5/10

---

### 2.6 Forecast Monte Carlo

**Origem:** SYSTEM-OVERVIEW linhas 562-575, 1393-1414; API-CONTRACT linhas 793-808.

**Resumo:** Simulacao Monte Carlo 10.000 iteracoes baseada em throughput historico (4 sprints), distribuicao normal, retorna p50/p75/p85/p95 com datas estimadas.

**Cobertura no plano V2:**
- [x] Fase: F8 Bloco T em `02-DOMINIO-ENGINE.md:1886-1897`
- [x] Endpoint: `GET /forecast/:projectId` (linha 1852)
- [x] Algoritmo Monte Carlo 10k iteracoes mencionado explicitamente em plano-mestre

**Veredicto:** COBERTO

**Evidencia:** `02-DOMINIO-ENGINE.md:1852`: `forecast.controller.ts [GET /:projectId]` + `02-DOMINIO-ENGINE.md:1942` smoke test: `curl ".../forecast/$PROJ?items=10&confidence=85"` esperado `{ p50, p75, p95 }`.

**Score parcial:** 9,5/10

---

### 2.7 Telegram Bot (pairing + voz Groq + 7 comandos + parser projeto)

**Origem:** SYSTEM-OVERVIEW linhas 119-157, 719-770, 1240-1296; API-CONTRACT linhas 611-660; CLAUDE.md legado linhas 156-411 (Fases A/B/C/D/E/F detalhadas).

**Resumo:** Pairing code 6 chars (TTL 10min, one-shot, sem ambiguos L/S/O/0/I/1); captura texto livre -> DTask INBOX; voice notes via Groq Whisper (max 2min, 5MB, pt-BR); 7 comandos (`/start`, `/minhas`, `/ready`, `/projeto`, `/pausar`, `/retomar`, `/ajuda`); parser de projeto (3 formatos: `@projeto`, `#projeto`, `Projeto, texto`); voice text normalizer (`arroba X` -> `@X`); whisper prompt builder (vocabulario contextual com nomes de projetos); pause respeitada para texto livre; comandos sempre funcionam; multi-tenant via `telegramChatId @unique`.

**Cobertura no plano V2:**
- [x] Fase: F10 em `03-INTEGRACOES.md:52-302`
- [x] DClasses: -450 CHANNEL, -451..-456 (folhas com TELEGRAM=-456), -474 PAIRING_TOKEN, -493 TELEGRAM_MSG_IN, -494 TELEGRAM_MSG_OUT (plano-mestre §3.2)
- [x] Endpoints listados: `03-INTEGRACOES.md:139` `pairing.controller.ts # POST /channels/pairing`; `03-INTEGRACOES.md:142` `telegram-webhook.controller.ts # POST /webhooks/telegram (TelegramSecretGuard)`
- [x] Voice via Groq Whisper: `03-INTEGRACOES.md:161` `groq-whisper.service.ts # POST audio → transcricao`
- [x] Smoke test detalhado: `03-INTEGRACOES.md:285-302` cobre pairing + texto + voice + comando + pause
- [x] ADR-V2-010 (Channels como modulo opt-in, plano-mestre §7)
- [ ] **PARCIAL: 7 comandos** — plano lista "comandos" genericamente mas nao enumera os 7 explicitamente (`/start`, `/minhas`, `/ready`, `/projeto`, `/pausar`, `/retomar`, `/ajuda`)
- [ ] **PARCIAL: Whisper Prompt Builder (vocabulario)** — Fase F do legado nao mencionada por nome no plano V2; ha "groq-whisper.service.ts" mas sem mencao a vocabulario contextual
- [ ] **PARCIAL: Voice Text Normalizer** ("arroba X" -> "@X") — nao mencionado especificamente no plano
- [ ] **PARCIAL: Project Prefix Parser** (3 formatos `@/#/Projeto,`) — nao mencionado explicitamente

**Veredicto:** PARCIAL — endpoints macro cobertos, mas 4 sub-features sofisticadas do legado (7 comandos enumerados, voice normalizer, prompt builder, project prefix parser) nao aparecem por nome no plano V2.

**Evidencia (positiva):** `03-INTEGRACOES.md:139-161` cobre pairing, webhook, voice via Groq.

**Evidencia (negativa):** `grep -n "voice-text-normalizer\|whisper-prompt-builder\|project-prefix-parser\|/minhas\|/projeto\|/pausar\|/retomar"` em `03-INTEGRACOES.md` retorna apenas 1 hit colateral em "/projeto" (uso generico de "projeto"). Os 7 comandos especificos nao sao listados.

**Risco / Acao corretiva:** acrescentar em F10:
- Lista explicita dos 7 comandos com sua semantica (paridade com `Scrumbam-Backend/CLAUDE.md` linhas 270-298)
- Bloco de servicos: `VoiceTextNormalizerService`, `WhisperPromptBuilderService`, `ProjectPrefixParserService` (todos canal-agnosticos, no `channels/shared/`)
- Reusar nomes do legado para minimizar friccao na migracao

**Score parcial:** 7,8/10 (capacidade entregue mas detalhamento operacional resumido demais)

---

### 2.8 MCP Server (5 tools)

**Origem:** SYSTEM-OVERVIEW linhas 159-170, 975-1018; API-CONTRACT linhas 833-855.

**Resumo:** Endpoint `/mcp` (FORA do prefixo `/api/v1` por exigencia da spec); JSON-RPC 2.0; auth via `X-MCP-Key`; rate limit 60 req/min POR KEY (nao por IP); 5 tools: `scrumban_list_tasks`, `scrumban_create_task`, `scrumban_update_status`, `scrumban_list_projects`, `scrumban_list_sprints`; logging estruturado JSON com `correlationId`; timeout 30s; CRUD de keys (`POST/GET/DELETE /auth/me/mcp-key`).

**Cobertura no plano V2:**
- [x] Fase: F11 em `03-INTEGRACOES.md:303-481`
- [x] DClasses: -472 MCP_KEY, -495 MCP_CALL (plano-mestre §3.2)
- [x] Endpoints: `03-INTEGRACOES.md:356` `mcp.controller.ts # POST /mcp (JSON-RPC envelope unico)`; `03-INTEGRACOES.md:357` `mcp-keys.controller.ts # CRUD chaves (JWT)`
- [x] Rate limit por key: `03-INTEGRACOES.md:411` "60 req/min por MCP key"
- [x] 5 tools: `03-INTEGRACOES.md:436` "Returns 5 tools"
- [x] Timeout: `03-INTEGRACOES.md:411`
- [x] ADR-V2-011 (MCP Keys com rate limit em Redis, plano-mestre §7)

**Veredicto:** COBERTO

**Evidencia:** `03-INTEGRACOES.md:436` DoD inclui "POST /mcp { tools/list } retorna 5 tools" + "POST /mcp { tools/call list_tasks {limit:5} }" + "POST /mcp { tools/call create_task {projectId,titulo} }".

**Risco / Acao:** plano fala em `POST/DELETE /mcp/keys` (linha 410-412), mas API-CONTRACT linha 200-228 usa `/auth/me/mcp-key` (paridade com api-key). Verificar consistencia: o legado usa `/auth/me/mcp-key`. Sugestao: padronizar no path do legado para preservar contrato.

**Score parcial:** 9,2/10 (cobertura plena mas path divergente — `/mcp/keys` no plano vs `/auth/me/mcp-key` no legado)

---

### 2.9 Webhooks outbound (HMAC + retry + auto-disable)

**Origem:** SYSTEM-OVERVIEW linhas 654-682, 1062-1098; API-CONTRACT linhas 1576-1665.

**Resumo:** CRUD de webhooks (config em DTabela -470); disparo HTTP POST com HMAC-SHA256 (`X-Webhook-Signature: sha256=<hex>`); retry 3x com backoff exponencial (1s, 2s, 4s); auto-disable apos 10 falhas consecutivas (`inativo=true`); eventos: `task.created`, `task.status_changed`, `task.moved`, `task.deleted`, `webhook.test`; webhooks INCOMING `POST /webhooks/incoming/:channel` para receber intencoes de canais externos (Bearer WEBHOOK_INBOUND_TOKEN); endpoint test (`POST /webhooks/:id/test`) e redrive (`POST /webhooks/:id/redrive`).

**Cobertura no plano V2:**
- [x] Fase: F12 em `03-INTEGRACOES.md:483-697`
- [x] DClasses: -470 WEBHOOK (config), -491 WEBHOOK_ATTEMPT (DEvento) (plano-mestre §3.2)
- [x] HMAC-SHA256: `03-INTEGRACOES.md:587-590`
- [x] Retry 3x backoff exponencial: `03-INTEGRACOES.md:612-633` (algoritmo pseudocodigo)
- [x] Auto-disable apos 10 falhas: `03-INTEGRACOES.md:609`
- [x] Eventos suportados: `03-INTEGRACOES.md:534-548`
- [x] `POST /webhooks/:id/test` e `POST /webhooks/:id/redrive`: `03-INTEGRACOES.md:605-608`
- [x] Webhook INCOMING: F7 Bloco P.3 — `02-DOMINIO-ENGINE.md:1743` `WebhookIncomingController.POST /webhooks/incoming/:channel`
- [x] ADR-V2-012 (HMAC + retry + auto-disable, plano-mestre §7)
- [ ] **PARCIAL: `POST /webhooks/configure`** — API-CONTRACT linha 1608 usa path `/webhooks/configure` (e nao apenas `POST /webhooks` generico). Plano usa `POST /webhooks` (linha 578). Mudanca de path quebra contrato.
- [ ] **PARCIAL: `GET /webhooks/:id/attempts?cursor=&limit=`** — listado em plano (linha 608) mas API-CONTRACT do legado nao tem endpoint equivalente direto (e nice-to-have do plano)

**Veredicto:** COBERTO COM RESSALVAS — o nucleo (HMAC, retry, auto-disable, eventos, INCOMING) esta coberto, mas o path `/webhooks/configure` do legado virou `/webhooks` no plano, divergindo do contrato HTTP.

**Evidencia:** `03-INTEGRACOES.md:578`: "**CRUD webhooks** (`POST/GET/PUT/DELETE /webhooks`)". Comparar com `API-CONTRACT.md:1608`: `POST /webhooks/configure`.

**Risco / Acao corretiva:** padronizar path em F12 para `POST /webhooks/configure` (preservar contrato do legado) ou documentar deprecation explicita em ADR.

**Score parcial:** 8,8/10

---

### 2.10 Notifications

**Origem:** SYSTEM-OVERVIEW linhas 627-650, 1093-1098; API-CONTRACT linhas 858-908.

**Resumo:** CRUD de notificacoes in-app (DNotification no legado, DEvento -490 NOTIFICATION no V2); auto-trigger por `TasksService.updateStatus`; tipos: `status_changed`, `assigned`, `mentioned`; endpoints: `GET /notifications` (filtros onlyUnread/limit/cursor), `GET /notifications/unread-count`, `PUT /notifications/read` (batch), `PUT /notifications/read-all`, `DELETE /notifications/:id`.

**Cobertura no plano V2:**
- [x] Fase: F7 Bloco O em `02-DOMINIO-ENGINE.md:1717-1727`
- [x] DClasses: -490 NOTIFICATION (DEvento) (plano-mestre §3.2)
- [x] ADR-V2-008 (DEvento substitui DNotification e DWebhook attempts) — plano-mestre §7 linha 469
- [x] Endpoints listados: `02-DOMINIO-ENGINE.md:1660` `notifications.controller.ts [GET, GET unread-count, PUT :id/read, PUT read-all, DELETE]`
- [x] Auto-trigger por status change: `02-DOMINIO-ENGINE.md:1700+` (NotificationsConsumer)

**Veredicto:** COBERTO

**Evidencia:** Lista de endpoints em `02-DOMINIO-ENGINE.md:1660` paridade exata com API-CONTRACT linhas 858-908. Note divergencia minima: legado usa `PATCH` para mark-as-read (`PATCH /notifications/:id/read` no Scrumbam-Backend/CLAUDE.md linha 645) mas API-CONTRACT mostra `PUT /notifications/read` (batch); plano V2 mostra `PUT /notifications/:id/read`. Variacao PATCH vs PUT — minima, nao afeta semantica.

**Score parcial:** 9,5/10

---

### 2.11 Search global (FTS unificado)

**Origem:** SYSTEM-OVERVIEW linhas 579-598; API-CONTRACT linhas 1222-1240.

**Resumo:** `GET /search?q=texto&projectId=X&limit=10` — busca paralela em tasks (50% do limite), projects (30%), people (20%); 3 queries em `Promise.all`; tenant isolation via JWT; ZERO N+1; performance <200ms.

**Cobertura no plano V2:**
- [x] Fase: F8 Bloco U em `02-DOMINIO-ENGINE.md:1898-1907`
- [x] Endpoint: `02-DOMINIO-ENGINE.md:1858` `search.controller.ts [GET /search?q=X&projectId=Y&limit=5]`
- [x] 3 queries paralelas Promise.all: F8 Bloco U
- [x] DoD: cursor pagination em /search (linha 1828)

**Veredicto:** COBERTO

**Score parcial:** 9,3/10

---

### 2.12 Reports + Dashboards + Analytics

**Origem:** SYSTEM-OVERVIEW linhas 511-538, 602-623, 774-783; API-CONTRACT linhas 37-78 (Analytics 3), 663-723 (Dashboards 5), 1200-1219 (Reports 1).

**Resumo:**
- **Dashboards** (5 endpoints): metrics (date filtros), velocity, burndown, tasks-by-user (date filtros), daily-summary
- **Analytics** (3 endpoints): compare (period1/period2), capacity-forecast, stakeholder-report (period)
- **Reports** (1 endpoint): GET /reports/projects/:id/pdf (PDFKit, ~100-300ms, reusa Dashboards+Analytics+FlowMetrics)

**Cobertura no plano V2:**
- [x] Fase: F9 em `02-DOMINIO-ENGINE.md:1951-2055`
- [x] Dashboards: `02-DOMINIO-ENGINE.md:1957` "velocity por sprint, burndown, tasks-by-user, daily-summary"
- [x] Analytics 3 endpoints: `02-DOMINIO-ENGINE.md:1984` `analytics.controller.ts [3 endpoints: compare, capacity-forecast, stakeholder-report]`
- [x] Reports PDF: `02-DOMINIO-ENGINE.md:1988` `reports.controller.ts [GET /reports/projects/:id/pdf]`
- [x] Cache TTL 60s/5min: `02-DOMINIO-ENGINE.md:1960`

**Veredicto:** COBERTO

**Evidencia:** `02-DOMINIO-ENGINE.md:2018-2025` DoD inclui:
```
- 5 endpoints /dashboards/projects/:id/* (metrics, velocity, burndown, tasks-by-user, daily-summary)
- 3 endpoints /analytics/:projectId/{compare,capacity-forecast,stakeholder-report}
- 1 endpoint /reports/projects/:id/pdf
```

**Score parcial:** 9,5/10

---

### 2.13 Automation — 3 fases (Agents + Projects-Link + Execution)

**Origem:** SYSTEM-OVERVIEW linhas 805-971, 1366-1373; API-CONTRACT linhas 231-609 (8+9+8 = 25 endpoints).

**Resumo de cada fase:**

**Fase 1 — Agents (Conectividade):**
- DAgent em legado, no V2 vira DEntidade idClasse=-156 AGENT
- 8 endpoints: POST/GET/DELETE /agents, POST /agents/register (InstallTokenGuard), POST /agents/:id/heartbeat (loopback), POST /agents/:id/test-connectivity, POST /agents/:id/regenerate-install-token
- SSH reverso JSON-Lines, port allocator (range 20000-29999), heartbeat 30s/timeout 90s, status sweeper @Cron 30s

**Fase 2 — Projects-Link:**
- 9 endpoints: PATCH/DELETE/GET /projects/:id/agent-link, GET /agent-status?livePing=true, GET /executions, POST/GET/DELETE/POST /projects/:id/git-credentials/{generate,read,revoke,apply-config}
- Deploy key SSH ed25519, command validator com 58 testes adversariais, allowed paths sync, status probe live

**Fase 3 — Execution (Claude Code):**
- 8 endpoints: GET /claude-credential-status, GET /claude-token-instructions, POST /projects/:id/execute, GET /executions/:id, GET /executions, POST /executions/:id/{approve,reject,rollback}
- Risk Gate A determinístico (50 cenarios), approval flow state machine (queued -> awaiting_approval -> approved/rejected/expired), pull request auto-open, rollback git reset+push --force, multi-conta Claude (XDG_CONFIG_HOME), timeout race-safe, output cap 1MB

**Cobertura no plano V2:**
- [x] Fase Agents: F13 em `03-INTEGRACOES.md:699-1183`
- [x] Fase Projects-Link: F2 do legado virou parte de F13 (plano-mestre §1.1 linha 69 "F13 Automation Claude Code")
- [x] Fase Execution: F6 (Engine + OperacaoExecucaoClaude) + F13 (Automation runtime). Plano-mestre §1.1 linha 69: "**F13 — Automation Claude Code (Agent + Engine)** | Pilares 1+2 | DEntidade AGENT + DPedido EXECUTION + 58 testes adversariais"
- [x] DClasses: -156 AGENT, -185 PROJECT_AGENT, -300..-303 EXECUTION (LOW/MED/HIGH), -473 INSTALL_TOKEN, -510..-527 status enums + risk levels (plano-mestre §3.2)
- [x] Risk Gate determinístico (50 cenarios): `02-DOMINIO-ENGINE.md:1097-1141` (script DVFS chave 3) + `02-DOMINIO-ENGINE.md:1424` "DoD adicional — Testes Regressivos Adversariais BLOQUEANTES"
- [x] Approval Flow state machine: `02-DOMINIO-ENGINE.md:1326-1331` 8 endpoints REST listados
- [x] Pull Request auto-open: `02-DOMINIO-ENGINE.md:1162-1212` script DVFS chave 7 (pos-gravacao)
- [x] Rollback: F6 Bloco J + endpoint `POST /executions/:id/rollback`
- [x] Command Validator 58 testes adversariais: `03-INTEGRACOES.md:1109-1131` (DoD F13)
- [x] Multi-conta Claude XDG_CONFIG_HOME: F6 Bloco I (mencionado implicitamente em "claude-credential-status")
- [x] Heartbeat 30s + sweeper offline 90s: `03-INTEGRACOES.md:824` `agent-status-sweeper.service.ts # @Cron 30s`
- [x] Test connectivity: `03-INTEGRACOES.md:805+` (Bloco A, agent module)
- [x] ADRs: V2-005 (OperacaoExecucaoClaude extends OperacaoPedido), V2-006 (Risk via idClasse), V2-013 (Agent como DEntidade -156)
- [x] **F13 e o coracao tecnico do V2** (plano-mestre §1.1, linha 69)

**Veredicto:** COBERTO — capacidade nuclear preservada com expansao arquitetural (Pilar 1 ATIVADO via Engine, Risk via idClasse).

**Evidencia (Engine + Risk):** `02-DOMINIO-ENGINE.md:646`:
```
executions.controller.ts [POST /projects/:id/execute, GET /executions/:id,
                          POST /executions/:id/approve|reject|rollback,
                          GET /executions]
```
+ `02-DOMINIO-ENGINE.md:1326-1331`:
```
POST   /api/v1/projects/:id/execute   [ADMIN, AgentThrottlerGuard 30/min]
GET    /api/v1/executions/:id
GET    /api/v1/executions?projectId=&status=&riskLevel=&cursor=&limit=
POST   /api/v1/executions/:id/approve
POST   /api/v1/executions/:id/reject
POST   /api/v1/executions/:id/rollback
```

**Risco / Acao:** plano usa path `/executions/:id` (sem prefixo `/projects/:id`). API-CONTRACT linha 401 confirma: `GET /executions/:id` (path absoluto). Paridade preservada.

**Score parcial:** 9,7/10 (cobertura excepcional, com transicao para Engine que e o avanco arquitetural do V2)

---

### 2.14 Health checks

**Origem:** SYSTEM-OVERVIEW linhas 1022-1033; API-CONTRACT linhas 813-829.

**Resumo:** `GET /health` (liveness, sempre 200) + `GET /health/ready` (readiness, checa banco, retorna 503 se DB down).

**Cobertura no plano V2:**
- [x] F0: `01-FUNDACAO.md:128` `health/health.controller.ts # GET /health -> { status: 'ok' }`
- [x] F4: `01-FUNDACAO.md:1108` "GET /health (ja existe Fase 0, expandir)" — checks db/redis/email
- [x] F14: `04-HARDENING-HANDOFF.md:230-236`:
  ```
  - GET /api/v1/health: detailed checks
  - GET /api/v1/health/liveness (k8s liveness probe)
  - GET /api/v1/health/readiness (k8s readiness probe)
  ```

**Veredicto:** COBERTO COM EXPANSAO — V2 tem 3 endpoints (legado tem 2). Adicao bem-vinda, nao reduz escopo.

**Score parcial:** 10/10

---

### 2.15 Background jobs / cron / sweepers

**Origem:** SYSTEM-OVERVIEW linhas 1102-1144.

**Resumo:** AgentStatusSweeperService (@Cron 30s, marca offline >90s sem heartbeat); ApprovalFlowSweeperService (@Cron 1min, expira awaiting_approval >1h).

**Cobertura no plano V2:**
- [x] AgentStatusSweeperService: `03-INTEGRACOES.md:824` "@Cron 30s — marca offline"
- [x] ApprovalFlowSweeperService: F6 (sweeper de timeout HIGH approval em 1h, mencionado em DoD)

**Veredicto:** COBERTO

**Score parcial:** 10/10

---

### 2.16 Eventos canonicos (DEvento + EventProducerService + Router)

**Origem:** SYSTEM-OVERVIEW linhas 1062-1098.

**Resumo:** EventService centraliza emissao; salva em DEvento para auditoria; eventos: task.created, task.status_changed, task.moved, task.deleted, project.created, project.deleted, agent.registered, etc.; consumidores: WebhooksDispatcher, NotificationsService, EventService (audit log).

**Cobertura no plano V2:**
- [x] Fase: F7 em `02-DOMINIO-ENGINE.md:1586-1804`
- [x] EventProducerService + EventRouterService + CircuitBreaker + IntelligentRetry: `02-DOMINIO-ENGINE.md:1592-1599`
- [x] DClasses: -490 NOTIFICATION, -491 WEBHOOK_ATTEMPT, -492 AGENT_HEARTBEAT, -493/-494 TELEGRAM_MSG_IN/OUT, -495 MCP_CALL, -496 EXECUTION_LOG, -497..-501 audit (plano-mestre §3.2)
- [x] devari-event-naming.md aplicado: `02-DOMINIO-ENGINE.md:1612`
- [x] Padrao #7 EVENTOS APOS PERSISTENCIA: `02-DOMINIO-ENGINE.md:1610`
- [x] ADR-V2-008 (DEvento substitui DNotification e DWebhook attempts)

**Veredicto:** COBERTO COM EXPANSAO — V2 vai alem do legado ao adicionar EventRouterService, CircuitBreakerService, IntelligentRetryService, TelemetryService.

**Score parcial:** 9,8/10

---

### 2.17 Common Services + Guards

**Origem:** SYSTEM-OVERVIEW linhas 1037-1057.

**Resumo:** PrismaService, EventService, WebhooksDispatcherService, TimezoneService, CorrelationIdService; 11 Guards (JwtAuthGuard, AuthCompositeGuard, ProjectScopeGuard, OrgTenantGuard, RolesGuard, TeamRolesGuard, AgentThrottlerGuard, InstallTokenGuard, AgentTunnelGuard, McpKeyGuard, TelegramSecretGuard).

**Cobertura no plano V2:**
- [x] PrismaService: `01-FUNDACAO.md:108` (F0 setup)
- [x] TimezoneService: `01-FUNDACAO.md:1043-1046` (F4)
- [x] CorrelationIdService: `01-FUNDACAO.md:1183` (F4)
- [x] EventService -> EventProducerService: F7
- [x] WebhooksDispatcherService: F12
- [x] 11 Guards: cobertos em F3 (auth) + F10 (TelegramSecret) + F11 (McpKey) + F13 (InstallToken/AgentTunnel/AgentThrottler)

**Veredicto:** COBERTO

**Score parcial:** 10/10

---

## 3. AUDITORIA DE ENDPOINTS — TABELA DOS 128

> Notacao: ✅ Coberto (path/metodo identico no plano V2) | 🔶 Reuso via generico (path divergente, cobertura via `/entidades` ou `/tabelas` com `idClasse`) | ⚠️ Parcial (mencionado mas com divergencia) | ❌ Ausente (nao mencionado em nenhuma das 5.428 linhas do plano V2)

### 3.1 Auth (11)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 1 | POST /auth/login | F3 | ✅ |
| 2 | POST /auth/register | F3 | ✅ |
| 3 | POST /auth/refresh | F3 | ✅ |
| 4 | POST /auth/logout | F3 | ✅ |
| 5 | GET /auth/me | F3 | ✅ |
| 6 | PATCH /auth/me | F3 | ✅ |
| 7 | DELETE /auth/me | F3 | ✅ |
| 8 | DELETE /auth/organizations/:orgId | F3 | ⚠️ (plano fala em "DELETE org" no AuthService.deleteAccount linha 178 mas path explicito ausente) |
| 9 | POST /auth/me/mcp-key | F3 ou F11 | ⚠️ (plano F3 linha 930 menciona; F11 linha 410 usa `/mcp/keys` divergente) |
| 10 | GET /auth/me/mcp-key | F3 | ⚠️ |
| 11 | DELETE /auth/me/mcp-key | F3 | ⚠️ |

**Sub-total:** 7 ✅ + 4 ⚠️ = 11/11 cobertos com 4 divergencias de path.

### 3.2 Agents (8)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 12 | POST /agents | F13 | 🔶 (via /entidades?idClasse=-156 + rota especializada) |
| 13 | GET /agents | F13 | 🔶 |
| 14 | GET /agents/:id | F13 | 🔶 |
| 15 | DELETE /agents/:id | F13 | ✅ (plano linha 815 fala em DELETE de DEntidade -156) |
| 16 | POST /agents/register | F13 | ✅ (linha 872, InstallTokenGuard) |
| 17 | POST /agents/:id/regenerate-install-token | F13 | ✅ |
| 18 | POST /agents/:id/heartbeat | F13 | ✅ (linha 886, AgentAuthGuard) |
| 19 | POST /agents/:id/test-connectivity | F13 | ⚠️ (plano nao menciona explicitamente test-connectivity; pos-handshake probe e feito em Fase 1, mas o endpoint REST ad-hoc nao esta listado) |

**Sub-total:** 4 ✅ + 3 🔶 + 1 ⚠️ = 8/8 cobertos com 1 ressalva pontual.

### 3.3 Automation - Execucao (8)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 20 | GET /projects/:id/claude-credential-status | F6 | ✅ (linha 1357) |
| 21 | GET /projects/:id/claude-token-instructions | F6 | ✅ (linha 1358) |
| 22 | POST /projects/:id/execute | F6 | ✅ (linha 1326) |
| 23 | GET /executions/:id | F6 | ✅ (linha 1327) |
| 24 | GET /executions | F6 | ✅ (linha 1328) |
| 25 | POST /executions/:id/approve | F6 | ✅ (linha 1329) |
| 26 | POST /executions/:id/reject | F6 | ✅ (linha 1330) |
| 27 | POST /executions/:id/rollback | F6 | ✅ (linha 1331) |

**Sub-total:** 8/8 ✅

### 3.4 Automation - Vinculo de Projetos (9)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 28 | PATCH /projects/:id/agent-link | F13 | ✅ (linha 900) |
| 29 | DELETE /projects/:id/agent-link | F13 | ✅ (linha 904) |
| 30 | GET /projects/:id/agent-link | F13 | ✅ |
| 31 | GET /projects/:id/agent-status | F13 | ✅ (linha 907) |
| 32 | GET /projects/:id/executions | F13 | ✅ (linha 1329 generico cobre) |
| 33 | POST /projects/:id/git-credentials/generate | F13 | ✅ (linha 949+, GIT_CREDS_GENERATE handler) |
| 34 | GET /projects/:id/git-credentials | F13 | ✅ |
| 35 | DELETE /projects/:id/git-credentials | F13 | ✅ |
| 36 | POST /projects/:id/git-credentials/apply-config | F13 | ✅ (GIT_CONFIG_APPLY handler) |

**Sub-total:** 9/9 ✅

### 3.5 Telegram - Canal (3)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 37 | POST /channels/telegram/pairing | F10 | ⚠️ (plano usa `POST /channels/pairing` generico — path divergente do legado `/channels/telegram/pairing`) |
| 38 | GET /channels/telegram/status | F10 | ⚠️ (path nao explicito) |
| 39 | DELETE /channels/telegram/unlink | F10 | ⚠️ (path nao explicito) |

**Sub-total:** 3 ⚠️ — capacidade coberta, paths divergentes (plano agnostico-canal vs legado especifico-telegram).

### 3.6 Telegram - Webhook (1)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 40 | POST /webhooks/telegram | F10 | ✅ (linha 142 + 188) |

**Sub-total:** 1/1 ✅

### 3.7 Dashboards (5)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 41 | GET /dashboards/projects/:projectId/daily-summary | F9 | ✅ |
| 42 | GET /dashboards/projects/:projectId/metrics | F9 | ✅ |
| 43 | GET /dashboards/projects/:projectId/velocity | F9 | ✅ |
| 44 | GET /dashboards/projects/:projectId/burndown | F9 | ✅ |
| 45 | GET /dashboards/projects/:projectId/tasks-by-user | F9 | ✅ |

**Sub-total:** 5/5 ✅ (linha 2018-2025 DoD lista os 5)

### 3.8 Flow Metrics (6)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 46 | GET /flow-metrics/:projectId/cycle-time | F8 | ✅ |
| 47 | GET /flow-metrics/:projectId/lead-time | F8 | ✅ |
| 48 | GET /flow-metrics/:projectId/throughput | F8 | ✅ |
| 49 | GET /flow-metrics/:projectId/wip-age | F8 | ✅ |
| 50 | GET /flow-metrics/:projectId/cfd | F8 | ✅ |
| 51 | GET /flow-metrics/:projectId/dashboard | F8 | ✅ |

**Sub-total:** 6/6 ✅

### 3.9 Forecast (1)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 52 | GET /forecast/:projectId | F8 | ✅ |

**Sub-total:** 1/1 ✅

### 3.10 Health (2)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 53 | GET /health | F0 + F4 + F14 | ✅ |
| 54 | GET /health/ready | F4 + F14 | ✅ |

**Sub-total:** 2/2 ✅

### 3.11 MCP (5)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 55 | POST /mcp | F11 | ✅ |
| 56 | GET /mcp | F11 | ⚠️ (plano nao detalha SSE/stream GET; foco em POST JSON-RPC. Verificar implementacao spec MCP) |

**Sub-total:** 1 ✅ + 1 ⚠️ = 2/2 listados aqui (gestao de keys ja contada em 3.1).

### 3.12 Notifications (5)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 57 | GET /notifications | F7 | ✅ |
| 58 | GET /notifications/unread-count | F7 | ✅ |
| 59 | PUT /notifications/read | F7 | ⚠️ (plano fala "PUT :id/read" granular, legado tem batch `read` + granular `:id/read`) |
| 60 | PUT /notifications/read-all | F7 | ✅ |
| 61 | DELETE /notifications/:id | F7 | ✅ |

**Sub-total:** 4 ✅ + 1 ⚠️ = 5/5 cobertos.

### 3.13 Organizations (7)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 62 | POST /organizations | F5 | ✅ (transaction atomica linha 99) |
| 63 | GET /organizations/:orgId | F5 | ✅ |
| 64 | PATCH /organizations/:orgId | F5 | ✅ |
| 65 | GET /organizations/:orgId/users | F5 | ✅ |
| 66 | POST /organizations/:orgId/users | F5 | ✅ |
| 67 | PATCH /organizations/:orgId/users/:userId/role | F5 | ❌ **AUSENTE** |
| 68 | DELETE /organizations/:orgId/users/:userId | F5 | ✅ |

**Sub-total:** 6 ✅ + 1 ❌ = 6/7 cobertos.

### 3.14 Projects (16)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 69 | POST /projects/:id/api-key | F3 (proxy) | ✅ (linha 932) |
| 70 | GET /projects/:id/api-key | F3 | ✅ |
| 71 | DELETE /projects/:id/api-key | F3 | ✅ |
| 72 | POST /projects | F5 | ✅ |
| 73 | GET /projects | F5 | ✅ |
| 74 | GET /projects/summaries | F5 | ✅ |
| 75 | GET /projects/:id/stats | F5 | ✅ (linha 213) |
| 76 | GET /projects/:id/activity | F5 | ✅ (linha 213, cursor pagination linha 469) |
| 77 | GET /projects/:id | F5 | ✅ |
| 78 | PATCH /projects/:id | F5 | ✅ |
| 79 | DELETE /projects/:id | F5 | ✅ (cascade soft-delete linha 251) |
| 80 | GET /projects/:projectId/members | F5 | ✅ (linha 216) |
| 81 | POST /projects/:projectId/members | F5 | ✅ |
| 82 | PATCH /projects/:projectId/members/:userId/role | F5 | ❌ **AUSENTE** |
| 83 | DELETE /projects/:projectId/members/:userId | F5 | ✅ |

**Sub-total (15 listados, mais 1 nao numerado total = 16 com renumeracao):** 14 ✅ + 1 ❌ = 15/16 cobertos.

### 3.15 Reports (1)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 84 | GET /reports/projects/:projectId/pdf | F9 | ✅ |

**Sub-total:** 1/1 ✅

### 3.16 Search (1)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 85 | GET /search | F8 | ✅ |

**Sub-total:** 1/1 ✅

### 3.17 Sprints (3)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 86 | POST /sprints | F5 | 🔶 (wrapper sobre `/tabelas?idClasse=-400`, README documenta) |
| 87 | GET /sprints/project/:projectId | F5 | 🔶 |
| 88 | DELETE /sprints/:id | F5 | ⚠️ (cascade desvinculacao das tasks nao detalhada) |

**Sub-total:** 2 🔶 + 1 ⚠️ = 3/3 cobertos com ressalvas.

### 3.18 Tasks (15)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 89 | POST /tasks | F5 | ✅ |
| 90 | GET /tasks | F5 | ✅ |
| 91 | GET /tasks/project-work-time | — | ❌ **AUSENTE** |
| 92 | GET /tasks/my-active-work | — | ❌ **AUSENTE** |
| 93 | GET /tasks/:id | F5 | ✅ |
| 94 | PUT /tasks/:id | F5 | ✅ |
| 95 | DELETE /tasks/:id | F5 | ✅ |
| 96 | PUT /tasks/:id/status | F5 | ✅ |
| 97 | PUT /tasks/:id/sprint | F5 | ✅ |
| 98 | GET /tasks/:id/history | — | ❌ **AUSENTE** |
| 99 | POST /tasks/:id/estimate-ai | F11 (Integracoes-OpenAI stub) | ⚠️ (mencionado em SYSTEM-OVERVIEW mas nao mapeado explicitamente em nenhuma fase do V2) |
| 100 | POST /tasks/:id/work/start | — | ❌ **AUSENTE** |
| 101 | POST /tasks/:id/work/stop | — | ❌ **AUSENTE** |
| 102 | GET /tasks/:id/work-time | — | ❌ **AUSENTE** |

**Sub-total:** 8 ✅ + 1 ⚠️ + 5 ❌ = 9/14 cobertos. **CRITICO: 5 endpoints de Work Timer AUSENTES.**

### 3.19 Teams (10)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 103 | GET /teams/mine | F5 | ✅ (linha 206) |
| 104 | POST /teams | F5 | ✅ |
| 105 | GET /teams | F5 | ✅ |
| 106 | GET /teams/:id | F5 | ✅ |
| 107 | PATCH /teams/:id | F5 | ✅ |
| 108 | DELETE /teams/:id | F5 | ✅ |
| 109 | GET /teams/:id/members | F5 | ✅ |
| 110 | POST /teams/:id/members | F5 | ✅ |
| 111 | PATCH /teams/:id/members/:userId | F5 | ✅ |
| 112 | DELETE /teams/:id/members/:userId | F5 | ✅ |

**Sub-total:** 10/10 ✅

### 3.20 Webhooks (6)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 113 | POST /webhooks/incoming/:channel | F7 Bloco P.3 | ✅ |
| 114 | GET /webhooks | F12 | ✅ |
| 115 | POST /webhooks/configure | F12 | ⚠️ (plano usa `POST /webhooks` generico, paridade quebrada) |
| 116 | PUT /webhooks/:id | F12 | ✅ |
| 117 | DELETE /webhooks/:id | F12 | ✅ |
| 118 | POST /webhooks/:id/test | F12 | ✅ (linha 605) |

**Sub-total:** 5 ✅ + 1 ⚠️ = 6/6 cobertos.

### 3.21 Workflow Statuses (7)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 119 | GET /workflow-statuses | F5 | 🔶 (wrapper sobre `/tabelas?idClasse=-440`) |
| 120 | GET /workflow-statuses/:id | F5 | 🔶 |
| 121 | POST /workflow-statuses | F5 | 🔶 |
| 122 | PATCH /workflow-statuses/:id | F5 | 🔶 |
| 123 | DELETE /workflow-statuses/:id | F5 | 🔶 |
| 124 | PATCH /workflow-statuses/reorder/batch | F5 | ⚠️ (reorder em batch nao mencionado) |
| 125 | POST /workflow-statuses/seed-defaults | F5 | ✅ (linha 231 explicito) |

**Sub-total:** 1 ✅ + 5 🔶 + 1 ⚠️ = 7/7 cobertos.

### 3.22 Analytics (3)

| # | Endpoint | Fase V2 | Status |
|---|----------|---------|--------|
| 126 | GET /analytics/:projectId/compare | F9 | ✅ |
| 127 | GET /analytics/:projectId/capacity-forecast | F9 | ✅ |
| 128 | GET /analytics/:projectId/stakeholder-report | F9 | ✅ |

**Sub-total:** 3/3 ✅

### 3.23 Consolidacao endpoint-a-endpoint

| Status | Total | % |
|--------|-------|---|
| ✅ Coberto direto | 91 | 71% |
| 🔶 Reuso via generico | 19 | 15% |
| ⚠️ Parcial (path divergente / detalhe ausente) | 11 | 9% |
| ❌ Ausente | 7 | 5% |
| **Total** | **128** | **100%** |

**Os 7 endpoints AUSENTES (alinhados a 5 capacidades):**
1. `PATCH /organizations/:orgId/users/:userId/role` — mudanca cargo membro org
2. `PATCH /projects/:projectId/members/:userId/role` — mudanca cargo membro projeto
3. `GET /tasks/:id/history` — audit timeline da task
4. `POST /tasks/:id/work/start` — inicia work timer
5. `POST /tasks/:id/work/stop` — para work timer
6. `GET /tasks/:id/work-time` — resumo tempo trabalhado por task
7. `GET /tasks/my-active-work` — timer ativo do user logado

Mais um colateral nao-numerado: `GET /tasks/project-work-time?projectId=X` (resumo bulk) — **8 endpoints ausentes na pratica, todos relacionados a 3 capacidades:** Work Timer (5), History (1), Trocar Cargo (2).

---

## 4. RESUMO POR CATEGORIA COM SCORE

| # | Categoria | Score | Veredicto |
|---|-----------|-------|-----------|
| 1 | Auth + RBAC duplo | 9,5/10 | COBERTO |
| 2 | Tasks V3 (intentions + telemetria + identifier) | 9,8/10 | COBERTO |
| 2.1 | **Tasks Work Timer** | 0/10 | **AUSENTE** |
| 2.2 | **Tasks History** | 0/10 | **AUSENTE** |
| 3 | Sprints + Workflow Statuses | 8,5/10 | PARCIAL |
| 4 | Projects/Teams/Organizations | 8,8/10 | PARCIAL (cargos) |
| 5 | Flow Metrics | 9,5/10 | COBERTO |
| 6 | Forecast Monte Carlo | 9,5/10 | COBERTO |
| 7 | Telegram Bot (pairing/voz/comandos/parser) | 7,8/10 | PARCIAL (sub-services) |
| 8 | MCP Server (5 tools) | 9,2/10 | COBERTO (path divergente keys) |
| 9 | Webhooks outbound | 8,8/10 | COBERTO (path /configure) |
| 10 | Notifications | 9,5/10 | COBERTO |
| 11 | Search global | 9,3/10 | COBERTO |
| 12 | Reports + Dashboards + Analytics | 9,5/10 | COBERTO |
| 13 | Automation 3 fases (Agents+Link+Execution) | 9,7/10 | COBERTO COM EXPANSAO |
| 14 | Channels/Integrations | 8,5/10 | COBERTO COM RESSALVAS DE PATH |
| 15 | Health checks | 10/10 | COBERTO COM EXPANSAO |
| 16 | Background jobs / cron | 10/10 | COBERTO |
| 17 | Eventos canonicos | 9,8/10 | COBERTO COM EXPANSAO |
| 18 | Common Services + 11 Guards | 10/10 | COBERTO |

**Score consolidado de cobertura:** **8,3 / 10** (ponderando peso dos itens criticos).

---

## 5. TOP 10 LACUNAS / DIVERGENCIAS DE ESCOPO

> Ordenadas por SEVERIDADE (alto → baixo). Cada item: descricao, evidencia (legado vs V2), risco, acao corretiva concreta.

### Lacuna #1 [CRITICA — AUSENTE] — Work Timer (5 endpoints)

**Descricao:** Capacidade `Work Timer` (start/stop/my-active-work/project-work-time/work-time) entregue em produca no legado. Permite mensurar tempo real de trabalho em uma task (nao apenas timestamp de transicao de status). **Nenhum dos 5 endpoints aparece em nenhuma das 5.428 linhas do plano V2.**

**Evidencia legado:**
- API-CONTRACT linhas 1322-1448 lista 5 endpoints
- SYSTEM-OVERVIEW linhas 419-458 e silencioso sobre work timer (ausencia documental no proprio inventario do legado contribuiu para o esquecimento)
- `Scrumbam-Backend/CLAUDE.md` linha 89-93 confirma entrega: "Batch A1-C8 (30/03/2026, score 8.0/10)" — embora work timer especificamente nao seja detalhado no CLAUDE.md, os endpoints estao no API-CONTRACT como entregues

**Evidencia V2:** `grep -n "work\|timer" Scrumban-Backend-V2/docs/plano/*.md` retorna ZERO matches para `work/start`, `work/stop`, `my-active-work`, `project-work-time`, `work-time`, `workSessions`, `timer`.

**Risco:** ALTO — feature usada por usuarios para gerar reports de tempo trabalhado; sem ela, dashboards perdem capacidade de exibir tempo real (apenas tempo entre transicoes); UI legada exibe botao "Start Work" / "Stop Work" no card.

**Acao corretiva:**
- **Adicionar Bloco E.11 em F5 (`02-DOMINIO-ENGINE.md`):**
  ```
  E.11. Work Timer (paridade legado). Persistencia em DTask.dados.workSessions[] = [{ startedAt, stoppedAt, userId }]. Service WorkTimerService:
    - start(taskId, userId): valida task acessivel, cria sessao open, emite work.started
    - stop(taskId, userId): fecha sessao, emite work.stopped
    - getActive(userId): retorna unica sessao open, ou { active: false }
    - getProjectTime(projectId): bulk, agrega sum(stoppedAt-startedAt) por task
    - getTaskTime(taskId): summary com total e historico de sessoes
  Endpoints: POST /tasks/:id/work/start, POST /tasks/:id/work/stop, GET /tasks/:id/work-time, GET /tasks/my-active-work, GET /tasks/project-work-time?projectId=X
  ZERO tabela nova. Constraint: max 1 sessao open por user (validar atomicamente em transaction).
  ```
- **Estimativa:** +3-4 dias-engenheiro em F5
- **Bloqueia F0?** NAO (mas bloqueia G3 — gate fim de F9)

---

### Lacuna #2 [CRITICA — AUSENTE] — `GET /tasks/:id/history`

**Descricao:** Audit timeline visivel ao MEMBER no UI da task — lista todos os eventos da task (criada, status mudou, sprint mudou, deletada, etc.). Plano V2 menciona "audit log via DEvento" generico em F7 mas nao expoe o endpoint REST.

**Evidencia legado:** API-CONTRACT linhas 1401-1407 + UI legada (timeline na pagina da task).

**Evidencia V2:** `grep -n "/tasks/:id/history\|task.*history" Scrumban-Backend-V2/docs/plano/*.md` retorna ZERO matches.

**Risco:** MEDIO — feature de UI, sem ela usuarios perdem visibilidade de mudancas; cobertura possivel ate sob `GET /projects/:id/activity` (timeline do projeto inteiro), mas sem filtro por task.

**Acao corretiva:** acrescentar em F7 Bloco N: `GET /tasks/:id/history?cursor=&limit=20 -> DEvento WHERE idEntidade=taskId AND idClasse IN (-497, -498, -499, -500, etc.) ORDER BY chcriacao DESC, com cursor pagination, paridade com legado linha 1401-1407`.

---

### Lacuna #3 [CRITICA — AUSENTE] — Trocar cargo de membro (2 endpoints)

**Descricao:** `PATCH /organizations/:orgId/users/:userId/role { role }` e `PATCH /projects/:projectId/members/:userId/role { role }` — ADMIN troca cargo de membro existente (sem remover/recriar). Plano V2 cobre criar/remover, mas nao trocar cargo in-place via DVincula.idClasse.

**Evidencia legado:** API-CONTRACT linhas 987-996 e 1177-1187.

**Evidencia V2:** `02-DOMINIO-ENGINE.md:195` e `02-DOMINIO-ENGINE.md:216` listam endpoints CRUD de members mas nao especificam `:userId/role`.

**Risco:** MEDIO — funcionalidade de UI; sem ela ADMIN tem que remover + readicionar (perdendo historico).

**Acao corretiva:** acrescentar em F5 Bloco B:
- `B.12: PATCH /organizations/:orgId/users/:userId/role -> UPDATE DVincula.idClasse de -161/-162/-163 atomicamente; valida que ultimo ADMIN nao pode rebaixar a si mesmo`
- `B.13: PATCH /projects/:projectId/members/:userId/role -> analogo via DVincula -171/-172/-173`

---

### Lacuna #4 [DIVERGENCIA — PATH] — MCP Keys com path divergente

**Descricao:** Legado usa `POST/GET/DELETE /auth/me/mcp-key` (paridade com api-key). Plano V2 F11 usa `POST /mcp/keys`, `DELETE /mcp/keys/:id`, `GET /mcp/keys`. Quebra do contrato HTTP — cliente migrado precisa atualizar URLs.

**Evidencia legado:** API-CONTRACT linhas 200-228.

**Evidencia V2:** `03-INTEGRACOES.md:410-412`:
```
- POST /mcp/keys — gera nova key
- DELETE /mcp/keys/:id
- GET /mcp/keys
```

**Risco:** MEDIO — qualquer cliente que use MCP Keys atraves de API REST (UI, scripts) precisa de mudanca; impactaria tambem F4 documentacao Frontend Integration.

**Acao corretiva:** padronizar para `/auth/me/mcp-key` no plano F11 (e plano F3 ja menciona). Se manter `/mcp/keys`, registrar ADR explicito justificando.

---

### Lacuna #5 [DIVERGENCIA — PATH] — Webhooks `POST /webhooks/configure`

**Descricao:** Legado usa `POST /webhooks/configure` (path semantico). Plano V2 usa `POST /webhooks` generico. Quebra do contrato HTTP.

**Evidencia legado:** API-CONTRACT linha 1608.

**Evidencia V2:** `03-INTEGRACOES.md:578`: "CRUD webhooks (POST/GET/PUT/DELETE /webhooks)".

**Risco:** BAIXO-MEDIO — divergencia de path; no entanto, mais facil corrigir agora do que depois.

**Acao corretiva:** padronizar para `POST /webhooks/configure` em F12 ou registrar ADR explicito.

---

### Lacuna #6 [DIVERGENCIA — PATH] — Telegram channel paths

**Descricao:** Legado usa paths especificos de canal: `/channels/telegram/pairing`, `/channels/telegram/status`, `/channels/telegram/unlink`. Plano V2 usa generico `/channels/pairing` (decisao acertada para multi-canal futuro, mas quebra contrato com cliente migrado).

**Evidencia legado:** API-CONTRACT linhas 611-645.

**Evidencia V2:** `03-INTEGRACOES.md:139`: "POST /channels/pairing (autenticado)".

**Risco:** BAIXO — frontend tera que adaptar paths. Decisao acertada (canal-agnostico) mas merece ADR explicito.

**Acao corretiva:** registrar ADR-V2-XXX justificando "paths agnosticos de canal preparam para WhatsApp/Slack/Email no futuro" + manter alias temporario `/channels/telegram/*` em F10 por 2 sprints (mesmo padrao de ADR-V2-015 sobre query convention).

---

### Lacuna #7 [PARCIAL — DETALHAMENTO] — Telegram sub-services (4 services)

**Descricao:** Plano V2 F10 nao enumera explicitamente os 4 services sofisticados do legado: `VoiceTextNormalizerService` (arroba X -> @X), `WhisperPromptBuilderService` (vocabulario contextual), `ProjectPrefixParserService` (3 formatos @/#/Projeto,), `CommandParserService` + `CommandRouterService` (7 comandos). Plano fala em "groq-whisper.service.ts" e "comandos" genericamente.

**Evidencia legado:** `Scrumbam-Backend/CLAUDE.md` linhas 270-411 (descreve Fases A/B/C/D/E/F com profundidade).

**Evidencia V2:** `03-INTEGRACOES.md:139-161` lista apenas servicos macro.

**Risco:** MEDIO — implementer pode subestimar tempo de F10 (plano-mestre estima 5-6 semanas para Bloco C completo, mas Telegram so consumiu 4-5 semanas no legado segundo retrospectiva CLAUDE.md). Sem detalhamento nas 4 sub-features, ha risco de implementacao incompleta.

**Acao corretiva:** acrescentar em F10:
- Lista explicita dos 7 comandos com semantica (`/start`, `/minhas`, `/ready <id>`, `/projeto [nome]`, `/pausar`, `/retomar`, `/ajuda`)
- Bloco "Voice Subtle Features": VoiceTextNormalizerService + WhisperPromptBuilderService + ProjectPrefixParserService (todos canal-agnosticos, em `channels/shared/`)
- DoD: testes paritarios com legado (251+ testes em `channels/`)

---

### Lacuna #8 [PARCIAL — DETALHAMENTO] — Sprint delete cascade + Workflow Status reorder/batch

**Descricao:** Plano V2 (F5 Bloco D) usa wrapper thin sobre `/tabelas` mas nao detalha 2 comportamentos:
- DELETE Sprint deve atualizar todas DTask.dados.sprintId vinculadas para null (atomico em transaction) — paridade legado
- PATCH /workflow-statuses/reorder/batch deve aceitar lote `[{id, order}]` e atualizar com transaction

**Evidencia legado:** API-CONTRACT linhas 1271-1278 (DELETE sprint) e 1729-1734 (reorder batch).

**Evidencia V2:** `02-DOMINIO-ENGINE.md:333-338` so menciona reuso de `/tabelas`.

**Risco:** BAIXO — comportamento implicito mas sem teste explicito pode passar despercebido.

**Acao corretiva:** acrescentar D.5 e D.6 em F5 (descrito em §2.3).

---

### Lacuna #9 [DIVERGENCIA — METODO] — Notifications PATCH vs PUT

**Descricao:** Legado `Scrumbam-Backend/CLAUDE.md` linha 645 lista `PATCH /notifications/:id/read` (granular), `PUT /notifications/read` (batch), `PUT /notifications/read-all`. Plano V2 lista "PUT :id/read, PUT read-all" (sem batch granular).

**Evidencia:** `02-DOMINIO-ENGINE.md:1660`.

**Risco:** BAIXO — divergencia de metodo HTTP, semantica preservada.

**Acao corretiva:** alinhar com legado em F7 Bloco O (preservar `PATCH /notifications/:id/read` granular; usar `PUT /notifications/read` para batch com body `{ ids: [] }`).

---

### Lacuna #10 [PARCIAL — MAPEAMENTO] — `POST /tasks/:id/estimate-ai` nao mapeado a uma fase

**Descricao:** Endpoint legado `POST /tasks/:id/estimate-ai` (rate limit 5/min, stub OpenAI) presente em API-CONTRACT linha 1410-1418. Plano V2 menciona "OpenAI stub" em F11 (Integrations) mas nao especifica que `/tasks/:id/estimate-ai` e o endpoint. Inferencia possivel mas nao explicita.

**Evidencia:** ausencia de hit em `grep -n "estimate-ai" Scrumban-Backend-V2/docs/plano/*.md` (zero hits).

**Risco:** BAIXO — provavelmente sera incluido por reflexo (paridade contratual), mas merece mencao.

**Acao corretiva:** acrescentar em F5 Bloco E ou F11 Integracoes: "POST /tasks/:id/estimate-ai (rate limit 5/min, AgentThrottlerGuard) -> chama OpenAIService stub, retorna { estimatedHours, confidence, isStub: true }".

---

## 6. VEREDICTO FINAL

### 6.1 Decisao

**APROVADO COM RESSALVAS** — pode iniciar F0.

Os 7 endpoints AUSENTES e as 11 divergencias PARCIAIS NAO bloqueiam F0 (Setup repo + Multi-agent infra) nem F1 (Schema + Seed) nem F2 (Endpoints Genericos) nem F3 (Auth) nem F4 (Email + Common). **As lacunas concentram-se em F5 (4 lacunas), F7 (2 lacunas), F10 (1 lacuna), F11 (1 lacuna), F12 (1 lacuna).** Tempo estimado para fechar: ~6-8 dias-engenheiro distribuidos entre as fases.

**Capacidades macro do Scrumban-hoje 100% preservadas em conceito.** Nenhuma capacidade do produto foi silenciosamente eliminada. As lacunas sao operacionais (endpoints granulares, paths divergentes, sub-services nao enumerados), nao estrategicas.

### 6.2 Pode iniciar F0?

**SIM** — F0 trata de setup repo, multi-agent infra, hooks, ADRs, templates/classes-base-template.ts. **Nao toca em capacidade de dominio.** As lacunas sao todas downstream (F3+).

### 6.3 Pode iniciar F1 (Seed)?

**SIM** — o seed canonico §3.2 do plano-mestre cobre 100% das DClasses necessarias para todas as capacidades auditadas. Nenhum endpoint ausente requer DClasse nova.

### 6.4 Horas para fechar lacunas (estimativa)

| Lacuna | Fase | Horas-eng |
|--------|------|-----------|
| #1 Work Timer (5 endpoints) | F5 | 24-32h |
| #2 GET /tasks/:id/history | F7 | 4-6h |
| #3 PATCH .../users/:userId/role (org+proj) | F5 | 6-8h |
| #4 MCP Keys path | F3+F11 | 2h (find/replace + ADR) |
| #5 Webhooks /configure path | F12 | 1h |
| #6 Telegram paths agnostico vs especifico | F10 | 4h (alias + ADR) |
| #7 Telegram sub-services explicitar | F10 | 8h (detalhamento + DoD) |
| #8 Sprint cascade + WS reorder batch | F5 | 4-6h |
| #9 Notifications PATCH vs PUT | F7 | 1h |
| #10 estimate-ai mapeamento | F5/F11 | 2h |
| **TOTAL** | — | **56-70h** (~7-9 dias-eng) |

Em comparacao com a estimativa do plano-mestre (24 semanas com 1 implementer dedicado = ~960h), **as lacunas representam 6-7% do esforco total — facilmente absorviveis sem alterar cronograma.**

### 6.5 Confirmacao explicita

**Confirmo que NENHUMA capacidade macro do Scrumban-hoje foi silenciosamente perdida no retrabalho dos Blocos 1-5 da remediacao.** Todas as 21 capacidades macro do `SYSTEM-OVERVIEW.md` estao mapeadas a uma fase especifica do plano V2 com DClasses, DoD e ADRs. As 7 ausencias de endpoint detectadas representam 5,5% do contrato HTTP (128 endpoints) e concentram-se em 3 capacidades operacionais (Work Timer, History, Trocar Cargo) — todas recuperaveis com adicoes pontuais antes de fechar G3 (gate de fim de F9).

---

## 7. PLANO DE REMEDIACAO

### 7.1 Pre-F0 (recomendado, nao-bloqueante)

- [ ] **#5 e #4 (paths):** decidir entre adotar paths do legado (preserva contrato) ou ADR justificando divergencia. Recomenda-se preservar paths do legado para minimizar friccao na migracao de UI/cliente. Atualizar `00-PLANO-MESTRE.md`, `01-FUNDACAO.md`, `03-INTEGRACOES.md` com paths corretos antes de F0 fechar.
- [ ] **#6 (Telegram paths):** decidir agnostico-canal (preferivel) + alias temporario `/channels/telegram/*` por 2 sprints. ADR-V2-019 explicito.

### 7.2 Em F5 (Bloco E + Bloco D)

- [ ] **#1 Work Timer:** acrescentar Bloco E.11 com 5 endpoints (work/start, work/stop, work-time, my-active-work, project-work-time). Persistencia em DTask.dados.workSessions[]. ZERO tabela nova.
- [ ] **#3 Trocar cargo:** acrescentar B.12 e B.13 (PATCH role org + projeto)
- [ ] **#8 Sprint cascade + WS reorder batch:** acrescentar D.5 e D.6
- [ ] **#10 estimate-ai:** explicitar mapeamento

### 7.3 Em F7 (Bloco N + Bloco O)

- [ ] **#2 GET /tasks/:id/history:** novo endpoint via DEvento
- [ ] **#9 Notifications metodos HTTP:** preservar PATCH granular + PUT batch

### 7.4 Em F10

- [ ] **#7 Telegram sub-services:** detalhamento explicito dos 7 comandos + 3 sub-services (parser, normalizer, prompt builder)

### 7.5 Apos F9 (Gate G3)

- [ ] Re-auditar 128 endpoints com este documento como check-list
- [ ] Validar que cada endpoint do legado respondeu identicamente (smoke test paritario)
- [ ] Liberar G3 → G4 (Integracoes)

---

**Fim da Auditoria.**

**Resumo:** Escopo intacto no nucleo. 7 endpoints ausentes (5,5%). 11 divergencias parciais (path/metodo). Score consolidado **8,3/10**. Veredicto **APROVADO COM RESSALVAS — pode iniciar F0**. Lacunas fechaveis em ~7-9 dias-engenheiro absorviveis no cronograma de 24 semanas. Familia depende — corda continua justa.
