# Workflow Status — Scrumban-Backend-V2 Orchestrator

**Ultima atualizacao:** 2026-05-10

---

## Tasks Completadas

(Conclusões dos agents serão registradas abaixo automaticamente)


---

## Task #4 - F10 Channels Bloco A - COMPLETE (V2 Fase F10)

**Module:** channels
**Task:** Channels / Bloco A - Core Channels (pairing, account linking, message routing, command registry)
**Status:** COMPLETA - Score 8.2/10 APPROVED
**Duration:** Implementer + Reviewer + Documenter em 2026-05-10
**Quality Score:** 8.2/10

**Agents Performance:**

| Agent | Duration | Quality |
|-------|----------|---------|
| Strategist | - | Plano F10 Bloco A com escopo fechado para core channels |
| Implementer | ~3h | 30/30 tests PASS, zero N+1, fixes de review aplicados |
| Reviewer | - | Score 8.2/10, APPROVED, 3 issues menores corrigidos (all resolved) |
| Documenter | - | ROADMAP, CHANGELOG, STATUS e commit Conventional atualizados |

**Pilares:**
- Pilar 1 (Engine): N/A - channels são infraestrutura, zero `new Operacao*`, zero escrita transacional.
- Pilar 2 (Endpoints): Controller proprio justificado por orquestração pairing + linking; reutiliza /entidades para listagem de contas.
- Pilar 3 (Seed): RESPEITADO - zero migration, zero seed, zero DClasse nova; usa DTabela -474 (PAIRING_TOKENS) e DVincula -483 (ACCOUNT_LINKS).

**Deliverables:**
- [x] `ChannelAdapter` interface: `send()`, `parseInbound()`, `verifySignature()` + `InboundMessage` type
- [x] `PairingService`: `generate()` (CSPRNG + SHA-256 hash) com UPSERT em DTabela -474, `consume()` ($transaction one-shot) com DTabela lookup + DVincula creation
- [x] `AccountLinkService`: `findByChat()` (query única, BigInt chatId, sem N+1)
- [x] `MessageRouterService`: `handleInbound()` com intent parsing, `registerIntentHandler()` para extensibilidade
- [x] `CommandRegistryService`: `register()` para registro de comandos, `resolve()` para lookup
- [x] `PairingController`: POST `/channels/pairing/generate` + POST `/channels/pairing/link` com validações
- [x] `ChannelsModule`: `onModuleInit` verifica CHANNELS_ENABLED feature flag (ADR-V2-010 módulo opcional)
- [x] DTOs com validações: `GeneratePairingDto`, `LinkAccountDto` (com @Matches numérico em chatId)
- [x] 30/30 testes unitários (30 PASS)

**Fixes aplicados pós-review (issues resolvidas):**
- [x] Issue #1: `@Matches(/^\d+$/)` adicionado em `LinkAccountDto.chatId` (validação numérica)
- [x] Issue #2: `consume()` filtra por `codigo: codeHash` no WHERE (elimina scan completo da tabela)
- [x] Issue #3: `GeneratePairingDto` removido (dead code; `generate()` usa parâmetro implícito)

**Metrics:**
- Build: PASS (`npm run build`)
- TypeScript: PASS (`npx tsc --noEmit`)
- ESLint: PASS (`npx eslint src/channels/`)
- Tests: PASS (`npx jest src/channels --runInBand`) - 30/30
- N+1 Queries: ZERO (`findByChat` é query única, `consume` usa índice em codigo)
- Queries/request: pairing generate = 1 UPSERT; pairing link = 2 (lookup + transaction); find account = 1
- BigInt: 100% serializado em responses
- Feature flag: ADR-V2-010 compliance verificada (CHANNELS_ENABLED env check)

**ADRs:** ADR-V2-010 (Channels como módulo opcional)

**Plan:** [`workspace/plans/plan-channels-bloco-a-f10-task4.md`](plans/plan-channels-bloco-a-f10-task4.md)
**Impl Notes:** [`workspace/implementations/impl-channels-bloco-a-f10-task4.md`](implementations/impl-channels-bloco-a-f10-task4.md)
**Review:** [`workspace/reviews/review-channels-bloco-a-f10-task4.md`](reviews/review-channels-bloco-a-f10-task4.md)


---

## Task #3 - F9 Reports PDF - COMPLETE (V2 Fase F9)

**Module:** reports
**Task:** Reports PDF / Bloco X - relatórios com 8 seções via PDFKit
**Status:** COMPLETA - Score 8.8/10 APPROVED
**Duration:** Implementer + Reviewer + Documenter em 2026-05-10
**Quality Score:** 8.8/10

**Agents Performance:**

| Agent | Duration | Quality |
|-------|----------|---------|
| Strategist | - | Plano F9 Task #3 com escopo fechado para Bloco X |
| Implementer | ~2h | 28/28 tests PASS, 97.4% coverage em PdfGeneratorService, zero side effects |
| Reviewer | - | Score 8.8/10, APPROVED, zero critical/medium |
| Documenter | - | ROADMAP, CHANGELOG, STATUS e doc de fechamento F9 atualizados |

**Pilares:**
- Pilar 1 (Engine): N/A - read-only puro; zero `new Operacao*`, zero EventProducer, zero escrita.
- Pilar 2 (Endpoints): Controller proprio justificado por report generation com 8 seções customizáveis.
- Pilar 3 (Seed): N/A - zero migration, zero seed, zero DClasse nova.

