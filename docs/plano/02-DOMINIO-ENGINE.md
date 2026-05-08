# Plano Estratégico — Fases 5 a 9: Domínio + Engine + Eventos + Leitura

**Estrategista responsável:** Strategist Agent (Devari Core) — Bloco 3 (Domínio + Engine)
**Data:** 2026-05-08 (revisado em 2026-05-08 pelo retrabalho pos-auditoria PARTE-1, Bloco 3)
**Cobertura deste documento:** Fases 5, 6, 7, 8, 9 do roadmap V2
**Outras estrategistas:** Fundação (0-4), Integrações (10-13), Hardening+Handoff (14-16)
**Disciplina:** ZERO tabela nova. Apenas as 17 tabelas canônicas Devari Core. Polimorfismo via `idClasse`.
**Decisões já tomadas (herdadas do contexto):**
- Pilar 1 ativado via `OperacaoExecucaoClaude` (Engine como coração técnico do V2)
- DExecution → DPedido + Engine + DVFS scripts (Risk Gate, PR auto-open)
- DAgent → DEntidade idClasse=AGENT
- DProjectMember → DVincula
- DNotification → DEvento
- DWebhook → DTabela com `dados` Json
- Tudo polimórfico, sem afrouxamento
- **Engine e EXCLUSIVO de DPedido idClasse=-300 (e seus filhos -301/-302/-303 via polimorfismo + `OperacaoExecucaoClaude`).** Toda outra tabela (DTask, DProject, DEntidade, DTabela, DVincula, DEvento) e estrutural — Service+Prisma direto. Esta regra e enforced em F5, F6, F7, F8 e F9 e e BLOQUEANTE para Reviewer (rejeicao automatica).
- **ADRs novos do Bloco 3 (2026-05-08):** ADR-V2-015 (`?idClasse=N` canonica) e ADR-V2-016 (DVFS scripts: `s.chave` nao `s.id` — bug latente coberto por 2 testes regressivos adversariais bloqueantes em F6 DoD).

---

## 0. Validacao do Escopo Scrumban-hoje × DClasses do plano-mestre §3

**Cruzamento feito pelo Bloco 3 (2026-05-08).** O escopo do V2 (decisao do CEO) e o produto Scrumban hoje, descrito em `Scrumbam-Backend/docs/SYSTEM-OVERVIEW.md`. Cruzei a tabela §3.2 do `00-PLANO-MESTRE.md` (90+ DClasses canonicas V2) com SYSTEM-OVERVIEW (capacidades hoje) e com `Scrumbam-Backend/prisma/seeds/classes.seed.ts` (89 classes do legado).

**Resultado: cobertura completa, nenhuma DClasse faltante, nenhuma ausente em sobra real.**

| Capacidade SYSTEM-OVERVIEW | DClasses §3.2 do mestre | Fase deste documento que usa |
|----------------------------|--------------------------|-------------------------------|
| Hierarquia organizacional (Org/Team/Project) | -150 USER, -151 PLATFORM_SCRUMBAN, -152 ORG, -180 TEAM | F5 |
| Membership (RBAC duplo Org+Project) | -160..-163 ORG_USER_LINK + cargos, -170..-173 PROJECT_USER_LINK + cargos, -181 TEAM_MEMBERSHIP | F5 |
| Sprints / Priorities / TaskTypes / Status V3 | -400 SPRINT, -420..-424 priorities, -430..-435 task types, -440..-449 status V3 (9 folhas) | F5 |
| Channels (incluindo Telegram com voz Whisper) | -450..-456 channels (-456 TELEGRAM) | F10 (fora deste doc, mas DClasses preparadas em F1) |
| Webhooks / API Keys / MCP Keys / Pairing tokens / Issue Counter | -470 WEBHOOK, -471 API_KEY, -472 MCP_KEY, -473 INSTALL_TOKEN, -474 PAIRING_TOKEN, -475 ISSUE_COUNTER | F5 (issue counter, F12 webhook config) |
| Notifications / Webhook attempts / Audit trail | -490 NOTIFICATION, -491 WEBHOOK_ATTEMPT, -492 AGENT_HEARTBEAT, -493..-496 (TELEGRAM_MSG_IN/OUT, MCP_CALL, EXECUTION_LOG), -497..-501 (audit) | F7 |
| Automation Claude Code (Risk Gate, Approval, Run, PR) | -156 AGENT, -300..-303 EXECUTION + risk levels, -510..-527 status enums + risk levels | **F6 (CORACAO)** |
| Identifier publico atomico (DEV-7) | -475 ISSUE_COUNTER (DTabela com counter atomico) | F5 (E.2) |
| Search / Flow Metrics / Forecast | (read-only — nenhuma DClasse nova necessaria) | F8 |
| Reports PDF | (read-only sobre dados existentes) | F9 |

**Renumeracao Scrumban-hoje -> V2 (formalizada em ADR-V2-002, registrada aqui para rastreabilidade do Bloco 3):**

| Scrumban-hoje (legado V1) | V2 (mestre §3.2) | Razao |
|---------------------------|-------------------|-------|
| -47 USER | -150 USER | Liberar -47 (canonico Seller fintech) |
| -49 PLATFORM | -151 PLATFORM_SCRUMBAN | Liberar -49 (canonico Plataforma fintech) |
| -50 ORGANIZATION | -152 ORGANIZATION | Liberar -50 (canonico Comprador fintech) |
| -460 TEAM (legado) | -180 TEAM | Faixa -460..-469 reservada para Channels no V2 |

**Sobras detectadas (DClasses no §3.2 sem uso direto em Scrumban-hoje, justificadas):**
- Status enums `-510..-527` (~13 itens) — pesados, mas usados em Automation Fase 3 do legado (`DExecution.approvalFlow` enum). Ao virar DTabela polimorfica, ficam compativeis. Mantido.
- `-156 AGENT` como sub-tipo de Pessoa (idPai=-43): conforme ADR-V2-013. Sem objecao do Bloco 3.

**Conclusao:** o §3 do plano-mestre cobre 100% do Scrumban-hoje. Bloco 3 nao requer adicao nem remocao de DClasses. Detalhe: a tabela acima e PARTE da entrega — ver tambem `/tmp/patch-bloco-3-mestre.md` item 3 que propoe inserir esse cruzamento como §3.4 do mestre.

---

## Sumário Executivo das Fases 5-9

| Fase | Nome | Objetivo macro | Pilar dominante | Tempo estimado |
|------|------|----------------|-----------------|----------------|
| 5 | Domínio Estrutural Scrumban | Cadastros, hierarquia, projetos, tasks, sprints, status, prioridades, tipos | Pilar 2 + Pilar 3 | 2,5-3 semanas |
| 6 | Engine + OperacaoExecucaoClaude | Coração técnico — Risk Gate + Approval + DVFS + PR auto-open via Engine | **Pilar 1** | 3-3,5 semanas |
| 7 | Eventos Canônicos (DEvento + Producer) | Notifications, Webhooks, audit trail, telemetry — tudo polimórfico | Pilar 2 + Pilar 3 + EventProducer | 1,5-2 semanas |
| 8 | Capacidades de Leitura Runtime | Flow metrics, forecast Monte Carlo, search FTS — runtime puro | Performance/Observabilidade | 2-2,5 semanas |
| 9 | Reports + Dashboards + Analytics | Read-only agregações, PDF export, cache TTL | Read pipeline | 1,5-2 semanas |
| **Total** | | | | **10,5-13 semanas** |

> **Tempo total estimado das 5 fases (com buffer 20% absorvido):** **10,5 a 13 semanas** de trabalho efetivo do Implementer, considerando dependências paralelizáveis entre Fase 7 e início de Fase 8.

---

# FASE 5 — Domínio Estrutural Scrumban

## 5.1 Objetivo

Implementar todo o domínio estrutural (cadastros não-transacionais) do Scrumban V2 sem usar Engine — Prisma direto via Service em transações atômicas, conforme Pilar 1 (Engine é EXCLUSIVO de tabelas transacionais). Esta fase entrega:

- Hierarquia organizacional (Platform → Organization → Team)
- Membership (DVincula para org-membership e DVincula tipado para project-membership)
- Projetos (DProject com `dados` Json para campos de automation)
- Sprints, Workflow Statuses (V3), Priorities, Task Types — tudo via DTabela polimórfica
- Tasks (DTask com campos V3 em `dados` Json)
- Identifier público atômico ("DEV-7") via DTabela ISSUE_COUNTER por team
- State machine de status validada em service (não Engine — DTask é estrutural)

## 5.2 Pilares ativados / respeitados

| Pilar | Aplicação na Fase 5 |
|-------|---------------------|
| **Pilar 1 (Engine)** | NÃO usado — corretamente. DTask, DProject, DEntidade, DTabela, DVincula são ESTRUTURAIS, padrão Service+Prisma. **REGRA INVIOLAVEL:** Engine e EXCLUSIVO de DPedido idClasse=-300 (e seus sub-tipos -301/-302/-303 via OperacaoExecucaoClaude — F6). **TODA tentativa em F5 de instanciar OperacaoPedido para DTask/DProject/DEntidade/DTabela/DVincula e REJEITADA pelo Reviewer (score <5/10).** Reviewer faz `grep -nr "new Operacao" src/{tasks,projects,organizations,teams,entidades,tabelas,classes}` e espera ZERO hits. |
| **Pilar 2 (Endpoints Genéricos)** | **CRÍTICO.** Sprints, Statuses, Priorities, Task Types REUSAM `/tabelas?idClasse=X` (NÃO criar SprintsController, StatusesController, PrioritiesController, TaskTypesController). Apenas Projects e Tasks têm controllers próprios (DProject e DTask têm controllers específicos por design Devari Core). |
| **Pilar 3 (Seed)** | **BLOQUEANTE.** Toda Fase 5 depende do seed gerado na Fase 1. As classes específicas Scrumban (-150 a -160 e -440 a -475) DEVEM existir no banco antes do primeiro endpoint funcionar. |

## 5.3 Padrões obrigatórios aplicados

Da `devari-backend-patterns.md`:
- **#1** PrismaService (nunca DatabaseService)
- **#2** BigInt em todos os IDs
- **#3** `prisma.$transaction` em operações multi-tabela (criar org → criar default team → criar membership)
- **#4** TimezoneService para todos os filtros de data
- **#5** EntidadeService.getEntidadeIdFromUserGroup quando converter DUserGroup.chave → DEntidade.chave
- **#6** ZERO N+1 (usar `include`/`select` em todas as listagens)
- **#9** DTOs com class-validator + Swagger
- **#10** Guards (JwtAuthGuard, OrgTenantGuard, RolesGuard, TeamRolesGuard)
- **#11** Logger NestJS (zero console.log)
- **#13** Padrão de Service (validação → query otimizada → transformação)
- **#15** Cursor pagination em listagens grandes (Tasks, Activity)

## 5.4 Tabelas canônicas envolvidas (das 17)

| Tabela | Uso na Fase 5 | Padrão acesso |
|--------|---------------|---------------|
| **DClasse** | Lookup de classes (já populadas pelo seed Fase 1) | Read-only via classe controller existente |
| **DEntidade** | Platform (-49), Organization (-150), Team (-151), User (-47) | Service+Prisma+transação |
| **DTabela** | Sprints (-400), Statuses V3 (-440 + -441..-449), Priorities (-420 + -421..-424), Task Types (-430 + -431..-435), Issue Counter (-475) | Reuso `/tabelas` controller genérico (Pilar 2) |
| **DVincula** | Org-membership (-152: ADMIN/MEMBER/VIEWER), Project-membership (-153: MANAGER/MEMBER/VIEWER), Team-membership (-154) | Service+Prisma |
| **DProject** | Projects (controller próprio justificado: lógica de boards, agent-link, git creds) | Service+Prisma+transação |
| **DTask** | Tasks (controller próprio justificado: state machine, identifier público, V3 fields) | Service+Prisma+transação |
| **DEvento** | Audit log (preparado, mas EMISSÃO completa fica para Fase 7) | Insert direto via EventService stub |
| **DUserGroup** | Login credentials (já criado em Fase 2 Auth) | — |

**Tabelas das 17 NÃO usadas na Fase 5:** DPedido, DTitulo, DMovDispo, DMovDepos, DSolicita, DRequisic, DRecurso, DPermissao, DVFS. Algumas serão usadas na Fase 6 (DPedido, DVFS). Outras nunca serão usadas pelo Scrumban V2 (DTitulo, DMovDispo, DMovDepos, DSolicita, DRequisic) — são canônicas mas dormentes neste domínio.

## 5.5 DClasses a criar nesta fase (via seed da Fase 1, mas referência aqui)

> **Importante:** A Fase 1 (Estrategista de Fundação) é responsável por gerar `prisma/seeds/classes.seed.ts`. Esta fase apenas CONSUMA as classes. Documentamos aqui o range para coordenação.

```
HIERARQUIA ORGANIZACIONAL (DEntidade)
  -49 PLATFORM           — agrupador, idPai=-43 (Pessoas, fixa)
  -150 ORGANIZATION       — folha, idPai=-49
  -151 TEAM               — folha, idPai=-150
  -47 USER                — folha, idPai=-43 (já existe na base)

MEMBERSHIPS (DVincula)
  -152 ORG_MEMBERSHIP     — folha, idPai=-37 (Entidades). Cargo em metaDados: ADMIN/MEMBER/VIEWER
  -153 PROJECT_MEMBERSHIP — folha, idPai=-37. Cargo: MANAGER/MEMBER/VIEWER
  -154 TEAM_MEMBERSHIP    — folha, idPai=-37. Cargo: LEAD/MEMBER

LOOKUPS (DTabela)
  -400 SPRINT             — agrupador, idPai=-51 (Tabelas)
  -420 PRIORITY           — agrupador, idPai=-51
    -421 HIGH, -422 MEDIUM, -423 LOW, -424 URGENT — folhas, idPai=-420
  -430 TASK_TYPE          — agrupador, idPai=-51
    -431 FEATURE, -432 BUG, -433 IMPROVEMENT, -434 REVIEW, -435 EXPLAIN — folhas, idPai=-430
  -440 STATUS_V3          — agrupador, idPai=-51
    -441 INBOX, -442 READY, -443 EXECUTING, -444 DONE, -445 FAILED,
    -446 CANCELLED, -447 DISCARDED, -448 VALIDATING, -449 VALIDATED — folhas, idPai=-440
  -450 CANAL              — agrupador (preparado p/ Fase 11 Telegram), idPai=-51
    -451 WEB, -452 WHATSAPP, -453 EMAIL, -454 SLACK, -455 API, -456 TELEGRAM
  -475 ISSUE_COUNTER      — folha, idPai=-51. dEntidadeId=teamId, metaDados={ lastSeq: number, prefix: 'DEV' }
```

**Total Scrumban V2:** ~50 fixas (base Devari) + ~26 específicas = ~76 classes.

## 5.6 Estrutura de arquivos esperada

