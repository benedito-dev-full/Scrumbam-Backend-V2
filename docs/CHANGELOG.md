# Changelog — Scrumban-Backend-V2

Todas as mudancas notaveis deste projeto serao documentadas neste arquivo.

O formato segue [Keep a Changelog 1.1.0](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere a [Semantic Versioning 2.0.0](https://semver.org/lang/pt-BR/).

Tipos de entrada usados: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
`Security`, `Performance`, `Tests`.

---

## [Unreleased]

### Added

- **F13 Sub-tarefa 2.1: Seed DClasses Agent Session Lifecycle + ADR-V2-033 Esqueleto** (V2 F13 Backend-Side Prep) - 2026-05-12
  - **Seed:** 2 DClasses negativas `-505 AGENT_SESSION_CREATED` e `-506 AGENT_SESSION_RESUMED` (idPai=-3 EVENTOS)
  - **Range:** -490..-509 (eventos agent) respeitado; sem conflito com chaves existentes
  - **Total:** 45 fixas + 95 específicas = 140 DClasses (Pilar 3 ativado)
  - **Validação:** `validateHierarchy()` dry-run PASS; sem tabela nova (ADR-V2-001)
  - **ADR:** `docs/decisions/ADR-V2-033-contrato-execute-outbound-e-execution-result-inbound.md` esqueleto criado com decisão (e) preenchida; (a-d) TODO
  - **Pilares:** P3 respeitado (ZERO DClasse sequestrada); P1/P2 N/A (apenas seed)
  - **ADRs:** ADR-V2-001, ADR-V2-008, ADR-V2-013, ADR-V2-032, **ADR-V2-033**
  - **Review:** APPROVED 9.0/10
  - **Issue M1 Corrigido:** JSDoc seed linha 249 atualizado (92/137 → 95/140 DClasses)

- **Modal Criar Task com Tipo + Responsável + Canal + Criador** (V2 F5 extensão) - 2026-05-11
  - **Backend (tasks):** `CreateTaskDto` + `UpdateTaskDto` com campo `taskType?: string` (enum FEATURE|BUG|IMPROVEMENT|REVIEW|EXPLAIN)
  - **Schema:** `TaskDados` estendida com `taskType?: string` (persistido em Json — ADR-V2-001)
  - **Service:** `create()` injeta `taskType` após `buildInitialTaskDados()`; `update()` faz merge superficial preservando `identifier`/`v3`/`capture`
  - **Response:** `TaskResponseDto` expõe `taskType: string | null` no top-level (projeção de `dados.taskType`)
  - **Frontend (intentions):** `CreateIntentionDto` estendido com `assigneeId?` e `canal?` (4 opções: web/telegram/api/mcp)
  - **Modal:** 3 Popover novos (Responsável via `useOrgMembers`, Canal com radio buttons, Criador read-only)
  - **API:** `intentionsApi.create()` mapeia `taskTypeId` → `taskType` (enum uppercase), envia `assigneeId` e `source` (= `canal`)
  - **Adapter:** `task-to-intention.ts` prioriza `raw.taskType` top-level antes de fallback
  - **Tests:** 3 unit tests V2 (create-com, create-sem backward-compat, update-merge preserva identifier)
  - **Pilares:** P1 N/A (estrutural); P2 reutilizado (sem novo controller); P3 respeitado (ZERO DClasse nova)
  - **ADRs:** ADR-V2-001, ADR-V2-009
  - **Review:** APPROVED 8.5/10

- **Transversal: Convite de Membros por Email com Auto-Login** (V2 pós-F8 autorizado CEO) - 2026-05-11
  - **InvitesModule:** 3 endpoints (POST /organizations/:orgId/invites, GET /invites/:token, POST /invites/:token/accept)
  - **Token Seguro:** DTabela idClasse=-476 com hash SHA-256 em metaDados (raw token só no email)
  - **Rate Limit:** 3/min no POST create via Throttler
  - **Anti-Enumeração:** 404 idêntico para token invalido/expirado/usado (previne vaza de emails)
  - **Atomicidade:** $transaction em accept cria DUserGroup + DEntidade + DVincula + audit
  - **Auto-Login:** Accept retorna JWT + refresh + redirectTo='/intentions' (UX frictionless)
  - **Auditoria:** DEvento -502 INVITE_LIFECYCLE rastreia sent/accepted/expired/revoked via metaDados._meta.action
  - **Frontend:** Cliente HTTP + página /invite/page.tsx + modal InviteWorkspaceModal atualizada
  - **Seed:** 6 DClasses novas (-476 INVITE_TOKEN, -477..480 INVITE_STATUS_*, -502 INVITE_LIFECYCLE), total 137
  - **Segurança:** Fire-and-forget email com log estruturado, race-condition handling, token bruto nunca logado
  - **Tests/Build:** npm run build PASS, tsc PASS, eslint PASS, 14 unit + 4 integration PASS, coverage 87%
  - **Pilares:** P2 justificado (workflow com side effects); P3 respeitado (ZERO tabela nova, reutiliza padrão V2)
  - **ADRs:** ADR-V2-001, ADR-V2-003, ADR-V2-004, ADR-V2-008, **ADR-V2-028**
  - **Review:** APPROVED 8.3/10

- **F12 Task#1: Webhooks Outbound (CRUD, Signing, BullMQ, Auto-disable, SSRF, Observabilidade)** (V2 F12) - 2026-05-10
  - **Webhooks Module:** CRUD completo de webhooks via `DTabela.idClasse=-470`
  - **EventRouter Integration:** Hook dinâmico em `EventRouterService` para captura de eventos e enfileiramento assíncrono
  - **BullMQ Processing:** Despacho assíncrono com retry exponencial (3x) e truncamento de payload (256KB)
  - **Segurança (SSRF):** `WebhooksSsrfService` com resolução DNS e bloqueio de IPs privados/locais/metadata
  - **Segurança (Signing):** Assinatura HMAC-SHA256 e criptografia AES-256-GCM dos secrets
  - **Resiliência:** Auto-disable após 10 falhas consecutivas; timeout de 10s por tentativa
  - **Observabilidade:** Métricas P95 de latência e contadores de sucesso/falha/timeout via `@Cron`
  - **Documentação:** Guia completo em `docs/webhooks-guide.md`
  - **Pilares:** P2 justificado (gestão específica + dispatcher); P3 respeitado (DClasses -470, -491)
  - **ADRs:** ADR-V2-012 (Webhooks outbound), ADR-V2-028, ADR-V2-031
  - **Tests/Build/Lint:** `npm run build` PASS; `tsc --noEmit` PASS; `eslint` PASS; coverage 100% serviços críticos
  - **Review:** APPROVED 8.8/10

- **F10 Task#6: Channels Bloco D - Rate Limit + Observabilidade** (V2 F10) - 2026-05-10
  - **Rate limit Telegram:** `TelegramRateLimitService` com Redis Lua atomico por `rate:telegram:{chatId}`, limite 30 mensagens/min/chat e fail-open controlado
  - **Observabilidade:** `TelegramMetricsService` com contadores text/voice/command/intent e P95 de latencia de transcricao
  - **Webhook:** `TelegramWebhookService` aplica rate limit antes de resolver usuario/processar mensagem e registra metricas por `correlationId`
  - **Seguranca de logs:** `TelegramSendService` mascara `bot<TOKEN>` em logs de webhook
  - **Debts resolvidos:** [DEBT-F10-C-01] `UserProjectService`, [DEBT-F10-C-02] backlog `INBOX+READY`, [DEBT-F10-C-03] `findByChat` com filtro JSONB por `chatId`
  - **Tests/Build/Lint:** `tsc --noEmit` PASS; jest recorte channels + UserProjectService PASS (16 suites / 130 tests); build PASS; eslint PASS
  - **Pilares:** P1 N/A (channels infra, zero Engine); P2 reutiliza services existentes; P3 respeitado (zero migration/seed/DClasse nova)
  - **F10 Completa (Blocos A-D)**

- **F10 Task#5: Channels Bloco C - Telegram Commands (create-task, tasks, status, pair)** (V2 F10) - 2026-05-10
  - **6 command handlers com JSDoc 100%:** StartHandler, PairHandler, TasksHandler, StatusHandler, CreateTaskHandler, CreateTaskFromTextIntent
  - **Intent parsing:** MessageRouterService resolve comandos via `/` e intents sem barra automaticamente
  - **Reutilizacao:** TasksService.findMany + TasksService.create (zero duplicacao logica negocio)
  - **Period resolver:** TasksHandler filtra today/week/backlog com TimezoneService (Brasil timezone)
  - **3 debts registrados e resolvidos no Bloco D:** [DEBT-F10-C-01] extrair `resolveDefaultProjectId`, [DEBT-F10-C-02] corrigir filtro backlog (READY), [DEBT-F10-C-03] corrigir findByChat JSONB
  - **Tests:** 6 handlers + intents, todos PASS
  - **Pilares:** P2 justificado (handlers decoram TasksService); P3 respeitado (zero DClasse nova)
  - **F10 Blocos A-C:** 30/30 + 32/32 + 10/10 = 72/72 testes PASS
  - **Review:** APPROVED 8.5/10

- **F10 Task#5: Channels Bloco B - Telegram Webhook + Groq Whisper** (V2 F10) - 2026-05-10
  - **TelegramSecretGuard:** crypto.timingSafeEqual (OWASP ASVS 2.9.2), fail-closed, zero token leak
  - **POST /webhooks/telegram:** @HttpCode(200) + setImmediate (resposta não-bloqueante)
  - **handleText:** prisma.$transaction (DEvento -493 + DVincula -483 lastSeenAt)
  - **handleVoice:** DEvento -494 gravado mesmo com falha Groq; error em metaDados
  - **Deduplicação update_id:** Redis SET NX PX 3600000 (1h TTL)
  - **TelegramSendService:** sendMessage + setWebhook (onModuleInit, idempotente)
  - **TelegramFileDownloadService:** download AbortController timeout 10s
  - **GroqWhisperService:** transcribe multipart/form-data, ServiceUnavailableException sem key
  - **Evento emitido APÓS commit:** Padrão #7 V2 verificado (callOrder)
  - **Tests:** 32/32 PASS (unit + integration)
  - **Review:** APPROVED 8.8/10

- **F10 Task#4: Channels Bloco A - Core Channels** (V2 F10) - 2026-05-10
  - **ChannelAdapter interface:** `send()`, `parseInbound()`, `verifySignature()` + `InboundMessage` type contrato genérico para múltiplos canais
  - **PairingService:** `generate()` (CSPRNG 32-byte + SHA-256 hash) com UPSERT em DTabela -474 (PAIRING_TOKENS); `consume()` com $transaction one-shot (lookup + mark used + create DVincula)
  - **AccountLinkService:** `findByChat()` query única (BigInt chatId) com índice em DTabela, sem N+1
  - **MessageRouterService:** `handleInbound()` com intent parsing a partir de `InboundMessage`, `registerIntentHandler()` para extensibilidade plugável
  - **CommandRegistryService:** `register()` para adicionar comandos, `resolve()` para lookup por nome
  - **PairingController:** POST `/channels/pairing/generate` (retorna token) + POST `/channels/pairing/link` (consome token + cria DVincula)
  - **ChannelsModule:** `onModuleInit` verifica CHANNELS_ENABLED feature flag (ADR-V2-010 compliance: módulo opcional)
  - **DTOs validados:** `LinkAccountDto` com @Matches(/^\d+$/) em chatId para validação numérica
  - **Pilares:** P1 N/A (infraestrutura), P2 controller proprio justificado (orquestração pairing + linking), P3 zero migration/seed/DClasse nova
  - **Tests:** 30/30 PASS (pairing, account linking, message routing, command registry)
  - **Review:** APPROVED 8.2/10; 3 issues corrigidos (chatId validation, consume filter otimizado, dead code removido)

### Added (histórico)

- **F9 Task#3: Reports PDF / Bloco X** (V2 F9) - 2026-05-10
  - **ReportsModule:** `GET /reports/projects/:projectId/pdf` com response `application/pdf` via PDFKit
  - **PdfGeneratorService:** 8 seções — header, resumo executivo, flow metrics, velocity, burndown, tasks-by-user, forecast, riscos
  - **Cache TTL:** 5 minutos via `TtlCacheService`
  - **Graceful degradation:** `Promise.allSettled` para forecast/analytics (failures → warnings em payload, nunca 500)
  - **Tenant isolation:** validacao explícita (403 org divergente); nenhum vazamento de dados cross-org
  - **Dependências:** `pdfkit`, `@types/pdfkit` adicionadas
  - **Pilares:** P1 read-only/zero Engine, P2 controller proprio justificado, P3 zero migration/seed/DClasse nova
  - **Tests:** 28/28 PASS (pdfkit generation, graceful degradation, caching, tenant isolation)
  - **F9 completa:** 58/58 testes (Blocos V + W + X)
  - **Review:** APPROVED 8.8/10

- **F8 Task#2: Search / Bloco U** (V2 F8) - 2026-05-10
  - **SearchModule:** `GET /search` com resultado categorizado `{ tasks, projects, people, cursors, meta }`
  - **Busca cross-entity:** DTask, DProject e DEntidade em uma request, com limites 50%/30%/20%
  - **Tenant isolation:** tasks via `project.idEstab`, projects via `idEstab`, people via `DVincula` membership de organizacao
  - **Pagination:** cursors independentes `taskCursor`, `projectCursor`, `peopleCursor`
  - **Performance:** 4 queries/request; branches principais em `Promise.all`; `queryPeople` usa `DVincula` + `DEntidade IN`, sem N+1
  - **Pilares:** P1 read-only/zero Engine, P2 controller proprio justificado, P3 zero migration/seed/DClasse nova
  - **Tests:** `npm run build` PASS, `npx tsc --noEmit` PASS, `npx eslint src/search/` PASS, `npx jest src/search --runInBand` PASS (15/15), service coverage 97.61%
  - **Review:** APPROVED 8.8/10

- **F8 Task#1: Flow Metrics + Forecast Monte Carlo** (V2 F8) - 2026-05-10
  - **FlowMetricsModule:** 6 endpoints read-only: `cycle-time`, `lead-time`, `throughput`, `wip-age`, `cfd`, `dashboard`
  - **ForecastModule:** `GET /forecast/:projectId` com Monte Carlo bootstrap resample e percentis p50/p75/p85/p95
  - **PeriodResolver:** filtros de periodo centralizados via `TimezoneService`
  - **Dashboard:** agregacao paralela via `Promise.all`
  - **Forecast historical:** throughput por sprints com fallback rolling-window
  - **Pilares:** P1 read-only/zero Engine, P2 endpoints proprios justificados por analytics derivados, P3 zero migration/seed/DClasse nova
  - **Tests:** `npm run build` PASS, `npx tsc --noEmit` PASS, `npx jest src/flow-metrics src/forecast --runInBand` PASS (59/59 no review)
  - **Review:** APPROVED 8.5/10

- **F7 Task#3: Notifications endpoints `/notifications/*`** (V2 F7) - 2026-05-10
  - **NotificationsModule:** controller proprio `/notifications` para leitura e mutacao de notificacoes in-app em `DEvento.idClasse=-490`
  - **Endpoints:** `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`, `DELETE /notifications/:id`
  - **Soft delete:** migration pontual adiciona `DEvento.excluido Boolean @default(false)`; delete seta `excluido=true`
  - **Read state:** `metaDados.read/readAt`; ausencia de `read` e tratada como nao lida
  - **Ownership:** todas as queries filtram `idEntidade=user.entidadeId` e `excluido=false`
  - **NotificationConsumer:** idempotencia passa a filtrar `excluido=false`
  - **Pilares:** P1 N/A estrutural, P2 controller proprio justificado, P3 zero seed/DClasse nova
  - **ADRs:** ADR-V2-032 formaliza excecao controlada sem precedente geral
  - **Tests:** `npx.cmd prisma generate` PASS, `npm.cmd run build` PASS, `npx.cmd tsc --noEmit` PASS, `npx.cmd jest src/notifications src/eventos/consumers --runInBand` PASS (4 suites / 30 tests)
  - **Review:** APPROVED 8.2/10

- **F7 Task#2: NotificationConsumer + WebhookConsumer + EventRouter Ativo** (V2 F7) - 2026-05-10
  - **NotificationConsumer:** cria notificacoes in-app em `DEvento.idClasse=-490` para `task.status.changed`, `task.assigned`, `execution.awaiting_approval`, `execution.completed` e `execution.failed`
  - **WebhookConsumer:** resolve `orgId` por payload, project ou task, le configs ativas `DTabela.idClasse=-470` por organizacao e chama dispatcher injetado
  - **WebhookDispatcherStub:** contrato outbound sem HTTP real; HMAC, retry de rede, auto-disable e `DEvento -491` ficam para F7 Task #4/F12
  - **EventRouterService:** audit continua catch-all; notification/webhook entram por trigger explicito
  - **Pilares:** P1 N/A estrutural, P2 zero endpoint novo, P3 zero seed/migration/DClasse nova
  - **ADRs:** ADR-V2-028, ADR-V2-029, ADR-V2-030, ADR-V2-031
  - **Tests:** `npm.cmd run build` PASS, `npx.cmd tsc --noEmit` PASS, `npx.cmd jest src/eventos --runInBand` PASS (3 suites / 19 tests)
  - **Review:** APPROVED 8.4/10; minor de idempotencia resolvido na F7 Task#3

- **F7 Task#1: Eventos Canônicos — Core de Eventos + Refactor F4/F6** (V2 F7) — 2026-05-09
  - **EventProducerService:** único entry point emissão, validação `type ∈ ALL_EVENT_TYPES_SET`, metadata enriquecida (source, timestamp, correlationId)
  - **EventRouterService:** roteamento catch-all em Task#1 (AuditLogConsumer), placeholders Task#2 (NotificationConsumer, WebhookConsumer)
  - **CircuitBreakerService:** Half-Open pattern (closed/open/half-open) com 5 falhas em 60s, timeout 30s para recuperação
  - **IntelligentRetryService:** backoff exponencial 1/2/4/8/16s (5 tentativas máximo), state machine com `@OnModuleDestroy`
  - **AuditLogConsumer:** único INSERT `DEvento`, mapping `type→idClasse` alinhado com seed (-489..-501), ADR-V2-026/027 aplicadas
  - **TelemetryService:** counters emitted/succeeded/failed, gauge pendingRetries
  - **EventHealthController:** `GET /events/health` (@Public) com status infra + métricas producer/router/circuitbreaker
  - **Refactor F4/F6:** AuditService DELETADO; 5 services migrados (Email, Orgs, Projects, Tasks, Engine F6) para EventProducerService; OperacaoExecucaoClaude agora usa IEventProducer typed
  - **CommonModule @Global:** centraliza PrismaService, CorrelationIdService, TimezoneService (elimina duplicate stores)
  - **Seed F1:** -489 AUDIT_GENERIC, -499 PROJECT_LIFECYCLE, -500 ORG_LIFECYCLE = 131 DClasses total
  - **Tests:** 292/292 PASS (26 suites), N+1 ZERO, JSDoc 100% em core eventos

### Changed

- **Estrutura de auditoria:** `prisma.dEvento.create` direto → `EventProducerService.addInternalEvent()` em 5 services (não inclui auth.service.ts, débito H1 para próxima task)
- **OperacaoExecucaoClaude (F6):** `eventProducer` typed via `IEventProducer` (era `any`), event emitido APÓS super.grava()
- **CommonModule:** novo módulo @Global exporta 3 singletons canônicos (resolve duplicate AsyncLocalStorage)

### Fixed

- **F8 Forecast:** N+1 em `ForecastService.getSprintThroughput` removido com `groupBy` batch + fallback unico em memoria.
- **F8 Flow Metrics:** filtro `criadoEm` removido de cycle-time e lead-time; periodo passa a ser aplicado pela telemetria `doneAt`.

### Performance

- **F8 Dashboard:** services de flow metrics agregados com `Promise.all`.
- **F8 Search:** 3 branches principais paralelas e 4 queries/request, sem query por resultado.
- **F8 Forecast:** contagem por sprint em lote, sem loop de queries por sprint.

### Tests

- **F8 Task#1:** build PASS, TypeScript 0 errors, 59/59 tests PASS no review.
- **F8 Task#2:** build PASS, TypeScript 0 errors, ESLint PASS, 15/15 tests PASS, `search.service.ts` com 97.61% statements coverage.

### Technical Debt

- **F8 CFD:** `DEvento` nao tem FK direta para `DProject`; filtro por projeto fica em memoria via taskId, monitorar para F9/F14.
- **F8 Search:** controller depende de e2e futuro; FTS/GIN index fica para F14 se volume alto.

### Removed

- `src/common/services/audit.service.ts` — substituído por EventProducerService (0 impacto em caller — adapter pattern mantido)

### Deprecated

- Direct `prisma.dEvento.create()` calls — use `EventProducerService.addInternalEvent()` (deprecated per padrão #14)
- Types `auth.login`, `auth.logout`, `auth.register`, `auth.failed` — não em EVENT_TYPES (débito H1)

---

- **F6 ExecutionsModule + ApprovalFlow + 58 Patterns Adversariais** (Task #2, V2 F6) — 2026-05-09
  - **gravarAposAprovacaoManual()** em `OperacaoExecucaoClaude`: restaura DPedido `awaiting_approval`, UPDATE (não INSERT), DVFS 6+7, `_executarClaude()` — Pilar 1 preservado
  - **risk-gate-validator.js:** 25 HIGH + 15 MEDIUM patterns (40 total, 58 testes adversariais PASS)
  - **IExecucaoData.risk.matchedPatterns** corrigido: `string[]` → `Array<{ pattern: string; level: string }>`
  - **ExecutionsModule:** `ExecutionsService` (LOW/MED auto, HIGH awaiting), `ApprovalFlowService` (approve race-safe, reject, rollback), `ApprovalFlowSweeperService` (@Cron expira vencidos), `ExecutionHistoryService` (cursor pagination), `ClaudeRunnerService` (STUB F6), `ExecutionsController` (8 endpoints Swagger), `ExecutionAccessGuard`, `ExecutionThrottlerGuard` (30 req/min)
  - **Race condition approve()**: `$executeRaw` com `WHERE dados->'approval'->>'status' = 'awaiting_approval'` — segundo admin recebe ConflictException 409
  - **riskLevel** derivado de `idClasse` (-301→LOW, -302→MED, -303→HIGH) via `RISK_CLASSE_MAP`

- **F6 Engine + OperacaoExecucaoClaude — Pilar 1 ATIVO** (Task #1, V2 F6) — 2026-05-09
  - **Operacao.ts** (~80L): classe abstrata base — `nova()` via `getNextSequenceKey()` (PostgreSQL sequence `chcriacao_seq`), `erro()` com InternalServerErrorException
  - **OperacaoPedido.ts** (~800L): FULL workflow polimórfico — `_carregaScriptsCalc()` (chaves 3,4,5) + `_carregaScriptsGrav()` (chaves 6,7); filtro `chaveScript` (ADR-V2-016, bug `s.id` CORRIGIDO); fallback idClasse concreto → -300 (decisão CEO)
  - **OperacaoExecucaoClaude.ts** (~260L): CORAÇÃO V2 — `extends OperacaoPedido` (ADR-V2-005); Risk Gate → Approval → Claude Runner (STUB) → PR auto-open; `calcula()` determina `idClasse` via risk.level (-301/-302/-303, ADR-V2-006)
  - **Auxiliares (VOs puros):** `PedidoCabecalho`, `PedidoItem`, `PedidoItens` — sem Prisma, `toJson()`, getters/setters encapsulados
  - **Interfaces:** `IOperacaoConstruct`, `IOperacaoPedidoConstruct`, `IOperacaoExecucaoClaudeConstruct`, `IExecucaoData` (command/risk/approval/claude/git/pullRequest/task/audit)
  - **Helpers:** `sequence.helper.ts` (BigInt), `dvfs-loader.helper.ts` (fallback 2 níveis + cache TTL 5min), `execution-context.helper.ts`
  - **Scripts DVFS** (`src/engine/dvfs/`): `risk-gate-validator.js` (chave=3, 5 HIGH + 3 MEDIUM patterns), `command-validator.js` (chave=4, path traversal + limites), `pr-auto-open.js` (chave=7, GitHub API + fallback URL), `notification-dispatcher.js` (chave=7, DEvento -490)
  - **dvfs.seed.ts:** 5 registros DVFS idempotentes (`upsert`) em `idClasse=-300`; chaves 5,6 no-op stubs; chave 7 combina pr-auto-open + notification
  - **Migration** `20260509000000_add_chcriacao_seq`: `CREATE SEQUENCE chcriacao_seq START WITH 1000000`
  - **24 testes unitários** (PASS): 3 BLOQUEANTES ADR-V2-016 (R-CHAVE-5, R-CHAVE-7, DVFS-NULL-WARN) + 21 unitários OperacaoExecucaoClaude

### Security
- Scripts DVFS executados via `eval()` em runtime — nenhum endpoint expõe `conteudo` de script via request (risco RCE mitigado: scripts são exclusivamente seed de desenvolvedor, chaves negativas, Pilar 3)

### Tests
- **R-CHAVE-5 (BLOQUEANTE ADR-V2-016):** `_funcPosCalculo` carrega DVFS `chaveScript=5` — falha automaticamente se bug `s.id` reintroduzido
- **R-CHAVE-7 (BLOQUEANTE ADR-V2-016):** `_funcPosGravacao` carrega DVFS `chaveScript=7` — idem para caminho de gravação
- **DVFS-NULL-WARN:** chave ausente retorna `undefined` e dispara `Logger.warn` (nunca null silencioso)

---

- **F5 Domínio Estrutural Scrumban** (Task #1, V2 F5) — 2026-05-09
  - **Organizations:** CRUD + membership RBAC duplo (DVincula -161/-162/-163) + cascade delete
  - **Teams:** CRUD + membership (DVincula -181/-182) + issue counter atomico (DTabela -475)
  - **Projects:** CRUD + seed bootstrap 9 statuses V3 (-441..-449) + Sprint (-400) + activity feed + members
  - **Tasks:** CRUD + state machine V3 (9 estados, ~12 transições) + identifier atômico DEV-N
  - **WorkflowStatuses + Sprints:** wrappers thin (ADR-V2-009) — CRUD via `/tabelas?idClasse=-44X/-400`
  - **TeamRolesGuard:** implementação real (substitui stub F3) + LRU cache
  - **getEntidadeIdFromUserGroup():** método centralizado + LRU cache em EntidadeService
  - **Seed:** +2 classes (-153 SCRUMBAN_PROJECT, -154 SCRUMBAN_TASK = 130 total)

### Performance
- N+1 ZERO: ProjectActivityService cursor pagination, ProjectMembersService batch, TasksService JOIN (25+ verificações)
- Identifier DEV-N: atomicidade verificada contra race conditions (10 concurrent POST test)
- LRU cache: TeamRolesGuard (2000 entries, 5min), RoleResolverService (1000, 5min), getEntidadeIdFromUserGroup (1000, 5min)

### Tests
- 189/189 PASS (87 F5-específicos + 102 anteriores)
  - Organizations: 24 unit tests (3 integrados)
  - Teams: 22 unit tests (2 integrados)
  - Projects: 31 unit tests (6 integrados seed bootstrap)
  - Tasks: 28 unit tests (5 integrados state machine)
  - Auth + Entidades: 2 unit tests (decorator, getEntidadeIdFromUserGroup)
  - Smoke: build, tsc, eslint, 12 transições state machine válidas + 15 inválidas rejeitadas

### Technical Debt Resolvida
- `@TeamRoles()` decorator stub → implementado com LRU cache
- RolesGuard F3 (organização) → complementado com TeamRolesGuard (time/projeto)

### Issues Registrados (F14)
- `parseInt()` em 4 controllers para parsing de `limit` query param — refatorar para BigInt-safe
- ProjectMembersService sem validação se usuário existe em org pai — adicionar F7+
- TasksStateMachineService cache de transições — considerar memoization se >500 tasks/sprint

### F4 Email Module + Common Services** (Task #1, V2 F4) — 2026-05-09
  - **Email Module:** abstração de provider com SMTP (nodemailer), SendGrid, Resend; `EMAIL_MOCK=true` para CI
    - 4 templates TypeScript puro: welcome, password-reset, invite, notification-digest
    - AuditService registra `email.sent` e `email.failed` em DEvento idClasse=-501 APÓS persistência (canônico)
    - `EmailService.sendTemplate()` com suporte a customização de headers/replyTo
  - **Common Services (Pilares 1 e 2 suporte):**
    - TimezoneService: America/Sao_Paulo canônico com 5 métodos (applyDateFilters, toStartOfDayBrazil, toEndOfDayBrazil, getPeriodDates, toStartOfMonthBrazil) — integrado em EntidadeService
    - CorrelationIdMiddleware: AsyncLocalStorage thread-safe com X-Correlation-Id (ecoado em response)
    - LoggingInterceptor: loga method, path, statusCode, durationMs, correlationId, userId em toda request
    - HttpExceptionFilter: padroniza respostas 4xx/5xx com { statusCode, message, correlationId, timestamp }
    - AuditService stub: INSERT em DEvento idClasse=-501 pós-persistência (substituído por EventProducerService em F7)
    - HealthModule: GET /health (@Public, sem autenticação) com checkDb + checkRedis + checkEmail; HTTP 503 se DB error
  - **Utils canônicos:** validateCpf, validateCnpj, cleanCpfCnpj, hashSha256, hashBcrypt, compareBcrypt — sem dependências externas
  - **Documentation:**
    - `src/email/README.md` — guia operacional do módulo email (configuração, templates, modo mock)
    - `src/common/health/README.md` — guia de health check (load balancer, Kubernetes, Prometheus)
    - `docs/email-providers.md` — guia completo de configuração (SMTP local MailHog, SendGrid, Resend, Mock)
  - **Fix (Reviewer MINOR m1):** HealthController adiciona `@Public()` explícito (seguro para APP_GUARD global futuro)

### Performance
- N+1 ZERO: HealthService usa `Promise.all()` sem loop; EmailService 0 queries (apenas provider.send)
- Timeout health check: 5s com fallback "degraded" para Redis opcional
- CorrelationIdMiddleware: AsyncLocalStorage garante isolamento por request (sem race conditions)

### Tests
- 102/102 PASS (78 anteriores + 24 novos em F4)
  - TimezoneService: 6 specs (edge cases DST, UTC/Brasília)
  - EmailService: 8 specs (providers, templates, mock, audit)
  - HealthService: 6 specs (checks db/redis/email, timeouts, status codes)
  - AuditService: 2 specs (insert, error handling)
  - Utils: 2 specs (crypto, validation)

### Security
- Bcrypt com saltRounds=12 em hashBcrypt (canônico)
- X-Correlation-Id sanitizado de XSS (alphanumeric + hífens)
- Sem logs de credenciais de email (SMTP_PASS, SENDGRID_API_KEY não logados)

### Technical Debt Registrado
- `nestjs-pino` não instalado (DoD não atendido) — dívida para F5 ou task dedicada (-0.75 score, não bloqueante)
- `email/queue/` stub ausente (opcional per plano, mas melhora completude) — será criado em F7 com BullMQ
- Dívida mínima mantida: "-0.5 @Public explícito em Health" resolvida neste commit

### Dívidas Técnicas Futuras (F7+)
- BullMQ queue para processamento assíncrono de emails
- Retry automático com exponential backoff
- Webhooks de delivery status (SendGrid, Resend)
- Template versioning com migrations

---

- **F3 Auth + RBAC Duplo** (Task #1, V2 F3) — 2026-05-09
  - `AuthModule` completo: 7 guards (JwtAuthGuard, ApiKeyGuard, McpKeyGuard, AuthCompositeGuard, OrgTenantGuard, ProjectScopeGuard, RolesGuard), 5 services (AuthService, ApiKeyService, McpKeyService, RefreshTokenService, RoleResolverService)
  - `AuthController`: 13 endpoints (register, login, refresh, logout, /me CRUD + api-key + mcp-key) — todas com Swagger 100%, JSDoc completo
  - `PermissoesModule`: 4 endpoints CRUD DPermissao com `@Roles('ADMIN')` guard
  - RBAC duplo via DVincula + idClasse (ADR-V2-003): Org roles (-161 ADMIN / -162 MEMBER / -163 VIEWER); Project roles (-171 MANAGER / -172 MEMBER / -173 VIEWER)
  - API Keys via DTabela(-471) + MCP Keys via DTabela(-472) com hash duplicado em DUserGroup.dados (ADR-V2-004)
  - `@Public()` decorator substitui `@SkipGuard()` placeholder de F2
  - Refresh token rotativo: cada refresh gera novo hash, token antigo invalidado (reuse detection)
  - RoleResolverService com LRU cache 1000 entries TTL 5min — N+1 ZERO em RBAC queries
  - OrgTenantGuard com LRU cache — isolamento multi-tenant via DProject.idEstab

### Fixed (Dívidas F2 resolvidas em F3)
- `PaginationMetaDto` movida de `src/entidades/dto/` para `src/common/dto/pagination-meta.dto.ts` (resolve cross-module dependency)
- `formatTabelaResponse` extraída de inline em `tabelas.service.ts` para `src/tabelas/helpers/format-tabela-response.ts`
- `validarClasse` extraída para `src/common/helpers/validar-classe.helper.ts` (elimina duplicação entre entidades e tabelas)
- `ParseBigIntPipe` aplicado em `@Param('id')` em todos os controllers F2 (EntidadeController, TabelaController, ClasseController)
- `POST /classes` registrado explicitamente com `@Post()` retornando `HttpStatus.FORBIDDEN` com mensagem clara

### Technical Debt (Registrado para F14)
- `findUserGroupByRefreshToken` em AuthController acessa `this.authService['prisma']` via bracket notation — refatorar para método público em AuthService
- `revokeApiKeys` usa loop sequencial com `await` em vez de `updateMany` — refatorar para batch update
- `ApiKeyService.validate` sem índice GIN em DTabela.dados Json — avaliar raw query ou criar índice se volume > 100 keys
- `findUserGroupByRefreshToken` faz scan O(n) em DUserGroup — adicionar campo indexado ou userGroupId no RefreshDto

### Performance
- N+1 ZERO em `/auth/me`: 2 queries (DUserGroup+DEntidade JOIN + DVincula findFirst)
- N+1 ZERO em RBAC queries: RoleResolverService com LRU cache TTL 5min
- `getMe` performance: ≤3 queries verificado com DATABASE_LOGGING=true

### Tests
- 78 unit tests PASS (12 suites: auth.service, api-key.service, role-resolver.service, refresh-token.service, auth-composite.guard, roles.guard + F2 carryover)
- Todos os bloqueadores DoD verificados: build clean, TypeScript 0 erros, ESLint 0 warnings, Swagger 100%, JSDoc completo
- Refresh token reuse detection testado: token antigo vira inválido após rotate
- Bcrypt rounds = 12 (constante explícita com comentário ADR)
- Senha NUNCA logada (grep confirmado)

### Security
- Bcrypt rounds ≥ 12 para hash de senha (ADR-V2-004)
- API Key plaintext retornado UMA VEZ ao criar (nunca reexibido)
- MCP Key hash duplicado em DUserGroup.dados com sync em transaction
- Refresh token rotativo com reuse detection (detecta e revoga ao ver token antigo)
- Sem `console.log` no código auth (grep confirmado)

---

### Added (F2 Pilar 2 — Endpoints Genéricos)
  - `EntidadeController` + `EntidadeService` — CRUD completo `/api/v1/entidades` (GET/POST/PATCH/DELETE) com cursor pagination, soft-delete, N+1 ZERO (include com JOIN), BigInt serializado, Swagger 100%, JSDoc completo
  - `TabelaController` + `TabelaService` — CRUD completo `/api/v1/tabelas` com filtro `dEntidadeId`, cursor pagination, soft-delete
  - `ClasseController` + `ClasseService` — Read-only `/api/v1/classes` + `GET /classes/tree` (1 query + Map em memória, ZERO N+1), bloqueio 403 explícito para POST (classes do seed — imutáveis via API)
  - Infraestrutura comum: `ParseBigIntPipe` + `ParseOptionalBigIntPipe` (conversão segura string → bigint), `@SkipGuard()` decorator placeholder (F3 substitui por JwtAuthGuard), LRU cache genérico (max 200 entradas, TTL 5min) para alias `?classe=NOME`
  - **ADR-V2-015 implementado:** `?idClasse=N` canônico V2; `?classe=NOME` aceito com headers `Deprecation: true` e `Sunset: 2026-06-05T00:00:00.000Z` por 2 sprints (sunset em 2026-06-05); ambos simultaneamente → 400 BadRequest
  - Audit inline via DEvento -497 em `criar()` para entidades (placeholder até F7 EventProducerService)
  - Método canônico `getEntidadeIdFromUserGroup(userGroupId)` — Pattern #5 Devari-Core, pré-requisito de F3
  - Helper canônico `createSeller(dto)` — template para criação de sellers com conta virtual em transaction, ready para uso futuro

### Performance

- N+1 ZERO: todas as listagens usam `include: { classe }` (JOIN no banco), `getTree` = 1 `findMany` + Map em memória (O(n) linear)
- Cursor pagination em todas as listagens (não usa offset ineficiente)

### Tests

- 43 unit tests novos passando (meta mínima: 26)
  - `src/entidades/entidades.service.spec.ts` — 8 specs
  - `src/tabelas/tabelas.service.spec.ts` — 6 specs
  - `src/classes/classes.service.spec.ts` — 4 specs
  - `src/common/pipes/parse-bigint.pipe.spec.ts` — 5 specs
  - `src/common/helpers/lru-cache.spec.ts` — 3 specs
  - `prisma/seeds/__tests__/validate-hierarchy.spec.ts` — 12 specs (carryover F1, incluso em contagem)

### Technical Debt

- `[TECH-DEBT/F3]` `PaginationMetaDto` em `src/entidades/dto/` — mover para `src/common/dto/pagination-meta.dto.ts` para quebrar dependência cruzada `TabelasModule → EntidadesModule`
- `[TECH-DEBT/F3]` `formatTabelaResponse` inline em `tabelas.service.ts` — mover para `src/tabelas/helpers/format-tabela-response.ts`
- `[TECH-DEBT/F3]` `validarClasse` duplicada em `EntidadeService` e `TabelaService` — extrair para `src/common/helpers/validate-classe.ts` ou injetar `ClasseService`
- `[TECH-DEBT/F3]` `ParseBigIntPipe` não aplicado em `@Param('id')` dos 3 controllers — aplicar em F3
- `[ADR/F3]` Redigir ADR-V2-025 (BigInt serialization strategy: interceptor global vs por-módulo)
- Cache de `validarClasse` em memória (Map imutável no `onModuleInit`) — implementar em F3 (15 linhas)
- `?classe=NOME` removal — sunset em 2026-06-05, remover wrapper em F3/F5 se não tiver uso

### Generator Impact

- 3 controllers genéricos (`EntidadeController`, `TabelaController`, `ClasseController`) com cursor pagination + soft-delete + Swagger 100% + ADR-V2-015 compat wrapper são **candidatos a entrar no Devari-Core v3.0** como módulos base reutilizáveis
- Registrado em `docs/lessons/issues-evolution-from-v2.md` com label `evolution-candidate`

---

- **F1 Pilar 3 — Schema canonico + Seed de DClasses** (Task #1, V2 F1)
  - 17 tabelas canonicas Devari-Core no `prisma/schema.prisma` com 4 relations FK adicionadas pre-F1 (DTask.assignee, DTask.creator, DProject.estab, DPedido.locEscritu) + reversas em DEntidade (`tasksAssigned`, `tasksCreated`, `projetos`, `pedidosAsLocEscritu`).
  - Migration inicial `prisma/migrations/20260508204157_initial_canonical/migration.sql` (17 CREATE TABLE + FKs).
  - **128 DClasses** seedadas em `prisma/seeds/classes.seed.ts` (45 fixas Devari-Core via spread de `templates/classes-base-template.ts` + 83 especificas Scrumban-V2 no range -150..-527).
  - Validador puro `prisma/seeds/validate-hierarchy.ts` — funcao `validateHierarchy()` com 6 checagens (chave negativa, sem duplicatas, root unico=-1, idPai existe, sem ciclos via DFS O(N), sem sequestro de canonicas Devari-Core -45/-47/-49/-50). Rodado em time de import — falha precoce em `tsc`/`jest`/CI antes de tocar o banco.
  - Helpers exportados: `CANONICAL_RESERVED`, `FIXED_RANGE_MIN`, `FIXED_RANGE_MAX`, `isInFixedRange()` para auditoria externa.
  - Seed-runner `prisma/seeds/seed-runner.ts` — UPSERT atomico em `prisma.$transaction` (idempotencia forte, drift detection); modo `--dry-run` para CI offline; logs estruturados.
  - 6 ADRs MADR canonicos em `docs/decisions/`: ADR-V2-019 (seed monolitico vs particionado), ADR-V2-020 (UPSERT idempotente em transacao), ADR-V2-021 (validador puro testavel), ADR-V2-022 (renumeracao corte limpo, ratifica ADR-V2-002), ADR-V2-023 (4 relations FK pre-F1), ADR-V2-024 (console.log cirurgico em prisma/seeds/).
  - Auditoria documental `docs/SCHEMA-CANONICO-AUDITORIA.md` (253 linhas, 17 tabelas + dump das 128 classes + mapeamento V2).
  - Metricas Generator (ADR-V2-017): `docs/lessons/metrics-fase-1.md`.
  - Pilares: P3 ATIVADO PLENAMENTE; P1 preparado (DPedido -300..-303 + DVFS -91..-95 prontos para F6); P2 fora de escopo F1.
  - ADRs: ADR-V2-019, ADR-V2-020, ADR-V2-021, ADR-V2-022, ADR-V2-023, ADR-V2-024.

### Changed

- `prisma/schema.prisma` — 4 relations FK acrescentadas para integridade referencial completa (justificativa em ADR-V2-023; nao infringe ADR-V2-001 — zero tabela nova).
- `package.json` — bloco `"prisma": { "seed": "ts-node prisma/seeds/seed-runner.ts" }` adicionado; `jest.rootDir` migrado de `"src"` para multi-roots `["<rootDir>/src", "<rootDir>/prisma/seeds"]` para descobrir specs do validador; `coverageDirectory` ajustado para `"./coverage"`.

### Performance

- Seed: 1a execucao **948ms** / 2a execucao **149ms** (idempotencia forte via UPSERT em transacao).
- Validador: O(N) DFS amortizado com 1 unica passada por elemento; falha em milissegundos sobre 128 classes.
- Smoke test integrado total: ~5s (excluindo docker compose startup).

### Tests

- 12 unit tests em `prisma/seeds/__tests__/validate-hierarchy.spec.ts` (vs 6 minimos do DoD-08), 100% PASS:
  1. arvore valida (classesFixas)
  2. ciclo direto A->B->A
  3. ciclo indireto A->B->C->A
  4. idPai inexistente
  5. sequestro de canonica reservada (-47)
  6. chave duplicada
  7. chave positiva
  8. root duplicado
  9. root com chave != -1
  10. exporta CANONICAL_RESERVED com 5 chaves
  11. array vazio
  12. expoe FIXED_RANGE_MIN/MAX e isInFixedRange para validacoes externas

### Security

- ZERO tabela nova fora das 17 canonicas (ADR-V2-001 enforcing via `enforce-canonical-tables.sh`).
- ZERO sequestro de DClasses canonicas Devari-Core (-45/-47/-49/-50 livres para uso fintech; validador bloqueia em time de import).
- Convencao chave negativa (seeds) vs positiva (runtime) preservada — validador rejeita chave positiva no seed.

---

**Maintained by:** Documenter Agent V2 (Scrumban-Backend-V2)