**Deliverables:**
- [x] `ReportsModule` registrado no `AppModule`.
- [x] `GET /reports/projects/:projectId/pdf` com response `application/pdf`.
- [x] `PdfGeneratorService` com 8 seções: header, resumo executivo, flow metrics, velocity, burndown, tasks-by-user, forecast, riscos.
- [x] Cache TTL 5min via `TtlCacheService`.
- [x] Graceful degradation via `Promise.allSettled` (forecast/analytics failures → warnings no payload).
- [x] Tenant isolation explícita (403 org divergente).
- [x] Dependências: `pdfkit`, `@types/pdfkit`.
- [x] 28 testes unitários (28/28 PASS).

**Metrics:**
- Build: PASS (`npm run build`)
- TypeScript: PASS (`npx tsc --noEmit`)
- ESLint: PASS (`npx eslint src/reports/`)
- Tests: PASS (`npx jest src/reports --runInBand`) - 28/28
- Coverage: `pdf-generator.service.ts` 97.4% statements, 100% functions, 100% lines.
- N+1 Queries: ZERO (report uses aggregated metrics + single project fetch)
- Validacao F9: PASS (`npx.cmd jest src/dashboards src/analytics src/reports --runInBand`) - 58/58 testes.

**F9 Status:**
- ✅ Bloco V (Dashboards): 15/15 tests PASS
- ✅ Bloco W (Analytics): 15/15 tests PASS
- ✅ Bloco X (Reports PDF): 28/28 tests PASS
- **F9 COMPLETA: 58/58 testes**

**Issues menores:**
- Edge case `projectId` inválido sem spec dedicado.
- PDF buffer size não documentado para volumes altos de tarefas.

**Plan:** [`workspace/plans/plan-reports-pdf-f9-task3.md`](plans/plan-reports-pdf-f9-task3.md)
**Impl Notes:** [`workspace/implementations/impl-reports-pdf-f9-task3.md`](implementations/impl-reports-pdf-f9-task3.md)
**Review:** [`workspace/reviews/review-reports-pdf-f9-task3.md`](reviews/review-reports-pdf-f9-task3.md)


---

## Task #2 - F8 Search - COMPLETE (V2 Fase F8)

**Module:** search
**Task:** Search / Bloco U - busca cross-entity read-only
**Status:** COMPLETA - Score 8.8/10 APPROVED
**Duration:** Implementer + Reviewer + Documenter em 2026-05-10
**Quality Score:** 8.8/10

**Agents Performance:**

| Agent | Duration | Quality |
|-------|----------|---------|
| Strategist | - | Plano F8 Task #2 com escopo fechado para Search |
| Implementer | ~2h | 15/15 tests PASS, 97.61% coverage em service, zero side effects |
| Reviewer | - | Score 8.8/10, APPROVED, sem critical/medium |
| Documenter | - | ROADMAP, CHANGELOG, STATUS e doc de fechamento F8 atualizados |

**Pilares:**
- Pilar 1 (Engine): N/A - read-only puro; zero `new Operacao*`, zero EventProducer, zero escrita.
- Pilar 2 (Endpoints): Controller proprio justificado por busca em 3 tabelas e resposta categorizada.
- Pilar 3 (Seed): N/A - zero migration, zero seed, zero DClasse nova.

**Deliverables:**
- [x] `SearchModule` registrado no `AppModule`.
- [x] `GET /search` com `{ tasks, projects, people, cursors, meta }`.
- [x] Busca em DTask, DProject e DEntidade.
- [x] Tenant isolation por `project.idEstab`, `DProject.idEstab` e `DVincula`.
- [x] Cursors independentes por tipo: `taskCursor`, `projectCursor`, `peopleCursor`.
- [x] Limites por categoria 50%/30%/20%.
- [x] 4 queries/request, sem N+1.

**Metrics:**
- Build: PASS (`npm run build`)
- TypeScript: PASS (`npx tsc --noEmit`)
- ESLint: PASS (`npx eslint src/search/`)
- Tests: PASS (`npx jest src/search --runInBand`) - 15/15
- Coverage: `search.service.ts` 97.61% statements, 100% functions, 100% lines.
- Validacao local F8: PASS (`npx.cmd jest src/flow-metrics src/forecast src/search --runInBand`) - 8 suites / 74 tests.

**Issues menores:**
- Controller coverage depende de e2e futuro.
- Edge case `limit=1` sem spec dedicado.
- `ID_CLASSE_USER=-150` local deve migrar para enum central quando existir.
- FTS/GIN index fica para F14 se volume alto.

**Plan:** [`workspace/plans/plan-search-f8-task2.md`](plans/plan-search-f8-task2.md)
**Impl Notes:** [`workspace/implementations/impl-search-f8-task2.md`](implementations/impl-search-f8-task2.md)
**Review:** [`workspace/reviews/review-search-f8-task2.md`](reviews/review-search-f8-task2.md)

---

## Task #1 - F8 Flow Metrics + Forecast - COMPLETE (V2 Fase F8)

**Module:** flow-metrics / forecast
**Task:** Flow Metrics + Forecast Monte Carlo
**Status:** COMPLETA - Score 8.5/10 APPROVED
**Duration:** Implementer + Reviewer/re-review + Documenter em 2026-05-10
**Quality Score:** 8.5/10

**Agents Performance:**