```
src/
├── prisma.service.ts                           [já criado Fase 0]
├── common/
│   ├── services/
│   │   ├── timezone.service.ts                 [já Fase 0]
│   │   └── correlation-id.service.ts
│   ├── guards/
│   │   ├── jwt-auth.guard.ts                   [já Fase 2]
│   │   ├── org-tenant.guard.ts                 [já Fase 2]
│   │   ├── roles.guard.ts
│   │   ├── team-roles.guard.ts
│   │   └── auth-composite.guard.ts
│   └── decorators/
│       ├── roles.decorator.ts
│       ├── team-roles.decorator.ts
│       └── tenant-config.decorator.ts
│
├── entidades/                                  [endpoint genérico /entidades — REUSO]
│   ├── entidades.module.ts
│   ├── entidades.controller.ts                 [GET, GET:id, POST especializado]
│   ├── entidades.service.ts                    [+ getEntidadeIdFromUserGroup]
│   ├── dto/
│   └── entidades.service.spec.ts
│
├── tabelas/                                    [endpoint genérico /tabelas — REUSO]
│   ├── tabelas.module.ts
│   ├── tabelas.controller.ts                   [GET, GET:id, POST, PATCH, DELETE]
│   ├── tabelas.service.ts
│   └── dto/
│
├── classes/                                    [endpoint /classes — read-only]
│   ├── classes.controller.ts
│   └── classes.service.ts
│
├── organizations/
│   ├── organizations.module.ts
│   ├── organizations.controller.ts             [POST, GET:id, PATCH, DELETE, GET/POST/PATCH/DELETE :id/users]
│   ├── organizations.service.ts                [createOrganization → cria org + default team + admin membership EM TRANSACTION]
│   ├── dto/
│   │   ├── create-organization.dto.ts
│   │   ├── update-organization.dto.ts
│   │   ├── add-member.dto.ts
│   │   └── update-member-role.dto.ts
│   └── organizations.service.spec.ts
│
├── teams/
│   ├── teams.module.ts
│   ├── teams.controller.ts                     [POST, GET, GET:id, PATCH, DELETE, GET /mine, members CRUD]
│   ├── teams.service.ts                        [criar team com prefix issue counter (DTabela -475)]
│   ├── dto/
│   └── teams.service.spec.ts
│
├── projects/
│   ├── projects.module.ts
│   ├── projects.controller.ts                  [POST, GET, GET:id, PATCH, DELETE, GET :id/activity, GET :id/stats]
│   ├── projects.service.ts                     [campos automation em DProject.dados Json]
│   ├── project-activity.service.ts             [timeline lendo DEvento]
│   ├── project-members.controller.ts           [GET/POST/PATCH/DELETE :projectId/members → DVincula -153]
│   ├── project-members.service.ts
│   ├── dto/
│   │   ├── create-project.dto.ts
│   │   ├── update-project.dto.ts
│   │   ├── project-response.dto.ts             [serializa dados Json]
│   │   └── add-member.dto.ts
│   └── projects.service.spec.ts
│
├── sprints/                                    [WRAPPER FINO sobre /tabelas?idClasse=-400]
│   └── sprints.module.ts                       [REGISTRA tabelasModule, NÃO duplica controller]
│   └── README.md                               [documenta como usar /tabelas?idClasse=-400&dEntidadeId=projectId]
│
├── workflow-statuses/                          [WRAPPER FINO sobre /tabelas?idClasse=-440]
│   ├── workflow-statuses.module.ts
│   ├── workflow-statuses.controller.ts         [APENAS rotas auxiliares: POST :projectId/seed-defaults — semeia 9 V3 padrão]
│   ├── workflow-statuses.service.ts            [seedDefaults(projectId): cria 9 linhas DTabela -441..-449 vinculadas]
│   └── README.md                               [GET, PATCH, DELETE → use /tabelas]
│
├── tasks/
│   ├── tasks.module.ts
│   ├── tasks.controller.ts                     [POST, GET, GET:id, PUT, PUT:id/status, PUT:id/sprint, DELETE]
│   ├── tasks.service.ts                        [state machine + identifier atômico EM TRANSACTION]
│   ├── tasks-state-machine.ts                  [validTransitions map, validateTransition()]
│   ├── tasks-identifier.service.ts             [getNextIdentifier(teamId): lock + increment DTabela -475]
│   ├── dto/
│   │   ├── create-task.dto.ts
│   │   ├── update-task.dto.ts
│   │   ├── update-task-status.dto.ts
│   │   ├── update-task-sprint.dto.ts
│   │   ├── task-response.dto.ts                [serializa V3 fields de DTask.dados]
│   │   └── list-tasks-query.dto.ts             [filtros search, priorityId, taskTypeId, statusId, sprintId, teamId, cursor, limit]
│   └── tasks.service.spec.ts
│
└── seed-bootstrap/                             [helpers para projetos novos semearem suas DTabelas]
    └── seed-bootstrap.service.ts               [chamado em createProject: cria sprints default, statuses default, priorities default, task types default vinculados ao projeto]
```

**Linhas estimadas Fase 5:** ~6.500 a 8.000 linhas TypeScript (incluindo testes).

## 5.7 Tarefas detalhadas (numeradas, acionáveis)

### Bloco A — Endpoints genéricos (Pilar 2 — fundação)

**A.1.** Implementar `EntidadeService.findManyByClasse(idClasse, filters, pagination)` — retorna DEntidade filtrado, com `include` para DClasse (select chave/nome/codigo). Cursor pagination obrigatório.
**A.2.** Implementar `EntidadeController` com rotas: `GET /entidades` (query params: idClasse, nome, idEstab, cursor, limit), `GET /entidades/:id`, `POST /entidades` (genérico — não recomendado para uso direto; rotas especializadas em controllers domínio). Aplicar `JwtAuthGuard` + `OrgTenantGuard`.
**A.3.** Implementar método público `EntidadeService.getEntidadeIdFromUserGroup(dUserGroupId: bigint): Promise<bigint>` — lookup DEntidade onde `dUserGroupId = X`, retorna `chave`. Cache LRU 5min (in-memory simples, sem Redis nesta fase).
**A.4.** Implementar `TabelaService.findManyByClasse(idClasse, filters, pagination)` — análogo ao A.1, com filtro adicional `dEntidadeId` (usado para escopar sprints por projeto, statuses por projeto, etc.).
**A.5.** Implementar `TabelaController` com rotas: `GET /tabelas`, `GET /tabelas/:id`, `POST /tabelas`, `PATCH /tabelas/:id`, `DELETE /tabelas/:id` (soft delete). Guards: JWT + OrgTenantGuard + Roles(ADMIN para mutations).
**A.6.** Implementar `ClasseController` (read-only): `GET /classes`, `GET /classes/:id`, `GET /classes/tree?root=-1` (retorna árvore hierárquica via recursive CTE).
**A.7.** Testes: 100% coverage em `EntidadeService.getEntidadeIdFromUserGroup`, paginação cursor, soft delete em DTabela.

### Bloco B — Organizations + Teams + Memberships

**B.1.** `OrganizationsService.create(dto, userId)`: dentro de `prisma.$transaction`:
  1. Cria DEntidade idClasse=-150 (Organization) — `nome`, `idEstab` (Platform default), `dados.metadata={createdAt, plan}`.
  2. Cria DEntidade idClasse=-151 (Default Team) — `nome="Default Team"`, `idEstab=organizationId`, `dados={ key: 'DEV', lastIssueSeq: 0 }`.
  3. Cria DTabela idClasse=-475 (ISSUE_COUNTER) — `dEntidadeId=teamId`, `metaDados={ prefix: 'DEV', lastSeq: 0 }`.
  4. Cria DVincula idClasse=-152 (ORG_MEMBERSHIP) — `idLocEscritu=organizationId`, `idEntidade=userEntidadeId`, `metaDados={ cargo: 'ADMIN' }`.
  5. Cria DVincula idClasse=-154 (TEAM_MEMBERSHIP) — `idLocEscritu=teamId`, `idEntidade=userEntidadeId`, `metaDados={ cargo: 'LEAD' }`.
  6. Emite evento `entity.created` (stub — Fase 7 implementa producer real).

**B.2.** `OrganizationsService.findOne(id, userId)`: validação de acesso via DVincula (membership check). Retorna org + memberCount agregado (groupBy, sem N+1).
**B.3.** `OrganizationsService.update(id, dto, userId)`: apenas ADMIN do org pode editar. Logger structured.
**B.4.** `OrganizationsService.delete(id, userId)`: soft delete em transação atômica — cascade em projetos, teams, memberships. Bloqueia se houver execuções `awaiting_approval` ou `running` (validação cross-Fase 6, mas preparada aqui via try/catch).
**B.5.** Membros: `addMember(orgId, dto)`, `removeMember(orgId, userId)`, `updateMemberRole(orgId, userId, role)` — todos via DVincula -152, com guards Roles(ADMIN).
**B.6.** `TeamsService.create(orgId, dto, userId)`: cria DEntidade -151 + DTabela -475 (issue counter) em transação. Validação: prefix único por org (`metaDados.prefix` deve ser único entre teams da mesma org).
**B.7.** `TeamsService.list(orgId, userId)`: lista teams onde user é membro (DVincula -154). Para ADMIN da org: lista todos.
**B.8.** `TeamsService.findMine(userId)`: retorna teams onde user tem DVincula -154 com qualquer cargo.
**B.9.** `TeamsService.delete(teamId, userId)`: bloqueia se existirem projetos vinculados (`DProject.idTeam = teamId`). Soft delete em cascata (memberships).
**B.10.** `TeamsService` métodos de membership análogos a B.5 mas para -154.
**B.11.** `defaultTeamId` persistido em `DEntidade.dados.defaultTeamId` no User. Endpoint: `PATCH /auth/me { defaultTeamId }`.

### Bloco C — Projects

**C.1.** `ProjectsService.create(dto, userId)`: dentro de `prisma.$transaction`:
  1. Cria DProject — `nome`, `idOrganizacao=user.organizationId`, `idOwner=userEntidadeId`, `idTeam=dto.teamId || user.defaultTeamId`, `status='active'`, `dados=ProjectDadosSchema.serialize(dto.automation || {})`.
  2. Cria DVincula idClasse=-153 (PROJECT_MEMBERSHIP) — owner como MANAGER.
  3. Chama `seedBootstrap.seedProjectDefaults(projectId)` — cria sprints default ("Sprint 1", "Backlog"), statuses V3 default (9 linhas), priorities default (4), task types default (5) — todos como DTabela com `dEntidadeId=projectId`.
  4. Emite `entity.created` stub.

**C.2.** Schema de `DProject.dados` Json (TypeScript type-safe via zod):
```typescript
interface ProjectDados {
  automation?: {
    idAgent?: string;        // bigint stringified
    remotePath?: string;
    remoteBranch?: string;
    remoteRepoUrl?: string;
    gitDeployKeyFingerprint?: string;
    gitBotEmail?: string;
    gitBotName?: string;
    executionTimeoutMs?: number;
  };
  apiKey?: {
    keyHash?: string;        // SHA-256
    prefix?: string;
    createdAt?: string;
    lastUsedAt?: string;
  };
  metadata?: {
    description?: string;
    icon?: string;
    color?: string;
  };
}
```
Validação no service ao escrever (zod schema). Leitura no Response DTO desserializa em campos top-level (frontend não vê estrutura `dados`).

**C.3.** `ProjectsService.findMany(orgId, filters, cursor, limit)`: cursor pagination, filtro por team, busca por nome (ilike), include `_count: { tasks: true }` e include team (select chave/nome).
**C.4.** `ProjectsService.findOne(id, userId)`: valida membership (DVincula -153 OU ADMIN do org).
**C.5.** `ProjectsService.update(id, dto, userId)`: apenas MANAGER ou ADMIN do org. Merge de `dados` Json (não sobrescrever campos não enviados).
**C.6.** `ProjectsService.delete(id, userId)`: cascade $transaction (DTask + DVincula -153 + DTabela vinculadas + DEvento de project.deleted). Bloqueia se DPedido (executions) em status [queued, awaiting_approval, running] — preparação para Fase 6.
**C.7.** `ProjectActivityService.getActivity(projectId, filters)`: lê DEvento WHERE idEntidade=projectId OR idEntidade IN (tasks do projeto). Cursor pagination, filtros: tipo, dateFrom, dateTo. ZERO N+1 (uma query com OR).
**C.8.** `ProjectMembersService.add/remove/updateRole`: DVincula -153 com cargo em metaDados.

### Bloco D — Sprints + Statuses + Priorities + Task Types (REUSO)

**D.1.** `WorkflowStatusesService.seedDefaults(projectId, userId)`: cria 9 linhas DTabela idClasse específicas (-441..-449, mas como folhas vinculadas ao projeto via `dEntidadeId=projectId`). NÃO criar idClasse novo por projeto — usar as classes V3 globais (-441..-449) e diferenciar por `dEntidadeId`.
**D.2.** README em `src/workflow-statuses/` documentando: `GET /tabelas?idClasse=-440&dEntidadeId={projectId}` lista os 9 statuses. PATCH/DELETE usar `/tabelas/:id`.
**D.3.** Análogo a D.1 para Sprints (D.3a: criar "Sprint 1" e "Backlog" no createProject), Priorities (D.3b: já globais -421..-424, sem replicação por projeto), Task Types (D.3c: globais -431..-435).
**D.4.** README em `src/sprints/`: `GET /tabelas?idClasse=-400&dEntidadeId={projectId}` lista sprints do projeto. POST `/tabelas` com `dEntidadeId=projectId`.

### Bloco E — Tasks (DTask)

**E.1.** Schema de `DTask.dados` Json (zod-validated):
```typescript
interface TaskDados {
  v3?: {
    problema?: string;
    contexto?: string;
    solucaoProposta?: string;
    criteriosAceite?: string[];
    naoObjetivos?: string[];
    riscos?: string[];
    hillPosition?: number;          // 0..3
  };
  telemetry?: {
    readyAt?: string;               // ISO 8601 UTC
    executingAt?: string;
    completedAt?: string;
    failureReason?: string;
  };
  automation?: {
    prUrl?: string;
    filesChanged?: number;
    lastExecutionId?: string;
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  };
  capture?: {
    canalId?: string;               // -451 WEB, -456 TELEGRAM, etc.
    rawText?: string;
  };
}
```

**E.2.** `TasksIdentifierService.getNextIdentifier(teamId, tx)`: dentro de transação aberta:
```typescript
// Lock + increment atômico
const counter = await tx.dTabela.update({
  where: { chave: counterId, idClasse: BigInt(-475), dEntidadeId: teamId },
  data: { metaDados: { increment via Prisma raw SQL: jsonb_set lastSeq } }
});
return `${prefix}-${newSeq}`;
```
**Decisão técnica:** usar SQL `UPDATE ... SET metaDados = jsonb_set(metaDados, '{lastSeq}', (COALESCE((metaDados->>'lastSeq')::int, 0) + 1)::text::jsonb) WHERE ...` via `tx.$executeRaw` para garantir atomicidade. Retornar o seq via RETURNING.