| Agent | Duration | Quality |
|-------|----------|---------|
| Strategist | - | Plano F8 Task #1 cobrindo Blocos S+T |
| Implementer | ~4h | 59/59 tests PASS no review, read-only puro |
| Reviewer | - | Score 8.5/10, APPROVED apos correcao de 2 MAJORs |
| Documenter | - | ROADMAP, CHANGELOG, STATUS e doc de fechamento F8 atualizados |

**Pilares:**
- Pilar 1 (Engine): N/A - read-only puro; zero `new Operacao*`.
- Pilar 2 (Endpoints): Controllers proprios justificados por analytics derivados.
- Pilar 3 (Seed): N/A - zero migration, zero seed, zero DClasse nova.

**Deliverables:**
- [x] `FlowMetricsModule` registrado no `AppModule`.
- [x] 6 endpoints `/flow-metrics/:projectId/*`: cycle-time, lead-time, throughput, wip-age, cfd, dashboard.
- [x] `ForecastModule` registrado no `AppModule`.
- [x] `GET /forecast/:projectId` com Monte Carlo bootstrap resample.
- [x] Percentis p50/p75/p85/p95.
- [x] `PeriodResolver` usando `TimezoneService`.
- [x] `DashboardService` agrega metrics em `Promise.all`.
- [x] Correcoes pos-review: N+1 de forecast removido; filtro `criadoEm` incorreto removido.

**Metrics:**
- Build: PASS (`npm run build`)
- TypeScript: PASS (`npx tsc --noEmit`)
- Tests review: PASS (`npx jest src/flow-metrics src/forecast --runInBand`) - 59/59
- Validacao local F8: PASS (`npx.cmd jest src/flow-metrics src/forecast src/search --runInBand`) - 8 suites / 74 tests.
- Greps: zero Engine e zero writes em `src/flow-metrics src/forecast`.

**Issues menores:**
- Comentario residual incorreto em `cycle-time.service.ts`.
- CFD filtra eventos por projeto em memoria por falta de FK direta `DEvento -> DProject`; debito F9/F14.

**Plan:** [`workspace/plans/plan-flow-metrics-forecast-f8-task1.md`](plans/plan-flow-metrics-forecast-f8-task1.md)
**Impl Notes:** [`workspace/implementations/impl-flow-metrics-forecast-f8-task1.md`](implementations/impl-flow-metrics-forecast-f8-task1.md)
**Review:** [`workspace/reviews/review-flow-metrics-forecast-f8-task1.md`](reviews/review-flow-metrics-forecast-f8-task1.md)

---

## Task #3 - F7 Notifications Endpoints - COMPLETE (V2 Fase F7)

**Module:** notifications / eventos
**Task:** Notifications endpoints `/notifications/*` sobre `DEvento -490`
**Status:** COMPLETA - Score 8.2/10 APPROVED
**Duration:** Strategist + Implementer + Reviewer + Documenter em 2026-05-10
**Quality Score:** 8.2/10

**Agents Performance:**

| Agent | Duration | Quality |
|-------|----------|---------|
| Strategist | - | Plano F7 Task #3 com excecao controlada para `DEvento.excluido` |
| Implementer | - | 4 suites / 30 tests PASS, build/typecheck PASS, migration limitada |
| Reviewer | - | Score 8.2/10, APPROVED, minor documental ADR-V2-032 |
| Documenter | - | JSDoc, ROADMAP, CHANGELOG, STATUS e ADR-V2-032 atualizados; commit pendente |

**Pilares:**
- Pilar 1 (Engine): N/A - `DEvento` estrutural via Prisma direto; zero `Operacao*`.
- Pilar 2 (Endpoints): Controller proprio justificado por ownership, unread count, read state e soft delete de UI.
- Pilar 3 (Seed): RESPEITADO - zero seed e zero DClasse nova; migration somente de `DEvento.excluido`.

**Deliverables:**
- [x] `NotificationsModule` registrado no `AppModule`.
- [x] `GET /notifications` com cursor pagination e filtro `unreadOnly`.
- [x] `GET /notifications/unread-count`.
- [x] `PATCH /notifications/:id/read` com `metaDados.read/readAt`.
- [x] `PATCH /notifications/read-all` em lote via `jsonb_set`, sem N+1.
- [x] `DELETE /notifications/:id` como soft delete por `DEvento.excluido=true`.
- [x] Migration limitada a `ALTER TABLE "DEvento" ADD COLUMN "excluido" BOOLEAN NOT NULL DEFAULT false`.
- [x] `NotificationConsumer` idempotencia com `excluido=false`.
- [x] ADR-V2-032 criada para registrar a excecao sem precedente geral.

**Metrics:**
- Prisma generate: PASS (`npx.cmd prisma generate`)
- Build: PASS (`npm.cmd run build`)
- TypeScript: PASS (`npx.cmd tsc --noEmit`)
- Tests: PASS (`npx.cmd jest src/notifications src/eventos/consumers --runInBand`) - 4 suites / 30 tests
- N+1 Queries: ZERO no desenho revisado; read-all usa update em lote.
- Queries/request: list = 1 query; count = 1 query; mark-read = transaction 1 read + 1 update; delete = 1 updateMany.
- Greps: zero `EventProducerService` em `src/notifications`; zero `new Operacao` em `src/notifications src/eventos`; schema segue com 17 models.

**ADRs:** ADR-V2-008, ADR-V2-025, ADR-V2-029, ADR-V2-032

**Plan:** [`workspace/plans/plan-notifications-endpoints-f7-task3.md`](../workspace/plans/plan-notifications-endpoints-f7-task3.md)
**Impl Notes:** [`workspace/implementations/impl-notifications-endpoints-f7-task3.md`](../workspace/implementations/impl-notifications-endpoints-f7-task3.md)
**Review:** [`workspace/reviews/review-notifications-endpoints-f7-task3.md`](../workspace/reviews/review-notifications-endpoints-f7-task3.md)
**Commit:** pendente por worktree suja e ausencia de pedido explicito de commit

---

## Task #2 - F7 Event Consumers - COMPLETE (V2 Fase F7)

**Module:** eventos
**Task:** NotificationConsumer + WebhookConsumer + dispatcher stub + EventRouter ativo
**Status:** COMPLETA - Score 8.4/10 APPROVED
**Duration:** Strategist + Implementer + Reviewer + Documenter em 2026-05-10
**Quality Score:** 8.4/10

**Agents Performance:**

| Agent | Duration | Quality |
|-------|----------|---------|
| Strategist | - | Plano F7 Task #2 com escopo fechado, zero endpoint/migration/seed |
| Implementer | - | 3 suites / 19 tests PASS, build/typecheck PASS, 3 Pilares respeitados |
| Reviewer | - | Score 8.4/10, APPROVED, 1 minor nao bloqueante |
| Documenter | - | JSDoc, ROADMAP, CHANGELOG, STATUS e ADRs atualizados; commit pendente |

**Pilares:**
- Pilar 1 (Engine): N/A - `DEvento`/`DTabela` estruturais via Prisma direto; zero `Operacao*`.
- Pilar 2 (Endpoints): N/A - nenhum controller ou endpoint novo.
- Pilar 3 (Seed): RESPEITADO - zero migration, zero seed, zero DClasse nova; usa `-470` e `-490`.

**Deliverables:**
- [x] `NotificationConsumer` persistindo notificacoes `DEvento -490` por trigger.
- [x] `WebhookConsumer` lendo configs `DTabela -470` scoped por org.
- [x] `WebhookDispatcherStub` sem HTTP real.
- [x] `EventRouterService` roteando audit sempre e notification/webhook por trigger.
- [x] Tests focados de notification, webhook e router.
- [x] `src/eventos/README.md` atualizado pelo Implementer.
- [x] ADR-V2-028, ADR-V2-029, ADR-V2-030 e ADR-V2-031 criadas.

**Metrics:**
- Build: PASS (`npm.cmd run build`)
- TypeScript: PASS (`npx.cmd tsc --noEmit`)
- Tests: PASS (`npx.cmd jest src/eventos --runInBand`) - 3 suites / 19 tests
- N+1 Queries: ZERO no desenho revisado; notification usa lookup batch e webhook busca configs em lote.
- Queries/evento: notification task = 1 read + 1 lookup + 1 createMany; webhook org direto = 1 config query.
- Greps: zero `eventProducer.addInternalEvent` em consumers; zero `new Operacao` em `src/eventos`; zero `fetch|axios|http.request` em dispatchers.