**E.3.** `TasksService.create(dto, userId)` em transação:
  1. Resolve project + team. Se project tem team, usa o counter desse team. Caso contrário, erro 422.
  2. Resolve statusId default (-441 INBOX) ou statusId do dto.
  3. Resolve priorityId default (-422 MEDIUM) e taskTypeId default (-431 FEATURE).
  4. Identifier público via E.2 (atômico).
  5. CREATE DTask: `nome, descricao, idProject, idStatus, idPriority, idTaskType, criadoPor=userEntidadeId, dados=TaskDadosSchema.serialize(dto)`.
  6. Audit log via DEvento (Fase 7 producer real; aqui stub direct insert).
  7. Webhook trigger (Fase 7).

**E.4.** State Machine `tasks-state-machine.ts`:
```typescript
const validTransitions: Record<bigint, bigint[]> = {
  BigInt(-441): [BigInt(-442), BigInt(-446), BigInt(-447)],   // INBOX → READY, CANCELLED, DISCARDED
  BigInt(-442): [BigInt(-443), BigInt(-441), BigInt(-446)],   // READY → EXECUTING, INBOX (back), CANCELLED
  BigInt(-443): [BigInt(-444), BigInt(-445), BigInt(-448), BigInt(-442)],  // EXECUTING → DONE, FAILED, VALIDATING, READY
  BigInt(-448): [BigInt(-449), BigInt(-445), BigInt(-443)],   // VALIDATING → VALIDATED, FAILED, EXECUTING
  BigInt(-449): [BigInt(-444)],                                // VALIDATED → DONE
  BigInt(-444): [],                                            // DONE terminal
  BigInt(-445): [BigInt(-441)],                                // FAILED → INBOX (re-triagem)
  BigInt(-446): [],                                            // CANCELLED terminal
  BigInt(-447): [],                                            // DISCARDED terminal
};
```

**E.5.** `TasksService.updateStatus(taskId, newStatusId, userId)`:
  1. Busca task + valida access (membership do projeto).
  2. Valida transição (E.4). Se inválida: BadRequestException com transições válidas no payload.
  3. UPDATE DTask + popula timestamps em `dados.telemetry` (readyAt, executingAt, completedAt) conforme transição.
  4. Emite `entity.status.changed` (stub Fase 7).
  5. Cria DNotification (preparado, mas DNotification não existe — usar DEvento idClasse=-490 NOTIFICATION na Fase 7).

**E.6.** `TasksService.findMany(projectId, filters, cursor, limit)`: filtros search (ilike em nome/descricao), priorityId, taskTypeId, statusId, sprintId, teamId. Cursor pagination, ZERO N+1 via `include: { DClasse_status, DClasse_priority, DClasse_taskType, criadoPor: { select: chave/nome } }`.

**E.7.** `TasksService.findOne(taskId, userId)`: full include + V3 fields desserializados em response top-level.

**E.8.** `TasksService.update(id, dto, userId)`: merge de `dados.v3` (não sobrescrever). Apenas criador OU project member.

**E.9.** `TasksService.updateSprint(taskId, sprintId, userId)`: valida que sprint pertence ao projeto da task. Update simples + audit.

**E.10.** `TasksService.delete(id, userId)`: soft delete (DTask.excluido=true). Audit.

### Bloco F — Testes

**F.1.** Unit tests por service (target: 80%+ coverage). Mocks de PrismaService.
**F.2.** Integration test crítico: createOrganization end-to-end (cria org+team+counter+memberships em uma transação atômica, validar rollback se qualquer step falhar).
**F.3.** Integration test: createTask gerando identifier atômico em paralelo (10 threads simultâneas tentando criar tasks no mesmo team — todos identifiers únicos, sem skip).
**F.4.** State machine: 50 cenários de transição (válidos e inválidos).

## 5.8 Dependências

- **Fase 1** (Estrategista Fundação): seed de classes COMPLETO em `prisma/seeds/classes.seed.ts` antes do primeiro endpoint. Schema Prisma estável (DEntidade, DTabela, DVincula, DProject, DTask, DEvento com colunas `dados Json`).
- **Fase 2** (Auth): JwtAuthGuard, OrgTenantGuard, JWT payload com `entidadeId`, `organizationId`, `role`.
- **Fase 0** (Setup): PrismaService, TimezoneService, Logger, Module structure.

## 5.9 Riscos e mitigações

| Risco | Severidade | Mitigação |
|-------|-----------|-----------|
| Race condition no identifier público (DEV-7 duplicado) | ALTA | Lock pessimista via SQL raw com `jsonb_set` em UPDATE atômico dentro da transação. Teste F.3 valida 10 threads concorrentes. |
| Performance: listagem de tasks com filtros virá com N+1 se include não for cuidadoso | ALTA | Reviewer obrigatório verifica via `DATABASE_LOGGING=true`. Usar select tipado. Index em (idProject, idStatus), (idProject, criadoPor). |
| Tentativa de Implementer criar SprintsController/StatusesController duplicando endpoint genérico | ALTA | README explícito + Reviewer rejeita. Mencionar Pilar 2 nos PRs. |
| Soft delete em cascata mal feito (órfãos em DVincula, DTabela) | MÉDIA | Uma transação $transaction única por delete; testes de integridade pós-delete. |
| Schema Json em DTask.dados sem validação leva a inconsistências | MÉDIA | zod schemas obrigatórios em todas as escritas/leituras (`TaskDadosSchema.parse()`). |
| Permissões cross-org (user de org A vê task de org B) | CRÍTICA | OrgTenantGuard em todos os controllers + double-check em service via `where: { idOrganizacao: user.orgId }`. |
| Engine acidentalmente usado em DTask | BAIXA (mas inaceitável) | Reviewer reject score <5. Documenter atualiza CLAUDE.md do V2 deixando claro: "Pilar 1 NÃO se aplica a DTask". |

## 5.10 Definition of Done (checklist exaustivo — 22 itens)

- [ ] Seed `prisma/seeds/classes.seed.ts` validado (todas DClasses -150..-475 presentes, hierarquia correta, todos `idPai` válidos)
- [ ] PrismaService usado em 100% dos services (zero DatabaseService)
- [ ] BigInt em 100% dos IDs (zero Number, zero parseInt)
- [ ] Transactions em: createOrganization, createTeam, createProject, createTask, deleteOrganization, deleteProject, deleteTask
- [ ] TimezoneService em 100% dos filtros de data (zero `new Date()` manual em where)
- [ ] EntidadeService.getEntidadeIdFromUserGroup centralizado (1 implementação, cache LRU)
- [ ] ZERO N+1 queries verificado (DATABASE_LOGGING=true em testes; target 3-7 queries por listagem de 20 itens)
- [ ] DTOs com class-validator + Swagger ApiProperty em 100% dos endpoints
- [ ] Guards aplicados: JwtAuthGuard + OrgTenantGuard em todos os endpoints privados; RolesGuard onde apropriado
- [ ] Logger NestJS em todos os services (zero console.log)
- [ ] HttpException semânticas (NotFoundException, ConflictException, BadRequestException, ForbiddenException)
- [ ] State machine de tasks com 9 estados V3 e ~12 transições mapeadas e validadas
- [ ] Identifier público atômico (teste F.3 com 10 threads concorrentes passa)
- [ ] Endpoint genérico `/tabelas` reusado para Sprints, Statuses, Priorities, Task Types (NÃO duplicado)
- [ ] README.md em `src/sprints/` e `src/workflow-statuses/` documentando reuso
- [ ] DProject.dados Json validado via zod schema em todos os pontos de escrita/leitura
- [ ] DTask.dados Json validado via zod schema (idem)
- [ ] Soft delete cascade testado (org → team → projects → tasks → memberships → DTabelas)
- [ ] Cursor pagination em: GET /entidades, /tabelas, /tasks, /projects, /projects/:id/activity
- [ ] Build passa: `npm run build` (TypeScript strict 0 errors)
- [ ] Cobertura de testes ≥ 80% em services Fase 5
- [ ] Pilar 1 NÃO usado em DTask/DProject/DEntidade/DTabela/DVincula (Reviewer confirma)

## 5.11 Tempo estimado

**Total:** 2,5 a 3 semanas (Implementer dedicado)

| Bloco | Tempo |
|-------|-------|
| A — Endpoints genéricos | 3-4 dias |
| B — Organizations + Teams + Memberships | 4-5 dias |
| C — Projects | 3-4 dias |
| D — Sprints/Statuses/Priorities/TaskTypes (reuso) | 1-2 dias |
| E — Tasks (state machine + identifier) | 4-5 dias |
| F — Testes | 2-3 dias |

## 5.12 Como validar (smoke tests)

```bash
# 1. Subir banco + rodar migrations + seed
make db-up
npx prisma migrate deploy
npx prisma db seed

# 2. Validar seed
psql -h localhost -p 15432 -U scrumban -d scrumban_v2 \
  -c "SELECT COUNT(*) FROM \"DClasse\" WHERE chave < 0;"
# Esperado: ~76 (50 fixas + 26 específicas)

# 3. Subir backend
npm run start:dev

# 4. Smoke E2E
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@test.com","password":"Smoke123!","nome":"Smoke","organizationName":"SmokeOrg"}' \
  | jq -r '.accessToken')

# Criar projeto
PROJ=$(curl -s -X POST http://localhost:3000/api/v1/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Test Project"}' | jq -r '.chave')

# Listar sprints (via endpoint genérico — Pilar 2)
curl -s "http://localhost:3000/api/v1/tabelas?idClasse=-400&dEntidadeId=$PROJ" \
  -H "Authorization: Bearer $TOKEN" | jq

# Listar statuses (via endpoint genérico)
curl -s "http://localhost:3000/api/v1/tabelas?idClasse=-440&dEntidadeId=$PROJ" \
  -H "Authorization: Bearer $TOKEN" | jq
# Esperado: 9 linhas (INBOX, READY, EXECUTING, DONE, FAILED, CANCELLED, DISCARDED, VALIDATING, VALIDATED)

# Criar task
TASK=$(curl -s -X POST http://localhost:3000/api/v1/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"nome\":\"First task\",\"projectId\":\"$PROJ\"}" | jq -r '.chave')

# Validar identifier público
curl -s "http://localhost:3000/api/v1/tasks/$TASK" -H "Authorization: Bearer $TOKEN" | jq '.identifier'
# Esperado: "DEV-1"

# Mover task INBOX → DONE (deve falhar — transição inválida)
curl -s -X PUT "http://localhost:3000/api/v1/tasks/$TASK/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"newStatusId":"-444"}'
# Esperado: 400 BadRequest com lista de transições válidas

# Mover task INBOX → READY (válida)
curl -s -X PUT "http://localhost:3000/api/v1/tasks/$TASK/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"newStatusId":"-442"}' | jq
# Esperado: 200 com idStatus=-442 e dados.telemetry.readyAt populado
```

---

# FASE 6 — Pilar 1 ATIVO: Engine + OperacaoExecucaoClaude

## 6.1 Objetivo

**Esta é a fase mais importante do V2. É onde o Pilar 1 nasce e o Devari Core deixa de ser apenas template — passa a EXECUTAR código de negócio via Engine OOP polimórfico.**

Implementar:

1. **Esqueleto base**: classe abstrata `Operacao` com sequence key via PostgreSQL e lifecycle (`nova()`, `erro()`).
2. **Engine cheio**: `OperacaoPedido` com workflow completo (carrega DVFS scripts, calcula, aprova, grava, scripts pré/pós).
3. **Engine V2 customizado** (CORAÇÃO): `OperacaoExecucaoClaude` que estende `OperacaoPedido`, tipa DPedido idClasse=-300 EXECUTION e implementa o ciclo Risk Gate → Approval → Run Claude → PR auto-open via DVFS scripts.
4. **DVFS canônicos** para Scrumban V2: `risk-gate-validator`, `command-validator`, `pr-auto-open`, `notification-dispatcher`.
5. **Approval Flow**: state machine com expiração e endpoints de approve/reject/rollback.
6. **DTOs canônicos** com class-validator + Swagger.

**Esta fase substitui DExecution por DPedido + Engine + DVFS.** Quando concluída:
- Não existe mais "DExecution" no schema do V2.
- Cada execução = 1 linha em DPedido idClasse=-300 EXECUTION + N linhas de log em DEvento -496 EXECUTION_LOG.
- Risk Gate é um SCRIPT DVFS — pode ser trocado em runtime sem deploy.
- PR auto-open é um SCRIPT DVFS pós-gravação — extensível para GitLab, Bitbucket, etc.

## 6.2 Pilares ativados / respeitados

| Pilar | Aplicação |
|-------|-----------|
| **Pilar 1 (Engine)** | **CORAÇÃO desta fase.** OperacaoExecucaoClaude é o primeiro Engine de negócio do V2. Sem ele, V2 não existe. |
| **Pilar 2 (Endpoints)** | Endpoint `/executions/*` é específico (justificado: lógica Engine, approval flow, multi-step). NÃO duplica `/pedidos`. Razão: filtragem por projectId + status é semântica de domínio diferente de pedido fintech. |
| **Pilar 3 (Seed)** | Adicionar classes -300 EXECUTION, -301 LOW_RISK, -302 MEDIUM_RISK, -303 HIGH_RISK (Pedido), e classes DVFS chaves 3,4,5,6,7 (já existem como classes globais Devari, mas linhas DVFS específicas por projeto são criadas via seed Fase 1+1.5). |

## 6.3 Padrões obrigatórios aplicados

- **Pilar 1 inteiro** (devari-3-pilares.md seção 1)
- **Pilar Engine OOP** (devari-polymorphic-engine.md seções 2, 4, 5, 6)
- **#1, #2, #3, #6, #7, #8** (BigInt, transactions, ZERO N+1, eventos pós-persistência, Decimal)
- **#13** Service pattern
- **#14** EventProducerService (consumido aqui — emitido em Fase 7)
- **As 3 Dimensões** do modelo polimórfico (devari-polymorphic-engine.md seção 1)

## 6.4 Tabelas canônicas envolvidas

| Tabela | Uso na Fase 6 |
|--------|---------------|
| **DPedido** | TABELA CENTRAL desta fase. Cada execução = 1 linha. idClasse=-300 EXECUTION. Workflow: nova→calcula→aprova→grava |
| **DVFS** | Scripts polimórficos: risk-gate (chave=3 pré-cálculo), command-validator (chave=4 cálculo), pr-auto-open (chave=7 pós-gravação), notification-dispatcher (chave=7) |
| **DEvento** | Audit trail (idClasse=-496 EXECUTION_LOG) — captura cada step do workflow |
| **DProject** | Read-only (resolve agente, paths, deploy keys via DProject.dados.automation) |
| **DEntidade** | Read-only (resolve User criador, Agent target via idClasse AGENT) |
| **DTask** | Cross-link: execução pode estar associada a uma task; após PR open, atualiza DTask.dados.automation.prUrl |
| **DTitulo, DMovDispo, DMovDepos** | NÃO usados (não há lógica financeira em Scrumban V2) |
| **DRecurso** | NÃO usado nesta fase |

## 6.5 DClasses a criar nesta fase

| Chave | Código | Nome | idPai | Agrupamento | Propósito |
|-------|--------|------|-------|-------------|-----------|
| -20 | PEDIDOS | Pedidos | -2 | true | (já existe no base — fixa) |
| -300 | EXECUTION | Execução Claude | -20 | true | Tipo de pedido: execução autônoma |
| -301 | EXEC_LOW | Execução Risk LOW | -300 | false | Auto-approve |
| -302 | EXEC_MED | Execução Risk MEDIUM | -300 | false | Approve com teste+rollback automático |
| -303 | EXEC_HIGH | Execução Risk HIGH | -300 | false | Aprovação manual obrigatória |
| -310 | AGENT | Agente Remoto VPS | -43 | false | DEntidade para representar agente |

> **Decisão arquitetural justificada (deve virar ADR):** distinguir LOW/MED/HIGH via idClasse específico (em vez de apenas campo `dados.riskLevel`) permite usar polimorfismo total — DVFS scripts diferentes por nível de risco, queries via `WHERE idClasse=-303` para listar pendentes de aprovação manual.

## 6.6 Estrutura de arquivos esperada

```
src/
├── engine/
│   ├── lib/
│   │   ├── operacao/
│   │   │   ├── Operacao.ts                    [BASE — abstract class, sequence key + lifecycle, ~80L]
│   │   │   ├── OperacaoPedido.ts              [FULL workflow — DVFS load, calcula, aprova, grava, ~800L]
│   │   │   └── OperacaoExecucaoClaude.ts      [V2 EXTENSION — coração, ~600L]
│   │   ├── auxiliares/
│   │   │   ├── PedidoCabecalho.ts             [setters, getters, dados encapsulados]
│   │   │   ├── PedidoItens.ts                 [coleção de itens — N/A para execution? avaliar]
│   │   │   └── PedidoItem.ts
│   │   └── interfaces/
│   │       ├── IOperacaoConstruct.ts
│   │       ├── IOperacaoPedidoConstruct.ts
│   │       ├── IOperacaoExecucaoClaudeConstruct.ts
│   │       └── IExecucaoData.ts               [tipagem dos campos em DPedido.dados]
│   ├── helpers/
│   │   ├── sequence.helper.ts                 [getNextSequenceKey() via nextval('chcriacao_seq')]
│   │   ├── dvfs-loader.helper.ts              [carrega + cacheia + executa scripts DVFS]
│   │   └── execution-context.helper.ts        [resolve userId, agentId, projectId]
│   └── dvfs/
│       ├── risk-gate-validator.js              [chave=3 pré-cálculo: classifica LOW/MED/HIGH]
│       ├── command-validator.js                [chave=4 cálculo: valida comando, blacklist, path traversal]
│       ├── pr-auto-open.js                     [chave=7 pós-gravação: chama GitHub API, cria PR]
│       └── notification-dispatcher.js          [chave=7: emite DEventos de notificação]
│
├── executions/
│   ├── executions.module.ts
│   ├── executions.controller.ts                [POST /projects/:id/execute, GET /executions/:id, POST /executions/:id/approve|reject|rollback, GET /executions]
│   ├── executions.service.ts                   [orquestra OperacaoExecucaoClaude]
│   ├── approval-flow.service.ts                [state machine, sweeper @Cron expira awaiting_approval >1h]
│   ├── execution-history.service.ts            [list executions com cursor pagination]
│   ├── claude-runner.service.ts                [invoca agente via tunel, captura stdout/stderr/exitCode]
│   ├── dto/
│   │   ├── execute-command.dto.ts
│   │   ├── execution-response.dto.ts
│   │   ├── approve-execution.dto.ts
│   │   └── reject-execution.dto.ts
│   ├── guards/
│   │   ├── execution-throttler.guard.ts        [30 req/min por path-param hash]
│   │   └── execution-access.guard.ts           [valida user é membro do projeto]
│   └── executions.service.spec.ts
│
└── automation/                                 [stub — Fase 10 implementa agentes reais]
    └── agents/
        ├── agent-tunnel.service.ts             [stub — Fase 10]
        └── agent.service.ts                    [stub — apenas read AGENT entidade]
```

**Linhas estimadas Fase 6:** ~5.000 a 6.500 linhas TypeScript (incluindo DVFS scripts e testes).

## 6.7 Esqueleto de código TypeScript — `OperacaoExecucaoClaude.ts`

> Este é o coração técnico do V2. Esqueleto abaixo serve como referência canônica para o Implementer.

```typescript
// src/engine/lib/operacao/OperacaoExecucaoClaude.ts

import OperacaoPedido, { IOperacaoPedidoConstruct } from './OperacaoPedido';
import { Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Tipagem dos campos que vão em DPedido.dados (Json) para uma Execution.
 * Validação via zod no service.
 */
export interface IExecucaoData {
  // Comando solicitado
  command: {
    text: string;                       // O prompt/comando original
    cwd?: string;                       // Working dir relativo ao project remotePath
    env?: Record<string, string>;       // Vars de ambiente extras (sanitizadas)
    timeoutMs?: number;
  };

  // Risk Gate
  risk?: {
    level: 'LOW' | 'MEDIUM' | 'HIGH';
    explanation: string;
    matchedPatterns: string[];
    classifiedAt: string;               // ISO 8601
  };

  // Approval Flow
  approval?: {
    status: 'queued' | 'awaiting_approval' | 'approved' | 'rejected' | 'expired';
    approvedBy?: string;                // entidadeId
    rejectedBy?: string;
    rejectedReason?: string;
    expiresAt?: string;
    decidedAt?: string;
  };

  // Claude runtime
  claude?: {
    sessionId?: string;
    sessionPath?: string;
    stdout?: string;                    // truncated 1MB
    stderr?: string;                    // truncated 1MB
    exitCode?: number;
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
  };

  // Git workflow (após sucesso)
  git?: {
    headBefore?: string;                // commit hash antes
    headAfter?: string;                 // commit hash após
    branch?: string;                    // scrumban/auto-<chave>
    commitMessage?: string;
    pushedAt?: string;
    filesChanged?: number;
  };

  // PR auto-open
  pullRequest?: {
    url?: string;
    number?: number;
    openedAt?: string;
    rolledBackAt?: string;
    rollbackRef?: string;
  };

  // Vínculo task (opcional)
  task?: {
    id?: string;                        // taskId associada
  };

  // Audit
  audit?: {
    correlationId: string;
    triggeredBy: string;                // entidadeId do user
    agentId: string;                    // entidadeId do AGENT (-310)
    projectId: string;
  };
}

export interface IOperacaoExecucaoClaudeConstruct extends IOperacaoPedidoConstruct {
  projectId: string;
  agentId: string;
  taskId?: string;
  command: IExecucaoData['command'];
  correlationId: string;

  // Services injetados (para chamar do dentro do Engine)
  agentTunnelService: any;       // tipado em Fase 10
  eventProducer: any;            // tipado em Fase 7
  githubClient?: any;            // injeção via factory (DProject.dados.automation define org/repo)
}

/**
 * OperacaoExecucaoClaude — Engine V2 que orquestra execução de Claude Code
 * via agente remoto VPS, com Risk Gate, Approval Flow e PR auto-open.
 *
 * Estende OperacaoPedido para herdar o workflow polimórfico (nova/calcula/aprova/grava)
 * e a infraestrutura de scripts DVFS (Dimensão 3 do modelo polimórfico).
 *
 * Fluxo end-to-end:
 *   1. service.execute(dto) → new OperacaoExecucaoClaude(...)
 *   2. await op.nova()             — carrega DVFS chaves 3,4,5,6,7
 *   3. op.pedidoCab.setValor(0)    — execution não tem valor financeiro
 *   4. op.pedidoCab.setPessoa(triggeredBy)
 *   5. op.setExecucaoData({ command, ... })
 *   6. await op.calcula()
 *      → executa DVFS chave 3 (risk-gate-validator) → classifica LOW/MED/HIGH
 *      → executa DVFS chave 4 (command-validator) → valida path traversal, blacklist
 *      → atualiza op.dados.risk
 *   7. Decisão de approval (fora do Engine, no Service):
 *      LOW → await op.aprova({ aprovador: 'auto:risk-gate-low' })
 *      MED → executa com auto-rollback se test falhar (await op.aprova({ aprovador: 'auto:risk-gate-medium' }))
 *      HIGH → grava como awaiting_approval, aguarda POST /executions/:id/approve
 *   8. await op.grava()
 *      → persiste DPedido idClasse=-301|-302|-303 conforme risk
 *      → executa DVFS chave 6 (pré-gravação): última validação
 *      → INSERT DPedido (transação)
 *      → executa DVFS chave 7 (pós-gravação): pr-auto-open + notification-dispatcher
 *      → Após sucesso: chama agentTunnelService.runClaudeCode()
 *      → Captura stdout/stderr/exitCode em op.dados.claude
 *      → Se exit=0: agente faz git commit+push + DVFS pr-auto-open chama GitHub API
 *      → Atualiza DPedido.dados.git e DPedido.dados.pullRequest
 *      → Emite eventos via eventProducer (após persistência — Padrão #7)
 *
 * @example Uso no service (Fase 6 ExecutionsService):
 *   const op = new OperacaoExecucaoClaude({ ... });
 *   await op.nova();
 *   op.setExecucaoData({ command: dto.command });
 *   await op.calcula();
 *   if (op.dados.risk.level === 'HIGH') {
 *     // Não chama aprova ainda — espera ADMIN via endpoint
 *     await op.gravarComoAwaitingApproval();
 *     return op.pedidoCab.getData();
 *   }
 *   await op.aprova({ aprovador: `auto:risk-gate-${op.dados.risk.level.toLowerCase()}` });
 *   await op.grava();
 *   return op.pedidoCab.getData();
 */
export default class OperacaoExecucaoClaude extends OperacaoPedido {
  private readonly logger = new Logger(OperacaoExecucaoClaude.name);

  public dados: IExecucaoData;
  protected readonly projectId: bigint;
  protected readonly agentId: bigint;
  protected readonly taskId?: bigint;
  protected readonly correlationId: string;
  protected readonly agentTunnelService: any;
  protected readonly eventProducer: any;
  protected readonly githubClient?: any;

  constructor(params: IOperacaoExecucaoClaudeConstruct) {
    // 1. Chama super (OperacaoPedido) — ativa Proxy de cache invalidation,
    //    inicializa pedidoCab, _itensPedido, etc.
    super(params);

    // 2. Armazena referências específicas de Execution
    this.projectId = BigInt(params.projectId);
    this.agentId = BigInt(params.agentId);
    this.taskId = params.taskId ? BigInt(params.taskId) : undefined;
    this.correlationId = params.correlationId;
    this.agentTunnelService = params.agentTunnelService;
    this.eventProducer = params.eventProducer;
    this.githubClient = params.githubClient;

    // 3. Inicializa dados com defaults
    this.dados = {
      command: params.command,
      audit: {
        correlationId: params.correlationId,
        triggeredBy: params.usuario,
        agentId: params.agentId,
        projectId: params.projectId,
      },
      task: params.taskId ? { id: params.taskId } : undefined,
    };
  }

  /**
   * Sobrescreve `nova()` para também carregar scripts DVFS específicos de execution.
   * Reutiliza super.nova() (sequence key + load DVFS chaves 3..7 via super._carregaScriptsCalc/Grav).
   */
  async nova(chaveCustom?: number): Promise<void> {
    await super.nova(chaveCustom);
    this.logger.log(
      `[${this.correlationId}] Execution iniciada chave=${this.chcriacao}`,
    );
  }

  /**
   * Helper público para popular dados da execução antes de calcula/aprova/grava.
   */
  setExecucaoData(data: Partial<IExecucaoData>): void {
    this.dados = { ...this.dados, ...data };
    // Proxy do super invalidará _operacaoCalculada automaticamente
  }

  /**
   * Sobrescreve calcula() para integrar Risk Gate + Command Validator.
   * O super.calcula() executa _funcPreCalculo (DVFS 3), _funcCalculo (DVFS 4), _funcPosCalculo (DVFS 5).
   * Aqui passamos `this` para os scripts manipularem `this.dados.risk` e `this.dados.command`.
   */
  async calcula(): Promise<void> {
    if (!this._funcPreCalculo) {
      this.erro({
        mensagem:
          'DVFS chave 3 (risk-gate-validator) não carregado. Verifique seed da DVFS.',
      });
    }
    if (!this._funcCalculo) {
      this.erro({
        mensagem:
          'DVFS chave 4 (command-validator) não carregado. Verifique seed da DVFS.',
      });
    }

    this.logger.log(
      `[${this.correlationId}] Calculando: risk-gate + command-validator`,
    );

    // super.calcula() chama os _funcPreCalculo/_funcCalculo/_funcPosCalculo
    // Os scripts DVFS recebem `this` como contexto
    await super.calcula();

    if (!this.dados.risk) {
      this.erro({
        mensagem:
          'Risk Gate não classificou execução. Script DVFS chave 3 com bug?',
      });
    }

    // Determina idClasse final baseado em risk
    const classeMap: Record<string, number> = {
      LOW: -301,
      MEDIUM: -302,
      HIGH: -303,
    };
    this._classeBase = classeMap[this.dados.risk.level].toString();

    this.logger.log(
      `[${this.correlationId}] Risk Gate: ${this.dados.risk.level}, idClasse=${this._classeBase}`,
    );
  }

  /**
   * Sobrescreve aprova() para registrar approver (humano ou auto:risk-gate-low) em dados.approval.
   */
  async aprova(params: { aprovador: string }): Promise<void> {
    await super.aprova(params);
    this.dados.approval = {
      ...this.dados.approval,
      status: 'approved',
      approvedBy: params.aprovador,
      decidedAt: new Date().toISOString(),
    };
    this.logger.log(
      `[${this.correlationId}] Approved by ${params.aprovador}`,
    );
  }

  /**
   * Helper específico de Execution: gravar como awaiting_approval para risk HIGH.
   * Não chama aprova() — apenas persiste com approval.status = 'awaiting_approval'.
   * Endpoint POST /executions/:id/approve depois invoca aprova() + grava() final.
   */
  async gravarComoAwaitingApproval(expiresInMs = 3600000): Promise<void> {
    this.dados.approval = {
      status: 'awaiting_approval',
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    };
    this._baixado = null; // Não aprovado
    // Persiste apenas o cabeçalho com status pending
    await this._gravarParcialmente();
  }

  /**
   * grava() complete — persiste DPedido + dispara Claude Runner + PR open.
   * super.grava() faz a persistência. Após persistência, scripts DVFS chaves 6,7 rodam.
   */
  async grava(): Promise<void> {
    // Popula pedidoCab para super.grava()
    this.pedidoCab.setValor(new Decimal(0));            // execution não tem valor monetário
    this.pedidoCab.setDados(this.dados);                // serializa para DPedido.dados Json

    // 1. Persistência via super.grava() — executa DVFS 6 (pre-grav) e 7 (pos-grav)
    await super.grava();

    this.logger.log(
      `[${this.correlationId}] DPedido idClasse=${this._classeBase} persistido. chave=${this.chcriacao}`,
    );

    // 2. Após persistência: emite evento canônico (Padrão #7 — APÓS persistir)
    await this.eventProducer.addInternalEvent(
      `execution.${this.dados.risk.level.toLowerCase()}.created`,
      {
        executionId: this.chcriacao.toString(),
        projectId: this.projectId.toString(),
        riskLevel: this.dados.risk.level,
        triggeredBy: this.dados.audit.triggeredBy,
        approval: this.dados.approval?.status,
      },
      this.correlationId,
    );

    // 3. Se status='approved' (LOW auto, MED auto, HIGH manual): dispara Claude Runner
    if (this.dados.approval?.status === 'approved') {
      await this._executarClaude();
    }
  }

  /**
   * Executa Claude Code via agente remoto (após approval).
   * Atualiza DPedido.dados.claude e dados.git, dados.pullRequest.
   * Re-grava o registro com os resultados.
   */
  private async _executarClaude(): Promise<void> {
    this.dados.claude = {
      startedAt: new Date().toISOString(),
    };

    try {
      const result = await this.agentTunnelService.runClaudeCode({
        agentId: this.agentId,
        projectId: this.projectId,
        executionId: this.chcriacao,
        command: this.dados.command.text,
        cwd: this.dados.command.cwd,
        timeoutMs: this.dados.command.timeoutMs ?? 600000,
        correlationId: this.correlationId,
      });

      this.dados.claude = {
        ...this.dados.claude,
        sessionId: result.sessionId,
        sessionPath: result.sessionPath,
        stdout: this._truncate(result.stdout, 1024 * 1024),
        stderr: this._truncate(result.stderr, 1024 * 1024),
        exitCode: result.exitCode,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(this.dados.claude.startedAt!).getTime(),
      };

      // Se sucesso (exit=0) e modificou arquivos: agente já fez git commit+push, DVFS pr-auto-open faz PR
      if (result.exitCode === 0 && result.headAfter && result.headAfter !== result.headBefore) {
        this.dados.git = {
          headBefore: result.headBefore,
          headAfter: result.headAfter,
          branch: `scrumban/auto-${this.chcriacao}`,
          commitMessage: result.commitMessage,
          pushedAt: result.pushedAt,
          filesChanged: result.filesChanged,
        };

        // Trigger DVFS chave 7 manualmente para PR open (com contexto atualizado)
        if (this._funcPosGravacao) {
          await this._funcPosGravacao(this);
        }
      }

      // Update DPedido com resultados
      await this._atualizarPedidoCompleto();

      // Emit event final
      await this.eventProducer.addInternalEvent(
        result.exitCode === 0 ? 'execution.succeeded' : 'execution.failed',
        {
          executionId: this.chcriacao.toString(),
          exitCode: result.exitCode,
          prUrl: this.dados.pullRequest?.url,
        },
        this.correlationId,
      );
    } catch (err) {
      this.dados.claude = {
        ...this.dados.claude,
        finishedAt: new Date().toISOString(),
        exitCode: -1,
        stderr: err.message,
      };
      await this._atualizarPedidoCompleto();

      await this.eventProducer.addInternalEvent(
        'execution.failed',
        {
          executionId: this.chcriacao.toString(),
          error: err.message,
        },
        this.correlationId,
      );

      this.erro({ mensagem: `Execução Claude falhou: ${err.message}` });
    }
  }

  private _truncate(str: string | undefined, maxBytes: number): string | undefined {
    if (!str) return str;
    if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
    return Buffer.from(str, 'utf8').slice(0, maxBytes).toString('utf8') + '\n... [TRUNCATED]';
  }

  private async _atualizarPedidoCompleto(): Promise<void> {
    // UPDATE DPedido SET dados = ..., chalteracao = NOW() WHERE chave = this.chcriacao
    await this._database.dPedido.update({
      where: { chave: this.chcriacao },
      data: { dados: this.dados as any },
    });
  }

  private async _gravarParcialmente(): Promise<void> {
    // Persiste DPedido em estado awaiting_approval (sem chamar workflow completo)
    this.pedidoCab.setValor(new Decimal(0));
    this.pedidoCab.setDados(this.dados);
    await super.grava(); // OK — super.grava() respeita _baixado=null
  }
}
```