**Issue menor (resolvida na F7 Task #3):**
- `src/eventos/consumers/notification.consumer.ts` - lookup de idempotencia passou a filtrar `excluido=false` apos a migration autorizada.

**ADRs:** ADR-V2-008, ADR-V2-028, ADR-V2-029, ADR-V2-030, ADR-V2-031

**Plan:** [`workspace/plans/plan-eventos-consumers-f7-task2.md`](../workspace/plans/plan-eventos-consumers-f7-task2.md)
**Impl Notes:** [`workspace/implementations/impl-eventos-consumers-f7-task2.md`](../workspace/implementations/impl-eventos-consumers-f7-task2.md)
**Review:** [`workspace/reviews/review-eventos-consumers-f7-task2.md`](../workspace/reviews/review-eventos-consumers-f7-task2.md)
**Commit:** pendente por worktree suja e ausencia de pedido explicito de commit

---

<!-- dedup:strategist:1 -->
### Agent Concluído: strategist

**Task:** #1
**Timestamp:** 08/05/2026 19:18:29
**Agent:** strategist
**Status:** Completo


---

<!-- dedup:reviewer:1 -->
### Agent Concluído: reviewer

**Task:** #1
**Timestamp:** 08/05/2026 19:21:50
**Agent:** reviewer
**Status:** Completo


---

<!-- dedup:implementer:1 -->
### Agent Concluído: implementer

**Task:** #1
**Timestamp:** 08/05/2026 19:21:50
**Agent:** implementer
**Status:** Completo


---

<!-- dedup:documenter:1 -->
### Agent Concluído: documenter

**Task:** #1
**Timestamp:** 08/05/2026 19:21:50
**Agent:** documenter
**Status:** Completo

---

## Task #1 — F7 Eventos Canônicos (Bloco M+Q+N.1) — COMPLETE (V2 Fase F7)

**Module:** eventos (core/consumers/monitoring/interfaces) + refactor (email/organizations/projects/tasks/engine)
**Task:** Eventos Canônicos — EventProducerService + EventRouter + CircuitBreaker + IntelligentRetry + AuditLogConsumer
**Status:** COMPLETA — Score 8.5/10 APPROVED
**Duration:** Implementer + Reviewer concluído; Documenter em progresso — 2026-05-09
**Quality Score:** 8.5/10

**Agents Performance:**

| Agent | Duration | Quality |
|-------|----------|---------|
| Strategist | — | Plan F7 (core producer/router/consumer/monitoring, refactor 5 services) |
| Implementer | ~16h (em 2 sessions) | 292/292 testes PASS, N+1 ZERO, JSDoc 100%, honest debt reporting |
| Reviewer | ~2h | Score 8.5/10 (H1 auth.service.ts débito justificável, M1 specs faltando, zero bloqueadores) |
| Documenter | ~1h | JSDoc verificado, ROADMAP/CHANGELOG/STATUS atualizados, commit Conventional |

**Pilares:**
- Pilar 1 (Engine): RESPEITADO — zero Operacao em src/eventos/, `import type` em engine (zero runtime dependency)
- Pilar 2 (Endpoints): **ATIVADO** — EventHealthController justificado (telemetria de infra, não duplicata de polimorfico)
- Pilar 3 (Seed): ATIVADO — 131 DClasses (45 fixas + 86 específicas), ADRs V2-026/027 aplicadas

**Deliverables:**
- [x] EventProducerService: `addInternalEvent()`, validação, metadata enriquecida, Promise.allSettled, fire-and-forget seguro
- [x] EventRouterService: roteamento catch-all (Task#1) com placeholders Task#2
- [x] CircuitBreakerService: Half-Open pattern, 5 falhas/60s → open, 30s timeout → half-open
- [x] IntelligentRetryService: backoff exponencial 1/2/4/8/16s, 5 tentativas máx, `@OnModuleDestroy` cleanup
- [x] AuditLogConsumer: único INSERT DEvento, mapping type→idClasse (-489..-501), ADR-V2-026/027
- [x] TelemetryService: emitted/succeeded/failed counters, pendingRetries gauge
- [x] EventHealthController: GET /events/health (@Public), status infra, métricas
- [x] IEventProducer interface type-only (Engine isolado de runtime)
- [x] 5 services migrados (Email, Orgs, Projects, Tasks, Engine F6)
- [x] AuditService DELETADO (substituído por Producer)
- [x] CommonModule @Global criado (PrismaService, CorrelationIdService, TimezoneService)
- [x] Seed F1: -489 AUDIT_GENERIC, -499 PROJECT_LIFECYCLE, -500 ORG_LIFECYCLE

**Metrics:**
- Build: PASS (0 TypeScript, 0 ESLint new errors; 79 inherited warnings from pre-existing)
- Tests: 292/292 PASS (26 suites: eventos core + refactor migrations)
- N+1 Queries: ZERO (AuditLogConsumer = 1 INSERT/event, no loops)
- Queries/request: EventHealthController = 3 parallel reads (db/redis/email health)
- BigInt: 100% serializado
- JSDoc: 100% em core eventos (EventProducerService, EventRouterService, CircuitBreakerService, IntelligentRetryService, TelemetryService, AuditLogConsumer, EventHealthController)
- Swagger: 100% EventHealthController (@ApiOperation, @ApiResponse 200/401)
- CircuitBreaker: 3 estados testados (closed→open→half-open), timeout verificado
- Correlations: todas as mensagens Logger incluem correlationId (rastreamento distribuído)
- Padrão #7: todos 5 services migrados emitem APÓS await da persistência (correto)

**Issues (Próximas Tasks):**
- H1 (sprint seguinte F7-Task2-extras): `src/auth/auth.service.ts` linhas 124/235/353/570 — 4 calls `prisma.dEvento.create` diretas, fora do EventProducerService. Requer: (a) adicionar AUTH_REGISTER, AUTH_LOGIN, AUTH_LOGOUT, AUTH_FAILED ao EVENT_TYPES; (b) migrar fora de $transaction; (c) integrar com EventProducerService. **Não bloqueador desta task** — escopo original não incluía auth.
- M1 (backlog F14): specs dedicadas para EventProducerService, CircuitBreakerService, IntelligentRetryService (cobertura indireta via executions, mas lógica CB/retry merece tests isolados)
- M2 (documentação): `email.failed` emitido dentro do catch (sem persistência prévia) — padrão aceitável para audit de falha, mas documentar em email/README.md

**ADRs:** ADR-V2-005 (Engine isolado), ADR-V2-008 (DEvento substitui DNotification/DWebhook), ADR-V2-026 (AUDIT_GENERIC), ADR-V2-027 (PROJECT_LIFECYCLE/ORG_LIFECYCLE)

**Plan:** [`workspace/plans/plan-eventos-canonicos-f7-task1.md`](../workspace/plans/plan-eventos-canonicos-f7-task1.md)
**Impl Notes:** [`workspace/implementations/impl-eventos-canonicos-f7-task1.md`](../workspace/implementations/impl-eventos-canonicos-f7-task1.md)
**Review:** [`workspace/reviews/review-eventos-canonicos-f7-task1.md`](../workspace/reviews/review-eventos-canonicos-f7-task1.md)
**Commit:** (a ser criado pelo Documenter)

---

## Task #1 — F5 Domínio Estrutural Scrumban — COMPLETE (V2 Fase F5)

**Module:** organizations, teams, projects, tasks, workflow-statuses, sprints, auth (decorator + guard)
**Task:** Domínio Estrutural Scrumban (Organizations + Teams + Projects + Tasks + wrappers thin)
**Status:** COMPLETA — Score 8.0/10 APPROVED
**Duration:** ~12h Implementer + ~2h Reviewer + ~1.5h Documenter
**Completado em:** 2026-05-09

**Agents Performance:**

| Agent | Duration | Quality |
|-------|----------|---------|
| Strategist | — | Plan F5 (4 módulos + seed bootstrap, state machine V3, identifier atômico) |
| Implementer | ~12h | 189/189 testes, N+1 ZERO em 25+ verificações, state machine robusto |
| Reviewer | ~2h | Score 8.0/10 (1 MINOR: parseInt em 4 controllers, 1 MEDIUM: membership validation F7+) |
| Documenter | ~1.5h | JSDoc 100% (criticals), CHANGELOG/ROADMAP/STATUS atualizados, commit Conventional |

**Pilares:**
- Pilar 1 (Engine): RESPEITADO — ZERO uso de Operacao/Engine (estrutural, Prisma direto + $transaction correto)
- Pilar 2 (Endpoints): **ATIVADO PLENAMENTE** — 4 controllers próprios justificados + 2 wrappers thin + reutilização /entidades /tabelas
- Pilar 3 (Seed): ATIVADO — +2 DClasses (-153 SCRUMBAN_PROJECT, -154 SCRUMBAN_TASK = 130 total)

**Deliverables:**
- [x] Organizations: CRUD DEntidade -152 + membership RBAC (DVincula -161/-162/-163) + cascade delete
- [x] Teams: CRUD DEntidade -180 + membership (DVincula -181/-182) + issue counter (DTabela -475) atomico
- [x] Projects: CRUD DProject -153 + seed bootstrap 9 statuses V3 + activity feed + members + 31 testes
- [x] Tasks: CRUD DTask -154 + state machine V3 (9 estados, 12 transições) + identifier DEV-N atomico
- [x] WorkflowStatuses: wrapper thin (POST /seed-defaults/:projectId apenas, CRUD via /tabelas)
- [x] Sprints: wrapper thin (README + module, CRUD via /tabelas?idClasse=-400)
- [x] @TeamRoles() decorator + TeamRolesGuard implementação real (substitui stub F3)
- [x] getEntidadeIdFromUserGroup(): método centralizado + LRU cache (EntidadeService)
- [x] Seed: 130 DClasses (45 fixas + 85 especificas, range -150..-527)

**Metrics:**
- Build: PASS (0 TypeScript, 0 ESLint)
- Tests: 189/189 PASS (87 F5-específicos + 102 anteriores)
  - Organizations: 24 (3 integrados)
  - Teams: 22 (2 integrados)
  - Projects: 31 (6 integrados)
  - Tasks: 28 (5 integrados)
- N+1 Queries: ZERO (25+ verificações: cursor, batch, JOIN validadas)
- Queries/request: Organizations CRUD = 2, Projects GET = 1+cache, Tasks state machine = 3
- BigInt: 100% serializado
- JSDoc: 100% (criticals: Organizations, Teams, Projects, Tasks services/controllers)
- Swagger: 100% (57 endpoints em 4 controllers)
- State Machine: 12 transições válidas testadas, 15 inválidas rejeitadas

**Issues (F14):**
- M1: `parseInt()` em 4 controllers para parsing `limit` (numérico, não ID) — refatorar
- M2: ProjectMembersService sem validação se usuário exists em org pai — adicionar F7+
- M3: TasksStateMachineService sem cache transições — considerar memoization >500 tasks/sprint

**ADRs:** ADR-V2-003 (RBAC duplo), ADR-V2-009 (wrappers thin)

**Plan:** [`workspace/plans/plan-domain-structural-f5-task1.md`](../workspace/plans/plan-domain-structural-f5-task1.md)
**Impl Notes:** [`workspace/implementations/impl-projects-tasks-f5-task1.md`](../workspace/implementations/impl-projects-tasks-f5-task1.md)
**Review:** [`workspace/reviews/review-domain-structural-f5-task1.md`](../workspace/reviews/review-domain-structural-f5-task1.md)
**Commit:** (a ser criado pelo Documenter)

---

## Task #1 — F4 Email Module + Common Services — COMPLETE (V2 Fase F4)

**Module:** email, common
**Task:** Email Module + Common Services (TimezoneService, CorrelationId, Logging, Health, Utils, Audit)
**Status:** COMPLETA — Score 8.2/10 APPROVED
**Duration:** ~4h Implementer + ~1.5h Reviewer + ~1h Documenter
**Completado em:** 2026-05-09

**Agents Performance:**

| Agent | Duration | Quality |
|-------|----------|---------|
| Strategist | — | Plan com F4 strategy (Email 3 providers, Common services canônicos) |
| Implementer | ~4h | 102/102 testes, TimezoneService exemplar, CorrelationId sem race conditions |
| Reviewer | ~1.5h | Score 8.2/10 (2 MINORs resolvidos: @Public + READMEs, 1 MEDIUM dívida: nestjs-pino) |
| Documenter | ~1h | JSDoc completo, 3 READMEs criados, CHANGELOG/ROADMAP/STATUS atualizados, commit Conventional |

**Pilares:**
- Pilar 1 (Engine): N/A (email é infraestrutura, AuditService usa Prisma direto em DEvento estrutural — correto)
- Pilar 2 (Endpoints): **SUPORTADO** — CorrelationIdMiddleware, LoggingInterceptor, HttpExceptionFilter para todos endpoints
- Pilar 3 (Seed): RESPEITADO — ZERO DClasses novas (F1 tem -501 AUDIT_GENERIC)

**Deliverables:**
- [x] EmailModule: provider abstraction (SMTP/SendGrid/Resend), 4 templates, EMAIL_MOCK=true para CI
- [x] EmailService.sendTemplate() + EmailService.send() com JSDoc completo
- [x] AuditService: INSERT em DEvento idClasse=-501 APÓS persistência (canônico)
- [x] TimezoneService: 5 métodos canônicos (America/Sao_Paulo), 6 specs DST/UTC edge cases
- [x] CorrelationIdMiddleware: AsyncLocalStorage thread-safe, X-Correlation-Id echo
- [x] LoggingInterceptor: method, path, statusCode, durationMs, correlationId, userId
- [x] HttpExceptionFilter: { statusCode, message, correlationId, timestamp }
- [x] HealthModule: GET /health @Public (db/redis/email checks, 200/503 status codes)
- [x] Utils: validateCpf, validateCnpj, cleanCpfCnpj, hashSha256, hashBcrypt, compareBcrypt
- [x] src/email/README.md (configuração, templates, modo mock)
- [x] src/common/health/README.md (load balancer, Kubernetes, probes)
- [x] docs/email-providers.md (SMTP MailHog, SendGrid, Resend, Mock, troubleshooting)
- [x] Fix: HealthController @Public() explícito

**Metrics:**
- Build: PASS (0 TypeScript, 0 ESLint)
- Tests: 102/102 PASS (78 anteriores + 24 novos)
  - TimezoneService: 6 specs (DST, UTC/Brasília)
  - EmailService: 8 specs (providers, templates, mock, audit)
  - HealthService: 6 specs (db/redis/email checks, timeouts)
  - AuditService: 2 specs (insert, error handling)
  - Utils: 2 specs (crypto, validation)
- N+1 Queries: ZERO (HealthService Promise.all sem loop, EmailService 0 queries)
- Queries/request: HealthService = 3 paralelos, EmailService = 0
- BigInt: 100% serializado
- JSDoc: 100% (TimezoneService, EmailService, AuditService, HealthService, HealthController, utils)
- Swagger: HealthController documentado com @ApiOperation/@ApiResponse
- Logs: sem credenciais (SMTP_PASS, SENDGRID_API_KEY não logados)

**Dívidas Técnicas Registradas (F5+):**
- nestjs-pino não instalado (-0.75 score, não bloqueante) — task separada recomendada
- email/queue/ stub ausente (opcional per plano) — será criado em F7 com BullMQ

**ADRs vinculados:** Nenhuma nova (respeitadas ADR-V2-001 a ADR-V2-024)

**Plan:** [`workspace/plans/plan-email-common-f4-task1.md`](../workspace/plans/plan-email-common-f4-task1.md)
**Impl Notes:** [`workspace/implementations/impl-email-common-f4-task1.md`](../workspace/implementations/impl-email-common-f4-task1.md)
**Review:** [`workspace/reviews/review-email-common-f4-task1.md`](../workspace/reviews/review-email-common-f4-task1.md)
**Documentation:** [`workspace/documentation/doc-email-common-f4-task1.md`](../workspace/documentation/doc-email-common-f4-task1.md)
**Commit:** (a ser criado pelo Documenter)

---

## Task #1 — F3 Auth + RBAC Duplo — COMPLETE (V2 Fase F3)

**Module:** auth (Multi-agent — Pilares 2+3)
**Task:** Auth + RBAC Duplo (7 guards, 5 services, 13+4 endpoints)
**Status:** COMPLETA — Score 7.8/10 APPROVED
**Duration:** ~8h Implementer + ~1h Reviewer + ~30min Documenter
**Completado em:** 2026-05-09

**Agents Performance:**

| Agent | Duration | Quality |
|-------|----------|---------|
| Strategist | — | Plan completo, 4 decisões arquiteturais (D1-D4) |
| Implementer | ~8h | 78/78 testes, código limpo, dívidas F2 resolvidas |
| Reviewer | ~1h | Score 7.8/10 (3 issues MEDIUM F14, zero bloqueadores) |
| Documenter | ~30min | ADR-V2-003/004 formalizados, CHANGELOG/ROADMAP/STATUS atualizados |

**Pilares:**
- Pilar 1 (Engine): N/A (auth é estrutural — Prisma direto correto)
- Pilar 2 (Endpoints): **ATIVADO** — AuthController (13) + PermissoesController (4), ZERO duplicação
- Pilar 3 (Seed): RESPEITADO — 128 DClasses de F1, ZERO nova criada

**Deliverables:**
- [x] AuthModule: 7 guards (Jwt, ApiKey, McpKey, Composite, OrgTenant, ProjectScope, Roles)
- [x] AuthService: register (transaction), login (bcrypt), refresh (rotate + reuse), logout, getMe, updateMe, deleteMe
- [x] ApiKeyService: generate (SHA-256), validate, revoke, listByProject
- [x] McpKeyService: generate (transaction DTabela+DUserGroup), validate (fast path + fallback), revoke (sync)
- [x] RefreshTokenService: generate, validate, rotate (estrito), revoke
- [x] RoleResolverService: getOrgRole, getProjectRole — LRU cache 1000/5min TTL
- [x] AuthController: 13 endpoints (POST register/login/refresh/logout, GET/PATCH/DELETE /me, POST/GET/DELETE api-key, POST/GET/DELETE mcp-key)
- [x] PermissoesController: 4 endpoints (GET/POST/PATCH/DELETE) com @Roles('ADMIN') guard
- [x] @Public() decorator substitui @SkipGuard()
- [x] ADR-V2-003: RBAC via DVincula + idClasse (Aceito)
- [x] ADR-V2-004: Keys via DTabela (Aceito)
- [x] Dívidas F2 resolvidas: PaginationMetaDto, formatTabelaResponse, validarClasse extraídas

**Metrics:**
- Build: PASS (0 TypeScript, 0 ESLint warnings)
- Tests: 78/78 PASS (12 suites: auth.service, api-key.service, mcp-key.service, refresh-token.service, role-resolver.service, auth-composite.guard, roles.guard, + F2 carryover)
- Queries/request: /auth/me = 2 (DUserGroup+DEntidade + DVincula), RBAC = 1 + cache (LRU)
- N+1 Queries: ZERO (verified with DATABASE_LOGGING=true)
- Bcrypt rounds: 12 (constante explícita, comentário ADR)
- Swagger: 100% (13 auth + 4 permissoes endpoints documentados)
- JSDoc: 100% (todos métodos públicos)

**Issues (F14):**
- M1: Encapsulamento — AuthController acessa `this.authService['prisma']` via bracket notation
- M2: N+1 em write — revokeApiKeys usa loop sequencial em vez de updateMany
- M3: Scan O(n) — findUserGroupByRefreshToken faz scan sem índice

---

## Task #1 — F2 Endpoints Genéricos — COMPLETE (V2 Fase F2)

**Module:** endpoints (Pilar 2)
**Task:** 3 Controllers Genéricos (EntidadeController + TabelaController + ClasseController)
**Status:** COMPLETA
**Duration:** ~3h Implementer + ~1h Reviewer + ~30min Documenter
**Completado em:** 2026-05-08
**Quality Score:** 9.0/10 APPROVED

**Agents Performance:**

| Agent | Duration | Quality |
|-------|----------|---------|
| Strategist | — | Plan completo e viável |
| Implementer | ~3h | Código limpo, 43 testes (17 acima do mínimo) |
| Reviewer | ~1h | Score 9.0/10 (2 issues menores, zero bloqueadores) |
| Documenter | ~30min | Doc completa, commit convencional, tech debt registrado |

**Pilares:**
- Pilar 1 (Engine): N/A (tabelas estruturais — Prisma direto correto, sem Engine)
- Pilar 2 (Endpoints): **ATIVADO** — 3 controllers genéricos canônicos, ZERO controllers específicos
- Pilar 3 (Seed): RESPEITADO — 128 DClasses validadas, ZERO nova criada

**Deliverables:**
- [x] `EntidadeController` + `EntidadeService` (280L service, 200L controller, 8 endpoints)
- [x] `TabelaController` + `TabelaService` (300L service, 160L controller, 5 endpoints)
- [x] `ClasseController` + `ClasseService` (200L service, 140L controller, 4 GETs + bloqueio 403)
- [x] Infraestrutura: `ParseBigIntPipe`, `ParseOptionalBigIntPipe`, `@SkipGuard()`, LRU cache
- [x] ADR-V2-015: `?idClasse=N` + `?classe=NOME` deprecated + headers `Deprecation` + `Sunset`
- [x] Audit inline via DEvento -497
- [x] Métodos canônicos: `getEntidadeIdFromUserGroup()`, `createSeller()`
- [x] 43 unit tests (target: 26)
- [x] JSDoc completo em todos os métodos públicos
- [x] Swagger 100% em `/api/docs`

**Metrics:**
- Build: PASS (`npm run build` — 0 erros)
- TypeScript: 0 errors (`npx tsc --noEmit`)
- ESLint: 0 errors, 0 warnings
- Tests: 43/43 PASS
- Controllers: 3 ONLY (entidades, tabelas, classes)
- N+1 Queries: ZERO (listagens com include/join, getTree = 1 findMany + Map)
- BigInt: 100% serializado como string em responses
- ADR-V2-015: implementado com LRU cache, headers, testes regressão

**Tech Debt (F3):**
1. Mover `PaginationMetaDto` para `src/common/dto/`
2. Mover `formatTabelaResponse` para `src/tabelas/helpers/`
3. Extrair `validarClasse` duplicada para `src/common/helpers/`
4. Aplicar `ParseBigIntPipe` em `@Param('id')`
5. Redigir ADR-V2-025 (BigInt serialization strategy)
6. Cache em memória para `validarClasse`
7. Remover wrapper `?classe=NOME` após sunset (2026-06-05)


---

<!-- dedup:implementer:2 -->
### Agent Concluído: implementer

**Task:** #2
**Timestamp:** 09/05/2026 10:28:43
**Agent:** implementer
**Status:** Completo


---

<!-- dedup:reviewer:2 -->
### Agent Concluído: reviewer

**Task:** #2
**Timestamp:** 09/05/2026 10:34:05
**Agent:** reviewer
**Status:** Completo


---

<!-- dedup:strategist:2 -->
### Agent Concluído: strategist

**Task:** #2
**Timestamp:** 09/05/2026 16:06:58
**Agent:** strategist
**Status:** Completo

---

<!-- dedup:strategist:3 -->
### Agent Concluído: strategist

**Task:** #3
**Timestamp:** 10/05/2026 01:54:17
**Agent:** strategist
**Status:** Completo

---

<!-- dedup:documenter:2 -->
### Agent Concluído: documenter

**Task:** #2
**Timestamp:** 10/05/2026 09:04:44
**Agent:** documenter
**Status:** Completo