## 6.8 DVFS Scripts — referência de assinatura

> Scripts DVFS são strings JavaScript executadas via `eval()` dentro do Engine. São portáveis: o mesmo Engine pode rodar com scripts diferentes em projetos diferentes. Para Scrumban V2, definimos os 4 scripts canônicos abaixo. Eles vivem em `src/engine/dvfs/*.js` durante desenvolvimento e são SEED'ed na DVFS via Fase 1.5 (sub-fase do seed).

### `risk-gate-validator.js` (chave=3, pré-cálculo)

```javascript
// Recebe `op` (instância OperacaoExecucaoClaude) como contexto.
// Classifica risk com base no command.text. ~50 patterns adversariais (validados em Scrumban V1).

(function (op) {
  const text = (op.dados.command.text || '').toLowerCase();
  const HIGH_PATTERNS = [
    /migration/, /\bdrop\s+table\b/, /\bdelete\s+from\b/, /\.env/,
    /\bsecret\b/, /\bpassword\b/, /private[_-]?key/, /\bproduction\b/,
    /\bforce[-_]push\b/, /reset\s+--hard/, /\brm\s+-rf\b/,
    /\baws[_-]?(access|secret)/, /credentials?/, /\btoken\b/,
    // ... ~25 patterns HIGH (importar de Scrumban V1)
  ];
  const MEDIUM_PATTERNS = [
    /\brefactor\b/, /\bmigrate\b/, /\bschema\b/, /database/,
    /\bconfig\b/, /dependenc(y|ies)/, /\bpackage\b/,
    // ... ~15 patterns
  ];

  const matchedHigh = HIGH_PATTERNS.filter(p => p.test(text)).map(p => p.source);
  const matchedMed = MEDIUM_PATTERNS.filter(p => p.test(text)).map(p => p.source);

  let level, explanation;
  if (matchedHigh.length > 0) {
    level = 'HIGH';
    explanation = 'Detected high-risk patterns: ' + matchedHigh.join(', ');
  } else if (matchedMed.length > 0) {
    level = 'MEDIUM';
    explanation = 'Detected medium-risk patterns: ' + matchedMed.join(', ');
  } else {
    level = 'LOW';
    explanation = 'No risk patterns detected.';
  }

  op.dados.risk = {
    level,
    explanation,
    matchedPatterns: [...matchedHigh, ...matchedMed],
    classifiedAt: new Date().toISOString(),
  };
})
```

### `command-validator.js` (chave=4, cálculo)

```javascript
(function (op) {
  const cwd = op.dados.command.cwd || '';
  // Valida path traversal
  if (cwd.includes('..') || /\/etc|\/var|\/root|\/home\/(?!scrumban-agent)/.test(cwd)) {
    throw new Error('Path traversal ou path proibido em cwd: ' + cwd);
  }
  // Valida que command.text não está vazio
  if (!op.dados.command.text || op.dados.command.text.trim().length === 0) {
    throw new Error('command.text não pode estar vazio');
  }
  // Valida tamanho máximo
  if (op.dados.command.text.length > 50000) {
    throw new Error('command.text excede 50000 caracteres');
  }
})
```

### `pr-auto-open.js` (chave=7, pós-gravação)

```javascript
async function (op) {
  if (!op.dados.git || !op.dados.git.headAfter || op.dados.git.headAfter === op.dados.git.headBefore) {
    return; // Nada a fazer — não houve mudança no repo
  }

  const githubClient = op._githubClient || op.githubClient;
  if (!githubClient) {
    return; // Sem cliente configurado (org sem GitHub) — pula PR
  }

  // Carrega config do projeto
  const project = await op._database.dProject.findFirst({
    where: { chave: op.projectId },
    select: { dados: true, nome: true },
  });
  const repoUrl = project?.dados?.automation?.remoteRepoUrl;
  if (!repoUrl) return;

  // Parse owner/repo de "git@github.com:owner/repo.git"
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(repoUrl);
  if (!m) return;
  const [, owner, repo] = m;

  try {
    const pr = await githubClient.pulls.create({
      owner,
      repo,
      head: op.dados.git.branch,
      base: project.dados?.automation?.remoteBranch || 'main',
      title: `[scrumban] Execution #${op.chcriacao}: ${op.dados.command.text.slice(0, 60)}`,
      body: `Automated execution via Scrumban V2.\n\nCommand:\n\`\`\`\n${op.dados.command.text}\n\`\`\`\n\nFiles changed: ${op.dados.git.filesChanged}\nCorrelation: ${op.dados.audit.correlationId}`,
    });

    op.dados.pullRequest = {
      url: pr.data.html_url,
      number: pr.data.number,
      openedAt: new Date().toISOString(),
    };
  } catch (err) {
    // Fallback: gera URL genérica de "create PR" (não auto-open, mas usável)
    op.dados.pullRequest = {
      url: `https://github.com/${owner}/${repo}/pull/new/${op.dados.git.branch}`,
      openedAt: new Date().toISOString(),
    };
  }
}
```

### `notification-dispatcher.js` (chave=7, pós-gravação)

```javascript
async function (op) {
  // Cria DEvento idClasse=-490 NOTIFICATION para owner do projeto + assignees da task
  const project = await op._database.dProject.findFirst({
    where: { chave: op.projectId },
    select: { idOwner: true, nome: true },
  });

  const recipients = new Set();
  recipients.add(project.idOwner);

  if (op.taskId) {
    const task = await op._database.dTask.findFirst({
      where: { chave: op.taskId },
      select: { criadoPor: true },
    });
    if (task) recipients.add(task.criadoPor);
  }

  for (const recipientId of recipients) {
    await op._database.dEvento.create({
      data: {
        idClasse: BigInt(-490),                     // NOTIFICATION
        idEntidade: recipientId,
        identificadorExterno: op.dados.audit.correlationId,
        descricao: `Execution #${op.chcriacao} ${op.dados.approval?.status || 'started'} (${op.dados.risk.level})`,
        metaDados: {
          executionId: op.chcriacao.toString(),
          projectId: op.projectId.toString(),
          riskLevel: op.dados.risk.level,
          status: op.dados.approval?.status,
          prUrl: op.dados.pullRequest?.url,
        },
      },
    });
  }
}
```

## 6.9 Tarefas detalhadas

### Bloco G — Engine base e infraestrutura

**G.1.** Criar `src/engine/helpers/sequence.helper.ts`:
```typescript
export async function getNextSequenceKey(prisma: PrismaService): Promise<bigint> {
  const result = await prisma.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('chcriacao_seq')`;
  return result[0].nextval;
}
```
Seed da Fase 1 deve criar `CREATE SEQUENCE IF NOT EXISTS chcriacao_seq START WITH 1`.

**G.2.** Criar `src/engine/lib/operacao/Operacao.ts` (classe abstrata, ~80 linhas) seguindo o blueprint do RELATORIO seção 4.3.

**G.3.** Criar `src/engine/lib/operacao/OperacaoPedido.ts` (~800 linhas) — seguindo blueprint da seção 4.4 do RELATORIO mas SIMPLIFICADO para Scrumban V2 (remover acoplamento fintech: paymentProcessor, settlement, antifraud — todos opcionais, ausentes no V2). O workflow completo (calcula com DVFS 3,4,5; aprova; grava com DVFS 6,7) deve estar funcional. **CORRIGIR o bug latente identificado no RELATORIO linha 314 (s.id vs s.chave) — usar `s.chave` consistentemente.**

**G.4.** Criar auxiliares: `PedidoCabecalho.ts`, `PedidoItens.ts`, `PedidoItem.ts` (versões simplificadas — Execution não tem itens múltiplos, apenas cabeçalho. Ainda assim, criar a estrutura para compatibilidade com outros Engines futuros).

**G.5.** Criar `src/engine/helpers/dvfs-loader.helper.ts`: utilitário centralizado para carregar scripts DVFS por chave (in-memory cache, invalidate via TTL ou flag).

### Bloco H — DVFS Scripts (criar arquivos + seed)

**H.1.** Criar 4 arquivos `.js` em `src/engine/dvfs/` (conforme 6.8). Build copia para `dist/engine/dvfs/`.

**H.2.** Criar `prisma/seeds/dvfs.seed.ts` que insere 4 linhas em DVFS:
```typescript
const dvfsRecords = [
  { chave: 3, nome: 'risk-gate-validator', script: fs.readFileSync('src/engine/dvfs/risk-gate-validator.js', 'utf8') },
  { chave: 4, nome: 'command-validator', script: fs.readFileSync('src/engine/dvfs/command-validator.js', 'utf8') },
  { chave: 7, nome: 'pr-auto-open-and-notification', script: combinedScript([prAutoOpen, notificationDispatcher]) },
  // chave 5,6 vazios para Scrumban V2 (preparados para extensão)
];
```

**H.3.** Coordenar com Estrategista da Fase 1 para incluir essa seed em `prisma/seed.ts` principal.

### Bloco I — OperacaoExecucaoClaude

**I.1.** Implementar `OperacaoExecucaoClaude.ts` conforme esqueleto 6.7. Validar:
- super(params) no constructor
- Override de nova(), calcula(), aprova(), grava()
- _executarClaude com try/catch + timeout
- Atualização de DPedido pós-Claude via _atualizarPedidoCompleto()

**I.2.** Tipagem `IExecucaoData` em `src/engine/lib/interfaces/IExecucaoData.ts`. zod schema em `src/executions/schemas/execucao-data.schema.ts`.

**I.3.** Testes unitários: 30+ cenários cobrindo:
- Risk Gate classifica LOW/MED/HIGH corretamente (10 prompts cada)
- Command Validator rejeita path traversal (5 cenários)
- gravarComoAwaitingApproval persiste sem chamar grava completa
- _truncate respeita limite 1MB
- Override de nova() carrega DVFS

### Bloco J — ExecutionsService + Controller

**J.1.** `ExecutionsService.execute(projectId, dto, userId)`:
```typescript
// 1. Valida acesso ao projeto (membership)
// 2. Resolve agentId via DProject.dados.automation.idAgent ou erro 422
// 3. Cria correlationId
// 4. Instancia OperacaoExecucaoClaude
// 5. await op.nova(); op.setExecucaoData({ command }); await op.calcula();
// 6. Decide approval baseado em op.dados.risk.level:
//    LOW: await op.aprova({ aprovador: 'auto:risk-gate-low' }); await op.grava();
//    MEDIUM: aprova auto + grava + Claude executa com auto-rollback se test falhar
//    HIGH: await op.gravarComoAwaitingApproval(); return id (espera approve manual)
// 7. Retorna ExecutionResponseDto
```

**J.2.** `ExecutionsController`:
```
POST   /api/v1/projects/:id/execute              [ADMIN ou MEMBER, AgentThrottlerGuard 30/min]
GET    /api/v1/executions/:id                    [member do projeto]
GET    /api/v1/executions?projectId=&status=&riskLevel=&cursor=&limit=  [member]
POST   /api/v1/executions/:id/approve            [ADMIN]
POST   /api/v1/executions/:id/reject             [ADMIN, exige reason no body]
POST   /api/v1/executions/:id/rollback           [ADMIN, gera nova execution de rollback usando Engine]
```

**J.3.** `ApprovalFlowService`:
- `approve(executionId, userId)`: load DPedido, instancia OperacaoExecucaoClaude com dados existentes, chama `op.aprova({ aprovador: userId })`, depois `op.grava()` (que dispara Claude).
- `reject(executionId, userId, reason)`: UPDATE DPedido SET dados.approval = { rejected, rejectedBy, rejectedReason, decidedAt } + audit.
- `rollback(executionId, userId)`: cria NOVA OperacaoExecucaoClaude com command = "git reset --hard <originalHeadBefore> && git push --force-with-lease origin <branch>" — esse novo Pedido também passa por Risk Gate (será HIGH, exige approve), preserva trilha de auditoria.

**J.4.** `ApprovalFlowSweeperService` (`@Cron('* * * * *')` — cada minuto):
```typescript
const expired = await prisma.dPedido.updateMany({
  where: {
    idClasse: BigInt(-303),  // EXEC_HIGH apenas
    AND: [
      { dados: { path: ['approval', 'status'], equals: 'awaiting_approval' } },
      { dados: { path: ['approval', 'expiresAt'], lte: new Date().toISOString() } },
    ],
  },
  data: {
    dados: { /* JSON merge — usar SQL raw com jsonb_set */ },
  },
});
// Race-safe via updateMany + condição atômica
```

**J.5.** Endpoints auxiliares:
- `GET /projects/:id/claude-credential-status` — testa via agente se `~/.claude/auth.json` existe na VPS
- `GET /projects/:id/claude-token-instructions` — retorna texto markdown de instruções

### Bloco K — Throttler Guard

**K.1.** Implementar `ExecutionThrottlerGuard` (fork de NestJS ThrottlerGuard) com tracker baseado em `req.params.id` (projectId hash). Limite 30 req/min por projeto.

### Bloco L — Testes

**L.1.** Unit test do Engine: 30 cenários (Bloco I.3).
**L.2.** Integration test: execução completa LOW (sem approval) end-to-end (mock agente, mock GitHub) — valida workflow nova→calcula→aprova→grava→Claude→PR populates dados.pullRequest.url.
**L.3.** Integration test: execução HIGH com approval/reject/expire — valida state machine atômica (race em approve duplo: 2 admins, apenas 1 sucesso).
**L.4.** Integration test: rollback gera nova execution com Risk=HIGH, fluxo coerente.
**L.5.** Adversarial test: Risk Gate com 50 prompts cuidadosamente escolhidos (importar do Scrumban V1) — todos classificados corretamente.
**L.6.** DVFS portability test: trocar `risk-gate-validator.js` por versão "estrita" (todos prompts viram HIGH) e validar que sistema continua funcional sem deploy.

## 6.10 Dependências

- **Fase 5** completa (DProject e DTask existem; tasks vinculáveis a executions).
- **Fase 1** (seed) inclui: classes -300, -301, -302, -303, -310 + sequence `chcriacao_seq` + DVFS chaves 3,4,7 com scripts seed'eados.
- **Fase 0**: Prisma schema com colunas `dados Json` em DPedido.
- **Fase 7** (eventos): este Engine EMITE eventos via eventProducer. Stub aceito durante Fase 6, implementação real em Fase 7. Pode haver overlap parcial — EventProducerService stub aqui, refatoração para producer real na Fase 7.
- **Fase 10** (integrações automation): `agentTunnelService` é stub mocado durante Fase 6. Implementação real (SSH reverso, JSON-Lines, handlers no agente) em Fase 10. Para a Fase 6 estar "DONE", basta mock funcional e testes integration usando o mock.
- **GitHub client**: Octokit injetado via factory (`GitHubClientFactory.createForProject(projectId)` lê deploy keys de DProject.dados).

## 6.11 Riscos e mitigações

| Risco | Severidade | Mitigação |
|-------|-----------|-----------|
| Engine OOP usado em fase educativa, equipe não familiarizada | ALTA | ADR detalhado + sessão de pair programming na primeira semana. Code review obrigatório do Strategist em PRs do Engine. |
| Bug do RELATORIO (s.id vs s.chave) replicado em V2 | ALTA | CORREÇÃO EXPLÍCITA na G.3. Reviewer valida via grep. |
| Race em approve duplo (2 admins clicam approve) | ALTA | `updateMany` com condition `dados.approval.status = 'awaiting_approval'` — apenas o primeiro UPDATE acerta. Teste L.3 obrigatório. |
| Script DVFS com bug bloqueia ALL executions | CRÍTICA | Validação dos scripts em CI antes de seed deploy. Versionamento de scripts (chave + version em DVFS). Rollback rápido via `prisma db seed`. |
| eval() no DVFS é vetor de execução arbitrária | CRÍTICA | Scripts DVFS são SEEDed pelo desenvolvedor (chaves negativas — Pilar 3 regra fundamental). NUNCA aceitar script via API. Linter verifica que DVFS.create não está exposto em controller. |
| Timeout do Claude vaza promise | ALTA | Pattern de timeout race-safe (3 caminhos mutuamente exclusivos), conforme Scrumban V1 ClaudeCodeRunnerService. Reusar lógica testada. |
| Output > 1MB consome memória | MÉDIA | Truncate explícito via _truncate, testado. |
| GitHub API falha → PR não abre | MÉDIA | Fallback URL genérica `pull/new/<branch>`. Não bloqueia execução. |
| Engine "vazado" para domínios estruturais (DTask, DProject) | ALTA | Reviewer rejeita. Documenter atualiza CLAUDE.md V2 com regra: "Engine APENAS em DPedido idClasse=-300". |
| Performance: cada execution = 4 queries DVFS load | MÉDIA | dvfs-loader.helper.ts cacheia em memória com TTL 5min. Chaves 3,4,7 raramente mudam. |

## 6.12 Definition of Done (26 itens — 24 originais + 2 testes regressivos adversariais BLOQUEANTES de ADR-V2-016)

- [ ] `Operacao` base abstrata implementada (~80L), com sequence key via PostgreSQL
- [ ] `OperacaoPedido` FULL workflow implementado (~800L), bug `s.id` corrigido para `s.chave` em **AMBOS** `_carregaScriptsCalc()` e `_carregaScriptsGrav()` (ADR-V2-016)
- [ ] `OperacaoExecucaoClaude` implementado conforme esqueleto 6.7
- [ ] 4 scripts DVFS criados em `src/engine/dvfs/` e seeded em DVFS table
- [ ] DClasses -300, -301, -302, -303, -156 (AGENT) no seed da Fase 1
- [ ] Sequence `chcriacao_seq` criada via migration
- [ ] `getNextSequenceKey()` retorna BigInt (não Number)
- [ ] DPedido idClasse=-301|-302|-303 persistido com `dados Json` populado completamente após workflow
- [ ] Risk Gate classifica corretamente (50 cenários adversariais passam)
- [ ] Command Validator rejeita path traversal (5 testes)
- [ ] State machine: approve/reject/rollback/expired race-safe (teste L.3 passa com 10 threads)
- [ ] PR auto-open via DVFS chave 7 (cria PR no GitHub OU fallback URL genérica)
- [ ] Notification Dispatcher cria DEvento -490 para owner + assignees
- [ ] Endpoints `/executions/*` documentados via Swagger
- [ ] AgentThrottlerGuard 30 req/min por path-param hash
- [ ] Eventos emitidos APÓS persistência (Padrão #7), via EventProducerService stub
- [ ] Sweeper @Cron expira awaiting_approval >1h race-safe
- [ ] Logs estruturados com correlationId em todos os steps
- [ ] Output Claude truncado a 1MB stdout + 1MB stderr
- [ ] Cobertura de testes ≥ 85% no Engine (calcula, aprova, grava paths)
- [ ] DVFS portability test passa (trocar script muda comportamento sem redeploy)
- [ ] Build passa (TypeScript strict 0 errors)
- [ ] Reviewer confirma: ZERO uso de Engine fora de DPedido idClasse=-300 (pilar 1 inviolavel — ver §6.16)
- [ ] ADR documentado: "Por que OperacaoExecucaoClaude estende OperacaoPedido em vez de Operacao direto" (ADR-V2-005) **+ ADR-V2-016 (s.chave vs s.id) presente em `docs/decisions/`**

### DoD adicional — Testes Regressivos Adversariais BLOQUEANTES (defesa de ADR-V2-016)

**Estes dois testes nao sao opcionais. F6 NAO fecha sem ambos verdes. Sao a defesa codificada contra o bug latente herdado descrito no `RELATORIO-DEVARI-PARTE-1` linhas 880-924 (filtro por `s.id` em vez de `s.chave` em `_carregaScriptsCalc/Grav`).**

- [ ] **Teste regressivo R-CHAVE-5 (`_funcPosCalculo` carrega):**
  Arquivo: `src/engine/lib/operacao/__tests__/OperacaoPedido.regressao-dvfs.spec.ts`
  Cenario: `it('R-CHAVE-5: _funcPosCalculo carrega DVFS chave 5 (regressao s.id vs s.chave)', ...)`.
  Setup: cria 5 linhas DVFS (chaves 3, 4, 5, 6, 7). A chave 5 com script:
  ```javascript
  (function (op) { op.dados._dvfs5_executado = true; })
  ```
  Acao: instancia `OperacaoPedido` (com agente PrismaService real ou mock fiel), chama `await op.nova()` (que chama internamente `_carregaScriptsCalc`), depois `await op.calcula()`.
  Assercao: `expect(op.dados._dvfs5_executado).toBe(true);` — **se o filtro estiver errado (`s.id === 5`), `_funcPosCalculo` fica `undefined`, o IF guard pula a execucao e a flag fica `undefined`. O teste FALHA, expondo a regressao.**

- [ ] **Teste regressivo R-CHAVE-7 (`_funcPosGravacao` carrega):**
  Mesmo arquivo de spec.
  Cenario: `it('R-CHAVE-7: _funcPosGravacao carrega DVFS chave 7 (regressao s.id vs s.chave)', ...)`.
  Setup: identico, com chave 7 contendo:
  ```javascript
  (async function (op) { op.dados._dvfs7_executado = true; })
  ```
  Acao: instancia `OperacaoPedido`, chama `await op.nova()`, popula campos minimos, `await op.calcula()`, e `await op.grava()` (que internamente chama `_carregaScriptsGrav` e depois executa `_funcPosGravacao`).
  Assercao: `expect(op.dados._dvfs7_executado).toBe(true);` — defesa simetrica para o caminho de gravacao.

- [ ] **DVFS chaves 3, 4, 5, 6, 7 NUNCA retornam NULL silenciosamente:** unit test extra valida que se a DVFS nao tem registro para uma chave, o servico retorna `undefined` E loga `Logger.warn` com a chave faltante (anti-padrao: NUNCA `null` silencioso por filtro errado).

- [ ] **Hook de pre-commit ou linter** bloqueia o padrao `s\.id\s*===` em `src/engine/lib/operacao/*.ts`. Mensagem do erro: "Use s.chave — ver ADR-V2-016."

## 6.13 Tempo estimado

**Total:** 3 a 3,5 semanas

| Bloco | Tempo |
|-------|-------|
| G — Engine base + OperacaoPedido | 5-6 dias |
| H — DVFS scripts + seed | 2-3 dias |
| I — OperacaoExecucaoClaude | 3-4 dias |
| J — ExecutionsService + Controllers + ApprovalFlow | 4-5 dias |
| K — Throttler Guard | 1 dia |
| L — Testes (unit + integration + adversarial) | 4-5 dias |

## 6.14 ADR a ser criado

**ADR-V2-005: Por que OperacaoExecucaoClaude estende OperacaoPedido**

- **Alternativa A (escolhida):** estender OperacaoPedido. Herda workflow completo, scripts DVFS chaves 3-7, Proxy de cache invalidation. Reusa ~800L de lógica testada do Dinpayz.
- **Alternativa B (rejeitada):** estender Operacao direto. Teria que reimplementar toda a lógica de scripts DVFS, calcula/aprova/grava. ~600L extras de código duplicado.
- **Alternativa C (rejeitada):** classe standalone (sem herança). Perde portabilidade — outros Engines no V2 (Saque, Antecipacao se aparecerem) não compartilhariam infraestrutura.

**Decisão:** Alternativa A. O preço é carregar dependências dummy (paymentProcessor, taxationService — todos opcionais e nunca instanciados em V2). O ganho é workflow padrão Devari Core, alinhado ao Pilar 1 e à Dimensão 2 do modelo polimórfico.

## 6.16 Regra INVIOLAVEL — Engine APENAS em DPedido idClasse=-300

**Esta secao codifica a regra mais importante da arquitetura V2 e e referenciada pela DoD da F6 e pelas tabelas Pilar 1 das fases F5, F7, F8 e F9.**

O Engine OOP (classe base `Operacao`, classe `OperacaoPedido`, sua descendente `OperacaoExecucaoClaude`) e EXCLUSIVO da tabela `DPedido` com `idClasse` na faixa **-300..-303** (EXECUTION + LOW/MED/HIGH).

| Tabela | Engine permitido? | Padrao de acesso |
|--------|-------------------|------------------|
| **DPedido** com `idClasse=-300..-303` (EXECUTION) | **SIM** (`OperacaoExecucaoClaude` extende `OperacaoPedido`) | Workflow obrigatorio: `nova() -> setExecucaoData() -> calcula() -> aprova() -> grava()` |
| DPedido com qualquer outra `idClasse` | **NAO** (V2 nao tem outros tipos de pedido) | — |
| DTitulo, DMovDispo, DMovDepos, DSolicita, DRequisic | NAO (tabelas dormentes em V2) | Reservadas no schema, sem Engine. Se algum dia forem ativadas, sera via Engines proprios (OperacaoBaixa etc.) — fora do escopo do V2. |
| DTask | **NAO. ESTRUTURAL.** | Service+Prisma direto (TasksService) |
| DProject | **NAO. ESTRUTURAL.** | Service+Prisma direto (ProjectsService) |
| DEntidade | **NAO. ESTRUTURAL.** | Service+Prisma direto (OrganizationsService, TeamsService, EntidadeService) |
| DTabela | **NAO. ESTRUTURAL.** | Service+Prisma direto (TabelaService) |
| DVincula | **NAO. ESTRUTURAL.** | Service interno (criada como side-effect de createOrg, createTeam, etc.) |
| DEvento | **NAO. ESTRUTURAL.** | EventProducerService -> AuditLogConsumer escreve via Prisma direto |
| DRecurso, DPermissao, DUserGroup, DClasse, DVFS | **NAO** | Service+Prisma direto (cada um no seu modulo) |

### Defesa em CI / Reviewer

1. **Hook automatico em SubagentStop do Reviewer:**
   ```bash
   grep -rn "new Operacao" src/ \
     --include="*.ts" \
     --exclude-dir="executions" \
     --exclude-dir="engine"
   # Esperado: ZERO hits.
   # Se houver hit fora de src/executions/ ou src/engine/, REJEITAR PR (score <5).
   ```

2. **CLAUDE.md do V2 (raiz)** declara: "**Engine APENAS em DPedido idClasse=-300.** Toda outra tabela e estrutural — Service+Prisma."

3. **Reviewer Agent rule** (`.claude/rules/devari-3-pilares.md` ja diz isso na secao 3 — Pilar 1 Anti-padroes; aqui apenas reafirma).

### Por que essa regra existe

- **Performance:** tabelas estruturais (DEntidade, DTabela, DProject, DTask) sao pequenas, cacheaveis, sem state machine. Forca-las pelo Engine adiciona overhead sem beneficio.
- **Clareza:** Engine implica workflow `nova/calcula/aprova/grava` + scripts DVFS. Cadastros estruturais nao tem isso. Misturar gera codigo confuso.
- **Manutencao:** quanto menos lugares Engine vive, menor a superficie de bug. V2 herdara o bug ADR-V2-016 corrigido — restringir o uso ajuda a evitar regressoes.
- **Evolucao:** se um dia outro Engine for necessario (ex: `OperacaoCobranca` sobre DTitulo), a expansao e cirurgica, sem refatorar tudo.

### Excecao reservada (futura)

Se F6 entregar uma extensao logica de `OperacaoExecucaoClaude` (ex: `OperacaoExecucaoClaudeBatch` para multiplos comandos atomicos), ela entra como sub-tipo via heranca em `src/engine/lib/operacao/` e e tratada como parte da F6. NAO requer revisao desta regra — DPedido continua sendo o unico hospedeiro do Engine.

---

## 6.15 Como validar (smoke tests)

```bash
# Pré-requisito: Fase 5 OK + Fase 1 atualizada com seeds Fase 6

# Subir
npm run start:dev

# 1. Validar DVFS seed
psql -h localhost -p 15432 -U scrumban -d scrumban_v2 \
  -c "SELECT chave, nome, length(script) as bytes FROM \"DVFS\" ORDER BY chave;"
# Esperado: 4 linhas (3,4,7,7)

# 2. Setup: criar org + projeto + agent stub
TOKEN=...    # (via auth)
PROJ=...     # (via /projects POST)
# Vincular agente stub ao projeto: PATCH /projects/:id { automation: { idAgent: 'stub-1' } }

# 3. Executar comando LOW (sem approval)
RESP=$(curl -s -X POST http://localhost:3000/api/v1/projects/$PROJ/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"command":{"text":"adicione um README.md básico"}}')
echo $RESP | jq

# Esperado:
# {
#   "id": "...",
#   "riskLevel": "LOW",
#   "approval": { "status": "approved", "approvedBy": "auto:risk-gate-low" },
#   "claude": { "exitCode": 0, ... },
#   "pullRequest": { "url": "https://github.com/..." }
# }

# 4. Executar comando HIGH (exige approval)
HIGH=$(curl -s -X POST http://localhost:3000/api/v1/projects/$PROJ/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"command":{"text":"DROP TABLE users; deletar .env"}}')
HIGH_ID=$(echo $HIGH | jq -r '.id')

# Verifica que ficou awaiting_approval
curl -s http://localhost:3000/api/v1/executions/$HIGH_ID -H "Authorization: Bearer $TOKEN" | jq '.approval.status'
# Esperado: "awaiting_approval"

# 5. Aprovar
curl -s -X POST http://localhost:3000/api/v1/executions/$HIGH_ID/approve \
  -H "Authorization: Bearer $TOKEN" | jq

# 6. Validar listagem
curl -s "http://localhost:3000/api/v1/executions?projectId=$PROJ&status=approved" \
  -H "Authorization: Bearer $TOKEN" | jq '.items | length'

# 7. Validar audit (DEvento -496)
psql -c "SELECT \"idClasse\", descricao FROM \"DEvento\" WHERE \"identificadorExterno\" = '<correlationId>';"

# 8. Adversarial: 50 prompts (script automatizado)
./scripts/risk-gate-adversarial-test.sh
# Esperado: 50/50 corretos
```

---

# FASE 7 — Eventos Canônicos (DEvento + EventProducerService)

## 7.1 Objetivo

Implementar a infraestrutura completa de eventos do V2:

- **EventProducerService** (consumido pela Fase 6 mas plenamente realizado aqui)
- **EventRouterService** (decide fila baseado em payload — sem lógica em adapters)
- **CircuitBreakerService** + **IntelligentRetryService** + **TelemetryService** + **AutoScalingService**
- **DEvento canônico** — TODOS os eventos do sistema vão pra DEvento; nenhuma DNotification, nenhum Webhook próprio.
- **Notifications**: cada notificação = 1 linha DEvento idClasse=-490
- **Webhooks**: cada tentativa = 1 linha DEvento idClasse=-491; configuração = DTabela idClasse=-460
- **Audit trail completo**: cada mutação importante = 1 linha DEvento

## 7.2 Pilares ativados / respeitados

| Pilar | Aplicação |
|-------|-----------|
| **Pilar 1** | NÃO usado (DEvento é estrutural, Service+Prisma). **REGRA INVIOLAVEL reforcada:** Engine e EXCLUSIVO de DPedido idClasse=-300 — DEvento, DTabela, DEntidade nao usam Engine NUNCA (mesmo em consumers de eventos). EventProducerService, EventRouterService, AuditLogConsumer, NotificationConsumer, WebhookConsumer SAO SERVICES — escrevem em DEvento via Prisma direto (em transaction quando aplicavel). Reviewer rejeita imediatamente qualquer `new Operacao*()` em `src/eventos/`. |
| **Pilar 2** | DEvento NÃO é exposto via REST (interno). Webhooks config via DTabela (reuso `/tabelas?idClasse=-460`). Notifications expostas via service interno + endpoints do controller `/notifications` próprio (justificado: lógica de read state, mark-as-read, unread count). |
| **Pilar 3** | DClasses novas: -460 WEBHOOK_CONFIG, -490..-496 (eventos categorizados) |

## 7.3 Padrões obrigatórios

- **#7** EVENTOS APÓS PERSISTÊNCIA (crítico)
- **#14** EventProducerService NUNCA emit direto via BullMQ — sempre via producer
- **devari-event-naming.md** — formato `{dominio}.{entidade}.{acao}` ou `{dominio}.{acao}`

## 7.4 Tabelas canônicas envolvidas

| Tabela | Uso |
|--------|-----|
| **DEvento** | TABELA CENTRAL — todos os eventos do sistema |
| **DTabela** | -460 WEBHOOK_CONFIG: configurações de webhooks outbound (`dados Json` com URL, secret, events array) |
| **DEntidade** | resolve recipients de notificações (User idClasse=-47) |

## 7.5 DClasses a criar nesta fase

| Chave | Código | Nome | idPai | Agrupamento | Propósito |
|-------|--------|------|-------|-------------|-----------|
| -3 | EVENTOS | (existente, fixa) | -2 | true | — |
| -460 | WEBHOOK_CONFIG | Configuração de Webhook | -51 | false | DTabela: URL + secret + events list em metaDados |
| -490 | NOTIFICATION | Notificação in-app | -3 | true | DEvento: notificações para users |
| -491 | WEBHOOK_ATTEMPT | Tentativa de Webhook | -3 | false | DEvento: log de cada tentativa (success/fail) |
| -492 | AGENT_HEARTBEAT | Heartbeat de Agente | -3 | false | DEvento: telemetria de agentes |
| -493 | TELEGRAM_MSG_IN | Mensagem Telegram | -3 | false | (preparado p/ Fase 11) |
| -494 | TASK_CREATED | Task Criada | -3 | false | Audit |
| -495 | TASK_STATUS_CHANGED | Task Status Mudou | -3 | false | Audit |
| -496 | EXECUTION_LOG | Log de Execução | -3 | false | Audit (Fase 6 já gera, aqui formaliza) |
| -497 | PROJECT_DELETED | Projeto Deletado | -3 | false | Audit |
| -498 | ORG_DELETED | Organização Deletada | -3 | false | Audit |
| -499 | USER_LOGIN | Login realizado | -3 | false | Audit segurança |

## 7.6 Estrutura de arquivos esperada

```
src/eventos/
├── eventos.module.ts                       [global module]
├── core/
│   ├── event-producer.service.ts           [SINGLE entry point para emitir eventos]
│   ├── event-router.service.ts             [decide fila baseado em payload]
│   ├── circuit-breaker.service.ts          [protege contra cascata de falhas]
│   ├── intelligent-retry.service.ts        [backoff exponencial, retry budget]
│   └── event-types.ts                      [const com TODOS os tipos válidos]
├── consumers/
│   ├── audit-log.consumer.ts               [insere em DEvento — TODOS os eventos passam aqui]
│   ├── notification.consumer.ts            [filtra eventos relevantes para users → DEvento -490]
│   └── webhook.consumer.ts                 [dispara webhooks outbound — Fase 13 implementa real]
├── monitoring/
│   ├── telemetry.service.ts                [coleta métricas de events por tipo/min]
│   ├── auto-scaling.service.ts             [stub — para futuro auto-scaling de workers]
│   └── event-health.controller.ts          [GET /events/health — status do producer]
├── notifications/
│   ├── notifications.module.ts
│   ├── notifications.controller.ts         [GET, GET unread-count, PUT :id/read, PUT read-all, DELETE]
│   ├── notifications.service.ts            [WHERE idClasse=-490 AND idEntidade=userId]
│   └── dto/
└── webhooks/
    ├── webhooks.module.ts
    ├── webhooks.controller.ts              [POST/GET/PATCH/DELETE configs, POST incoming/:channel]
    ├── webhook-dispatcher.service.ts       [HMAC-SHA256, retry 3x, auto-disable após 5 falhas]
    └── dto/
```

**Linhas estimadas Fase 7:** ~3.000-4.000 linhas.

## 7.7 Tarefas detalhadas

### Bloco M — Core de eventos

**M.1.** `EventProducerService.addInternalEvent(type, payload, correlationId)`:
1. Valida que `type` está em `EVENT_TYPES` (lista canônica).
2. Enriquece payload com `metadata: { source, timestamp, correlationId }`.
3. Chama `EventRouterService.route(event)` → decide consumidor sync (audit-log) + filas (não-bloqueantes para webhooks/notifications).
4. Em V2 MVP: **sync mode** — chama todos os consumers em paralelo via `Promise.allSettled`. BullMQ fica para refactor futuro.

**M.2.** `EventRouterService.route(event)`:
- Detecta domínio via prefix (`isOrderEvent`, `isEntityEvent`, `isExecutionEvent`, `isAuditEvent`, etc.).
- Retorna lista de consumers a invocar.
- AuditLogConsumer SEMPRE é chamado.
- NotificationConsumer chamado se `event.type ∈ NOTIFY_TRIGGERS` (configurável em const).
- WebhookConsumer chamado se há webhook config matching o event type.

**M.3.** `CircuitBreakerService`: pattern half-open, threshold 5 falhas em 60s, recover 30s.

**M.4.** `IntelligentRetryService`: backoff exponencial (1s, 2s, 4s, 8s, 16s — máx 5 tentativas). Persiste estado em memory map.

**M.5.** `EventTypes` const exportada: ~25 tipos canônicos. Reviewer valida que apenas esses são emitidos.

### Bloco N — Consumers

**N.1.** `AuditLogConsumer.handle(event)`:
- Mapeia type → idClasse:
  - `task.created` → -494
  - `task.status.changed` → -495
  - `execution.*` → -496
  - `project.deleted` → -497
  - `entity.org.deleted` → -498
  - `user.login.succeeded` → -499
- INSERT DEvento `{ idClasse, idEntidade: payload.entityId, identificadorExterno: correlationId, descricao, metaDados: payload }`.

**N.2.** `NotificationConsumer.handle(event)`:
- Para `task.status.changed`: cria DEvento -490 para criadoPor da task + assignees.
- Para `task.assigned`: cria DEvento -490 para novo assignee.
- Para `execution.awaiting_approval`: cria DEvento -490 para todos ADMINs do projeto.
- Idempotência via `identificadorExterno` único.

**N.3.** `WebhookConsumer.handle(event)`:
- Busca DTabela idClasse=-460 com `metaDados.events` contendo o `event.type`, scoped por org.
- Para cada match, chama `WebhookDispatcherService.dispatch(config, event)`.

### Bloco O — Notifications endpoints

**O.1.** `NotificationsService`:
- `findMany(userId, { unreadOnly, cursor, limit })`: WHERE idClasse=-490 AND idEntidade=userEntidadeId.
- `getUnreadCount(userId)`: COUNT WHERE excluido=false AND metaDados.read != true.
- `markAsRead(notificationId, userId)`: ownership check + UPDATE metaDados.read=true.
- `markAllAsRead(userId)`: bulk UPDATE.
- `delete(id, userId)`: soft delete.

**O.2.** Endpoints conforme contract atual (compatível com Scrumban V1 frontend).

### Bloco P — Webhooks

**P.1.** `WebhooksService`:
- `create(orgId, dto)`: cria DTabela -460 com `metaDados = { url, secret, events: ['task.*', 'execution.*'], active: true, failureCount: 0 }`.
- `list(orgId)`, `findOne`, `update`, `delete`: CRUD via DTabela.
- `disable(id)`: marca `metaDados.active = false`.

**P.2.** `WebhookDispatcherService`:
- `dispatch(config, event)`:
  - Calcula HMAC-SHA256 do body com `secret`.
  - POST com header `X-Webhook-Signature: sha256=<hex>`.
  - Cria DEvento -491 com result {success, statusCode, latencyMs, error}.
  - Se 3 falhas consecutivas: incrementa `metaDados.failureCount`. Se >=5: auto-disable.
  - Retry via IntelligentRetry (3 tentativas com backoff).

**P.3.** `WebhookIncomingController.POST /webhooks/incoming/:channel`:
- Endpoint público (sem JWT, valida secret no body).
- Cria DTask via `TasksService.create` com canalId mapeado (channel string → DClasse).

### Bloco Q — Refactor Fase 6

**Q.1.** Substituir EventProducerService stub na Fase 6 pelo real. Validar que todos os eventos de Execution emitem corretamente.

### Bloco R — Testes

**R.1.** Unit: 100% cobertura em EventRouter, CircuitBreaker, IntelligentRetry.
**R.2.** Integration: criar task → verificar DEvento -494 + DEvento -490 (notification para criador).
**R.3.** Webhook smoke: configurar webhook → criar task → verificar POST recebido com HMAC válido.

## 7.8 Definition of Done (16 itens)

- [ ] EventProducerService é o ÚNICO ponto de emissão (zero adapter emite direto)
- [ ] EVENT_TYPES const com ~25 tipos canônicos exportada
- [ ] EventRouter decide consumers via prefix detection (sem if/else hardcoded em adapters)
- [ ] AuditLogConsumer registra em DEvento com idClasse correto por tipo
- [ ] NotificationConsumer cria DEvento -490 para triggers configurados
- [ ] WebhookConsumer dispara HTTP POST com HMAC-SHA256
- [ ] CircuitBreaker abre após 5 falhas em 60s, half-open após 30s
- [ ] IntelligentRetry com backoff exponencial 5 tentativas
- [ ] Notifications: 5 endpoints CRUD funcionais
- [ ] Webhooks: 5 endpoints CRUD + 1 inbound público
- [ ] DEvento popula audit trail completo (executions, tasks, projects, orgs, login)
- [ ] Fase 6 refatorada (EventProducerService real, não stub)
- [ ] ZERO N+1 nos consumers (batch DB writes onde aplicável)
- [ ] Logger estruturado com correlationId em todo o pipeline
- [ ] Cobertura tests ≥ 80%
- [ ] Build passa

## 7.9 Tempo estimado

**Total:** 1,5 a 2 semanas

| Bloco | Tempo |
|-------|-------|
| M — Core (Producer/Router/CB/Retry) | 3 dias |
| N — Consumers | 2 dias |
| O — Notifications | 2 dias |
| P — Webhooks | 3 dias |
| Q — Refactor Fase 6 | 1 dia |
| R — Testes | 2 dias |

## 7.10 Como validar

```bash
# Criar task → verificar event chain
curl -X POST .../tasks ... -d '{"nome":"X","projectId":Y}'

# Verificar DEvento -494 (audit) + -490 (notification)
psql -c "SELECT \"idClasse\", descricao FROM \"DEvento\" ORDER BY \"chcriacao\" DESC LIMIT 5;"

# Configurar webhook
curl -X POST .../webhooks ... -d '{"url":"https://webhook.site/xxx","events":["task.created"],"secret":"abc"}'

# Criar task de novo, validar webhook recebido
# Validar HMAC: hmac_sha256(body, secret) == X-Webhook-Signature
```

---

# FASE 8 — Capacidades de Leitura Runtime (Flow Metrics + Forecast + Search)

## 8.1 Objetivo

Implementar análises derivadas dos dados estruturais — runtime puro, ZERO persistência de métricas (calculadas on-demand sobre DTask, DEvento, DProject):

- **Flow Metrics**: Cycle Time, Lead Time, Throughput, WIP Age, Cumulative Flow Diagram (CFD)
- **Forecast**: Monte Carlo 10k iterações com p50/p75/p85/p95
- **Search**: Full-text search sobre DTask + DProject + DEntidade

## 8.2 Pilares ativados / respeitados

| Pilar | Aplicação |
|-------|-----------|
| **Pilar 1** | NÃO usado (read-only). **REGRA INVIOLAVEL reforcada:** F8 e leitura pura sobre DTask, DEvento, DProject. ZERO `new Operacao*()` esperado. Reviewer audita: `grep -rn "new Operacao" src/{flow-metrics,forecast,search}` deve retornar zero. Mesmo que algum Engine de leitura aparente ser util (cache invalidation? bulk read?), nao usar — Service+Prisma cobre tudo. |
| **Pilar 2** | Endpoints específicos JUSTIFICADOS — analytics derivados, não CRUD. `/flow-metrics/*`, `/forecast/*`, `/search` têm semântica própria. |
| **Pilar 3** | NÃO precisa novas DClasses (calcula sobre dados existentes) |

## 8.3 Padrões obrigatórios

- **#6** ZERO N+1 (queries agregadas com groupBy)
- **#15** Cursor pagination em /search
- **#4** TimezoneService em filtros de período

## 8.4 Tabelas canônicas envolvidas

Todas read-only: DTask, DEvento, DProject, DEntidade, DTabela.

## 8.5 Estrutura de arquivos esperada

```
src/
├── flow-metrics/
│   ├── flow-metrics.module.ts
│   ├── flow-metrics.controller.ts          [GET 6 endpoints: cycle-time, lead-time, throughput, wip-age, cfd, dashboard]
│   ├── services/
│   │   ├── cycle-time.service.ts           [completedAt - executingAt]
│   │   ├── lead-time.service.ts            [completedAt - createdAt]
│   │   ├── throughput.service.ts           [tasks DONE per day/week]
│   │   ├── wip-age.service.ts              [age of tasks not yet DONE]
│   │   ├── cfd.service.ts                  [Cumulative Flow: contagem por status por dia]
│   │   └── dashboard.service.ts            [agrega todas em paralelo via Promise.all]
│   └── dto/
├── forecast/
│   ├── forecast.module.ts
│   ├── forecast.controller.ts              [GET /:projectId]
│   ├── forecast.service.ts                 [Monte Carlo simulation]
│   ├── monte-carlo.engine.ts               [10k iterations, p50/p75/p85/p95]
│   └── dto/
└── search/
    ├── search.module.ts
    ├── search.controller.ts                [GET /search?q=X&projectId=Y&limit=5]
    ├── search.service.ts                   [3 queries paralelas: tasks, projects, pessoas]
    └── dto/
```

**Linhas estimadas:** ~2.500 linhas.

## 8.6 Tarefas detalhadas

### Bloco S — Flow Metrics

**S.1.** `CycleTimeService.calculate(projectId, periodFilter)`:
- Lê DTask WHERE idProject AND `dados.telemetry.completedAt IS NOT NULL`.
- Calcula `completedAt - executingAt` em horas.
- Retorna { p50, p75, p90, avg, samples }.

**S.2.** `LeadTimeService`: análogo, `completedAt - chcriacao`.

**S.3.** `ThroughputService.calculate(projectId, granularity, periodFilter)`:
- groupBy date(completedAt) → COUNT.
- Retorna serie temporal `{date, count}[]`.

**S.4.** `WipAgeService`: para tasks ainda em INBOX/READY/EXECUTING/VALIDATING, calcula age desde criação.

**S.5.** `CfdService`: para cada dia do período, conta tasks por status (snapshot lendo DEvento -495 acumulado).

**S.6.** `DashboardService.getDashboard(projectId, period)`: chama Promise.all de S.1-S.5, retorna objeto único.

### Bloco T — Forecast

**T.1.** `MonteCarloEngine.simulate({ tasksRemaining, throughputHistorical, iterations=10000 })`:
- Calcula média e desvio padrão de throughputHistorical.
- 10k iterações: para cada uma, simula "quantos dias até completar tasksRemaining" sampleando de N(μ,σ).
- Ordena resultados, retorna p50/p75/p85/p95.

**T.2.** `ForecastService.forecast(projectId)`:
- Pega throughput dos últimos 4 sprints (DTask completed por sprint via groupBy).
- tasksRemaining = WIP atual (não-DONE).
- Chama MonteCarloEngine.

### Bloco U — Search

**U.1.** `SearchService.search(q, organizationId, projectIdFilter?, limit=5)`:
- 3 queries paralelas via Promise.all:
  - DTask: WHERE idOrganizacao AND ilike(nome OR descricao). Limit `limit * 0.5`.
  - DProject: WHERE idOrganizacao AND ilike(nome). Limit `limit * 0.3`.
  - DEntidade: WHERE org-scope AND idClasse=-47 (User) AND ilike(nome OR email). Limit `limit * 0.2`.
- Performance target: <200ms.
- Para escala >10k tasks: PostgreSQL `to_tsvector` + GIN index (preparar Fase 14).

## 8.7 Definition of Done (12 itens)

- [ ] 6 endpoints flow-metrics + dashboard agregado
- [ ] 1 endpoint forecast com Monte Carlo 10k
- [ ] 1 endpoint search com 3 categorias
- [ ] ZERO N+1 (validado com DATABASE_LOGGING)
- [ ] Index parciais criados: (idProject, idStatus), (idProject, completedAt)
- [ ] Tenant isolation via JWT em TODOS os endpoints
- [ ] TimezoneService em todos os filtros de período
- [ ] Cursor pagination em /search
- [ ] Performance: dashboard <500ms para projeto com 1000 tasks
- [ ] Cobertura tests ≥ 80%
- [ ] Swagger documenta exemplos de payload
- [ ] Build passa

## 8.8 Tempo estimado: 2 a 2,5 semanas

| Bloco | Tempo |
|-------|-------|
| S — Flow Metrics | 5-6 dias |
| T — Forecast (Monte Carlo) | 2-3 dias |
| U — Search | 2-3 dias |
| Testes | 2 dias |

## 8.9 Como validar

```bash
# Criar 50 tasks, mover para DONE em momentos diferentes
# Calcular cycle time
curl .../flow-metrics/$PROJ/cycle-time | jq
# Esperado: { p50: ~2h, p75: ~4h, p90: ~8h, samples: 50 }

# Forecast
curl .../forecast/$PROJ | jq
# Esperado: { p50: "5 days", p75: "8 days", p95: "14 days" }

# Search
curl .../search?q=login | jq
# Esperado: { tasks: [...], projects: [...], people: [...] }
```

---

# FASE 9 — Reports + Dashboards + Analytics

## 9.1 Objetivo

Camada read-only acima da Fase 8, com:

- **Dashboards ricos**: velocity por sprint, burndown, tasks-by-user, daily-summary
- **Analytics**: comparações entre períodos, capacity forecast, stakeholder report
- **Relatórios PDF**: export de projeto completo (PDFKit, Node nativo)
- **Cache TTL** onde fizer sentido (dashboards: 60s; reports: 5min)

## 9.2 Pilares ativados / respeitados

| Pilar | Aplicação |
|-------|-----------|
| **Pilar 1** | NÃO usado. **REGRA INVIOLAVEL reforcada:** F9 (Reports/Dashboards/Analytics) e read-only puro. ZERO `new Operacao*()` esperado em `src/{dashboards,analytics,reports}`. PdfGeneratorService, ReportsService, AnalyticsService SAO SERVICES — leem via Prisma direto, nunca via Engine. Reviewer audita por `grep` final antes de fechar a fase. |
| **Pilar 2** | Endpoints específicos justificados (agregações de UI, não CRUD) |
| **Pilar 3** | Sem novas DClasses |

## 9.3 Tabelas canônicas

Todas read-only.

## 9.4 Estrutura de arquivos

```
src/
├── dashboards/
│   ├── dashboards.module.ts
│   ├── dashboards.controller.ts        [5 endpoints: metrics, velocity, burndown, tasks-by-user, daily-summary]
│   └── services/
├── analytics/
│   ├── analytics.module.ts
│   ├── analytics.controller.ts         [3 endpoints: compare, capacity-forecast, stakeholder-report]
│   └── services/
├── reports/
│   ├── reports.module.ts
│   ├── reports.controller.ts           [GET /reports/projects/:id/pdf]
│   ├── reports.service.ts              [orquestra fontes via Promise.all]
│   └── pdf-generator.service.ts        [PDFKit, ~300 linhas]
└── common/cache/
    └── ttl-cache.service.ts            [LRU in-memory simples, sem Redis]
```

**Linhas estimadas:** ~2.000 linhas.

## 9.5 Tarefas (resumidas)

### Bloco V — Dashboards

**V.1.** Reusar Fase 8 services. DashboardsController = thin layer agregadora.
**V.2.** Cache TTL 60s em endpoints pesados.

### Bloco W — Analytics

**W.1.** `compare(projectId, periodA, periodB)`: lado-a-lado de flow-metrics.
**W.2.** `capacityForecast(orgId)`: agrega forecasts de todos os projetos da org.
**W.3.** `stakeholderReport(projectId)`: bullet points narrativos para stakeholders (template-based).

### Bloco X — Reports PDF

**X.1.** `PdfGeneratorService.generate(projectId, dateRange)`:
- Header: nome do projeto, período, geração at.
- Sections: Resumo Executivo, Flow Metrics, Velocity, Burndown, Tasks por Membro, Forecast.
- PDFKit pure Node (zero deps externas pesadas).
- Performance target: <500ms.

## 9.6 Definition of Done (10 itens)

- [ ] 5 endpoints dashboards
- [ ] 3 endpoints analytics
- [ ] 1 endpoint /reports/projects/:id/pdf
- [ ] PDF gerado <500ms para projeto típico (50-200 tasks)
- [ ] Cache TTL 60s funcional
- [ ] ZERO N+1
- [ ] Tenant isolation
- [ ] Cobertura tests ≥ 75%
- [ ] Swagger
- [ ] Build passa

## 9.7 Tempo estimado: 1,5 a 2 semanas

| Bloco | Tempo |
|-------|-------|
| V — Dashboards | 3 dias |
| W — Analytics | 3-4 dias |
| X — Reports PDF | 3 dias |
| Cache + Testes | 2 dias |

## 9.8 Como validar

```bash
# Gerar PDF
curl .../reports/projects/$PROJ/pdf?periodDays=30 -o report.pdf
# Verificar que abre, conteúdo coerente

# Dashboard agregado
curl .../dashboards/projects/$PROJ/metrics | jq

# Comparar períodos
curl ".../analytics/$PROJ/compare?periodA=2026-01&periodB=2026-02" | jq
```

---

# Sumário e Marcos Críticos

## Tempo total das 5 fases
**10,5 a 13 semanas** (Implementer dedicado), considerando paralelismo possível entre Fase 7 (eventos) e início da Fase 8 (leitura) após Fase 6 estabilizar.

## 3 Marcos técnicos mais críticos

1. **Marco 1 — `chcriacao_seq` + `Operacao` base + `OperacaoPedido` funcionais (final do Bloco G da Fase 6).** Sem esse esqueleto, NADA do Pilar 1 funciona. Travas: bug `s.id` corrigido para `s.chave`, sequence PostgreSQL operacional, super.nova() carregando DVFS. **Validação:** unit test cria operação dummy → chave gerada > 0, scripts DVFS são lidos sem erro.

2. **Marco 2 — `OperacaoExecucaoClaude` end-to-end LOW path passa (final do Bloco J Fase 6).** Comando de baixo risco entra → Risk Gate classifica → DPedido idClasse=-301 persistido → Claude executa via mock → PR auto-open via DVFS chave 7 → DEvento -496 e -490 criados. **Esse marco prova que as 3 dimensões do modelo polimórfico operam juntas no V2.**

3. **Marco 3 — Identifier público atômico (Bloco E.2 da Fase 5) sob carga concorrente.** 10 threads criando tasks no mesmo team → 10 identifiers distintos, sem skip, sem duplicata. Sem isso, V2 não pode sair de dev. **Validação:** teste F.3 com `Promise.all` de 10 createTask em paralelo + assertion `new Set(identifiers).size === 10`.

## Coordenação com outras estrategistas

- **Fundação (0-4):** Esta planificação pressupõe que o seed de classes da Fase 1 inclui as DClasses listadas em 5.5, 6.5, 7.5 (range -150 a -499). Schema Prisma da Fase 0 deve conter colunas `dados Json` em DProject, DTask, DPedido, e `metaDados Json` em DTabela, DVincula, DEvento.
- **Integrações (10-13):** Fase 6 deixa stubs de `agentTunnelService` e `githubClient`. Integrações implementam reais. Fase 7 deixa preparados slot DTabela -460 para webhook configs e DClasse -456 TELEGRAM para Fase 11.
- **Hardening+Handoff (14-16):** Performance (índices parciais, FTS GIN), security review, docs operacionais, runbooks. Esta planificação entrega backend funcional; otimização agressiva e endurecimento ficam para 14-16.

---

**Fim do Plano Fases 5-9.**
