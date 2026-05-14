# Implementer Agent Memory — Scrumban-Backend-V2

**Versão:** 2.2 (F13 Cliente — Agent monorepo scaffolding — 2026-05-12)
**Última atualização:** 2026-05-12

**Notas por fase:**
- F11 MCP Expansion Task #1 (`get_task`): ver `mcp-expansion-task1-gotchas.md` — append-only no construtor do router (configService SEMPRE último), 2 testes em `mcp-block-d.spec.ts` ganham 1 `undefined` a cada nova tool, `schema-consistency.spec.ts` salvaguarda drift JSON↔classe; `McpUserContext` NÃO tem organizationId; NotFoundException/ForbiddenException propagam como exception (use `rejects.toThrow` em specs, não `result.error`).
- F11 MCP Expansion Task #2 (`update_task`): ver `mcp-expansion-task2-gotchas.md` — UMA tool orquestra 3 métodos do TasksService (`update` → `updateSprint` → `updateStatus` → `findOne` para snapshot final). `accessibleProjectIds` resolvido UMA vez e propagado para todas as calls. `assigneeId === null` no MCP traduz para `''` no DTO (semântica "limpar"). `priority === null` permitido para limpar. `anyOf` no schema documenta mas handler precisa enforcement próprio (`at least one field to update`). 17 testes; total MCP 78 passing.
- F11 MCP Expansion Task #5 (`list_members`): ver `mcp-expansion-task5-gotchas.md` — `ProjectMembersService.getMembers(projectId)` NÃO aceita `accessibleProjectIds` (legacy HTTP signature). Tenant gate fica na própria tool: resolver `accessibleProjectIds` → checar `includes(projectId)` → senão NotFoundException com mensagem idêntica (anti enumeration). Padrão "gate na tool" reaplicável para Tasks #6/#7/#8. 7→8 tools; 78→87 testes.
- F11 MCP Expansion Task #6 (`get_project`): ver `mcp-expansion-task6-gotchas.md` — UMA tool com `include[]` opcional (`members` | `sprints` | `stats`); sem include retorna só projeto base. Composição condicional do payload (NUNCA setar key com `undefined`). `getStats` chama `findOne` internamente — duplo gate aceitável. `tool-params.ts` NÃO tem helper p/ string array — validar inline com `Array.isArray` + `Set`. Test de paralelização via `callOrder` + `setImmediate` (assertion: todos `:start` antes de qualquer `:end`). Sprints via `tabelaService.listarPorClasse({ idClasse: '-400', dEntidadeId: projectId, pageSize: 20 })` (primeira página, sem cursor — paginação delegada à `list_sprints`). 8→9 tools; 87→99 testes (+12). `activity` adiado.
- F7 Eventos Canônicos: ver `f7-eventos-canonicos.md` (CommonModule Global, EventProducer pattern, Engine isolation via type-only import).
- F8 Flow Metrics + Forecast: ver gotchas abaixo (ThroughputService $queryRaw, CFD sem idProject, WipAgeService OnModuleInit).
- F8 Task#2 Search: queryPeople via DVincula (NÃO idEstab). Ver gotchas abaixo.
- F9 Bloco X Reports PDF: gotchas abaixo (pdfkit import, Promise.allSettled, cache payload vs buffer).
- F10 Bloco A Core Channels: gotchas abaixo (DVincula.metaDados vs DTabela.dados, busca de token por hash).
- F10 Bloco B Telegram Webhook: gotchas abaixo (ioredis SET NX sintaxe, fetch nativo multipart, @types/supertest ausente).
- F10 Bloco C Telegram Commands: gotchas abaixo (DProject sem idCreator, filtro de data em memória, var TS6133 em specs).
- F13 Cliente Sub-tarefa 5 (agent/ autossh wrapper + lifecycle): wrapper modular do `autossh` (não inline como no legado) — reconnect com backoff exponencial próprio + circuit breaker 5 crashes/60s → pausa 5min (legado entraria em flap loop dependendo só de systemd `Restart=always`); `isHealthy()` exposto p/ heartbeat; `lifecycle/shutdown.ts` ordena heartbeat → server → autossh → exit (autossh por último para drenar in-flight requests). Testes com fake clock + mock de spawn — 17 specs (84/84 total). Gotcha: backoff capeado em maxBackoffMs faz que respawns dentro da janela `crashWindowMs` empilhem timers; ao testar circuit breaker, NÃO faça tick após o crash que abre o circuito (o circuitTimer fica pendente). Decisão: spawn lançando síncrono (ENOENT) entra no MESMO flow de crash — não fail-fast no bootstrap (circuit breaker já protege).
- F13 Cliente Sub-tarefa 6 (install.sh + systemd + CLAUDE.md template): ver `agent_install_gotchas.md` (distribuição OPÇÃO C bundle-relative, `claudeMdPath` em `/root/.claude/CLAUDE.md`, idempotência forte sem `--reinstall`, EnvironmentFile do systemd carrega `ANTHROPIC_API_KEY` de `/etc/scrumban-agent/environment` 0600). ATENÇÃO: pasta `.claude/` dentro de `agent/` é PROIBIDA — toda memória do Implementer vive em `<repo-root>/.claude/agent-memory/implementer/`. `agent/.gitignore` ignora `.claude/` defensivamente.
- F13 Cliente Sub-tarefa 1 (agent/ scaffolding): coexistência ESLint do agent com flat config raiz — ver `agent-monorepo-eslint-coexistence.md`. Resumo: agent/ usa ESLint v9 + flat config local; root adicionou `agent/**` em ignores. PostToolUse hook valida cada arquivo via `cd dir_do_package_json && npx eslint <file>`, então subprojetos precisam de config próprio para evitar warning "File ignored". `node_modules` e `dist` do agent já cobertos pelo `.gitignore` raiz (`**/node_modules`, `dist/`).
- Etapa 4 orphan-workspace (2026-05-14): ver `orphan-pending-invites-etapa4.md` — endpoint `GET /auth/pending-invites` para empty state de user órfão; DTO `PendingInviteForMeDto` em `src/auth/dto/` com 5 campos (`inviteId, orgId, orgName, role, expiresAt` — ZERO leak de `tokenHash/flow/targetUserId/invitedByUserId/email`); método `listPendingInvitesForEmail(email)` em `InvitesService` (2 queries Prisma — `dTabela.findMany` por email + `dEntidade.findMany` IN batch para resolver orgName, ZERO N+1 — `DTabela` NÃO tem relation Prisma para `locEscrituracao`, apenas o escalar `idLocEscrituracao`); circular dep recíproca `AuthModule↔InvitesModule` resolvida com `forwardRef(() => InvitesModule)` no AuthModule.imports + `@Inject(forwardRef(() => InvitesService))` no constructor do AuthController; Logger novo no AuthController; `@AllowOrphan()` libera a rota para órfãos. 8 specs novos (PENDING ok / EXPIRED / expiresAt-passado / ACCEPTED via usedAt / REVOKED / org soft-deleted / lowercase normalization / batch IN dedupe / whitelist sanitização). Gotcha hook: PostToolUse:Edit ESLint trava em qualquer Edit que deixe import não-usado — usar `// eslint-disable-next-line @typescript-eslint/no-unused-vars` como ponte temporária ou agrupar imports+uso num único Edit. Em testes: cast `as unknown as Record<string, unknown>` quando precisar acessar `Object.keys` de DTO (TS2352 bloqueia cast direto).
- Etapa 3 orphan-workspace (2026-05-14): ver `orphan-login-etapa3.md` — `login`/`refresh`/`issueSessionForUser` agora aceitam user sem DVincula e emitem JWT órfão; `getMe()` retorna `isOrphan: boolean` (derivado de `availableOrgs.length === 0`); `UserProfileDto.isOrphan` obrigatório; metaDados do DEvento -501 ganha `orphan: true` (spread condicional, false não serializa); `switch-org` migrou de `JwtAuthGuard` para `AuthCompositeGuard` (carryover M1 da Etapa 2 — `@AllowOrphan` agora é load-bearing ali). Gotcha: `tsconfig.build.json` exclui specs, mas `ts-jest` não — sempre rodar `npx jest` em TODA suite ao tocar DTO obrigatório (TS2741 em mocks inline). Pre-existing failures em `tasks` + `automation` + `ttl-cache` confirmados via `git stash` (commits `5b510c4`).
- Etapa 2 orphan-workspace (2026-05-14): ver `orphan-jwt-allow-orphan-guard.md` — `RequireWorkspaceGuard` injetado no `AuthCompositeGuard` (NÃO APP_GUARD global, pois `AuthCompositeGuard` é route-level via `@UseGuards`, e APP_GUARDs rodam ANTES); `OrgTenantGuard`/`RolesGuard` relaxados para órfão (retornam true ou 403 NO_WORKSPACE); `JwtStrategy.validate` aceita payload sem `organizationId` sem consultar DVincula; `@AllowOrphan()` aplicado em `/auth/me`, `/auth/logout`, `/auth/switch-org`. ADR-V2-040 in-flight (formalização na Etapa 5).
- F13 Task#4 Sub-tarefas 4.3+4.4 (multi-project linking): novos endpoints `POST /agents/:id/projects`, `DELETE /agents/:id/projects/:projectId`, `GET /agents/:id/projects` em `AgentsController`. Já existia `ProjectAgentController` em `/projects/:id/agent` para visão project→agent — endpoints NÃO conflitam (visões inversas; semântica complementar). DVincula -185 é N:N nativo (idLocEscritu=projectId, idEntidade=agentId). Idempotência via check explícito (`findFirst` antes de `create`) sem unique constraint nova (ADR-V2-001). Schema: DVincula usa `metaDados` (não `dados`). RBAC helper privado `requireProjectManagerOrOrgAdmin` replicado de `AgentInstallTokenService` para isolamento de escopo (DRY descartado para não tocar 3 arquivos). `RoleResolverService` injetado no constructor de `AgentsService` — atualizar mocks dos 3 specs existentes (`agents-install`, `agents-heartbeat`, `execution-result.service`). Eventos `agent.project.linked/unlinked` via EventProducerService. PostToolUse:Edit ESLint hook trava em imports ainda não usados — ao adicionar import + endpoint que o consome, agrupar tudo no MESMO Edit (helper privado, body novo, controller handler tudo junto).

---

## INSTRUÇÕES DE USO

- Consultar **ANTES** de codar
- Registrar codepaths, gotchas, padrões após cada task
- Limite ~200 linhas; acima, mover histórico para `agent-memory/implementer/<topic>.md`

---

## CONTEXTO V2

Você implementa código backend NestJS/TypeScript para o **Scrumban-Backend-V2**, refundação canônica do Scrumban legado sob template Devari-Core.

**Repositório:** `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/`
**Stack:** NestJS + TypeScript strict + Prisma + PostgreSQL 15 + BullMQ + Redis
**Build command:** detectar (`make build` se Makefile, senão `npm run build`)
**Hook double-check:** `validate-implementer-build.sh` (SubagentStop) — build DEVE passar antes de retornar.

---

## CODEPATHS V2 OBRIGATÓRIOS

### Engine (Pilar 1 — F6)
- `src/engine/lib/operacao/Operacao.ts` — base abstract: `nova()`, sequence key via PostgreSQL (`nextval`), lifecycle, `erro()`
- `src/engine/lib/operacao/OperacaoPedido.ts` — full workflow (calcula, aprova, grava + scripts DVFS)
- `src/engine/lib/operacao/OperacaoExecucaoClaude.ts` — **V2 ÚNICO Engine** (estende OperacaoPedido; ADR-V2-005)
- `src/engine/lib/dvfs/` — scripts de cálculo (chaves 3, 4, 5, 6, 7)

**Hierarquia OOP** (do Devari-Core):
```
Operacao (abstract)
  ├─ OperacaoPedido (full)
  │   ├─ OperacaoBaixa (não usada V2)
  │   ├─ OperacaoSaque, OperacaoAntecipacao (Dinpayz, não V2)
  │   └─ **OperacaoExecucaoClaude (V2)** ← AQUI estende
  ├─ OperacaoMovDisponivel (não V2)
  └─ OperacaoMovDeposito (não V2)
```

### Endpoints Genéricos (Pilar 2 — F2)
- `src/entidades/entidade.controller.ts` — `GET /entidades?idClasse=X` (DEntidade)
- `src/entidades/entidade.service.ts` — métodos centralizados (`getEntidadeIdFromUserGroup`)
- `src/tabelas/tabela.controller.ts` — `GET /tabelas?classe=X` (DTabela)
- `src/classes/classe.controller.ts` — `GET /classes` (DClasse)

### Seeds (Pilar 3 — F1)
- `templates/classes-base-template.ts` — ~50 fixas (range -1..-110), INTOCADAS
- `prisma/seeds/classes.seed.ts` — spread fixas + ~70 V2-específicas (range -150..-529)
- `prisma/seeds/seed-runner.ts` — entrypoint `prisma db seed`
- `prisma/seeds/dvfs.seed.ts` — scripts DVFS (chaves 3-7) para `OperacaoExecucaoClaude`

### Core
- `src/prisma.service.ts` — extends PrismaClient (NUNCA usar DatabaseService — deprecated)
- `src/common/services/timezone.service.ts` — TODAS filtros de data (`applyDateFilters`, `getPeriodDates`) [F4 ✓]
- `src/common/services/correlation-id.service.ts` — AsyncLocalStorage por request (X-Correlation-Id) [F4 ✓]
- `src/common/services/audit.service.ts` — stub MVP INSERT em DEvento idClasse=-501 [F4 ✓]
- `src/common/middlewares/correlation-id.middleware.ts` — gera/lê X-Correlation-Id [F4 ✓]
- `src/common/interceptors/logging.interceptor.ts` — loga method/path/status/ms [F4 ✓]
- `src/common/filters/http-exception.filter.ts` — padroniza 4xx/5xx com correlationId [F4 ✓]
- `src/common/health/` — checkDb/checkRedis/checkEmail, GET /health público [F4 ✓]
- `src/email/` — EmailModule: SMTP/SendGrid/Resend + 4 templates + AuditService [F4 ✓]
- `src/eventos/core/event-producer.service.ts` — emitir DEvento APÓS persistência

### Codepaths F5
- `src/organizations/` — OrganizationsModule (DEntidade -152 + DVincula -161/-162/-163)
- `src/teams/` — TeamsModule (DEntidade -180 + DVincula -181 + DTabela -475)
- `src/sprints/` — ZERO controller TS; apenas README.md + sprints.module.ts
- `src/workflow-statuses/` — WorkflowStatusesModule (apenas seedDefaults + README)
- `src/projects/` — ProjectsModule (DProject + DVincula -171/-172/-173 + SeedBootstrap)
- `src/tasks/` — TasksModule (DTask + V3 Intentions + identifier atômico DEV-N + state machine)

### Gotchas F4 — Priority DTabela (Task 01 fix 2026-05-12, ADR-V2-034)
- **Priority segue padrão Status V3**: DTabela escopada por projeto (`dEntidadeId=projectId`), idClasse -421..-424. Cada projeto novo precisa das 4 DTabelas via `SeedBootstrapService.seedPrioritiesIfMissing`. Backfill standalone em `prisma/scripts/backfill-priority-tabelas.ts` cobre projetos legados.
- **Helpers em tasks.service.ts**: `resolvePriorityId` (enum→chave), `buildPriorityMap` (batch lookup ZERO N+1), `mapPriorityEnum` (BigInt→enum string), `buildResponse(task, priorityMap?)` (priorityMap opcional para listas).
- **DTOs alinhados com seed**: `CRITICAL` → `URGENT`. Frontend e legado usam URGENT. Sem migration.
- **Update semântica**: `undefined`=não toca, `null`=limpa, `string`=resolve. `priority: string | null` no DTO.
- **Fallback silencioso**: DTabela ausente → `logger.warn` + `null` (não BadRequest). Operador roda backfill.
- **`eslint.config.js` precisa de glob explícito**: `prisma/scripts/**/*.ts` adicionado (junto com `prisma/seeds/**/*.ts`). Sem isso, ESLint ignora e hook bloqueia com warning "File ignored".
- **Hook PostToolUse:Edit dispara ESLint a cada Edit** — ao adicionar `const X = ...` que será usado em Edit subsequente, agrupar a declaração + primeiro uso na mesma Edit. Caso contrário `@typescript-eslint/no-unused-vars` bloqueia.

### Codepaths F6 Task 2 (ExecutionsModule)
- `src/executions/executions.service.ts` — execute() com Engine completo + decisão LOW/MEDIUM/HIGH
- `src/executions/approval-flow.service.ts` — approve() race-safe ($executeRaw) + reject() + rollback()
- `src/executions/approval-flow-sweeper.service.ts` — @Cron EVERY_MINUTE expira awaiting_approval
- `src/executions/execution-history.service.ts` — findMany() cursor pagination ZERO N+1
- `src/executions/claude-runner.service.ts` — STUB F6 (STUB_CLAUDE_FAIL=true para falha)
- `src/executions/guards/execution-access.guard.ts` — membership + ADMIN para approve/reject/rollback
- `src/executions/guards/execution-throttler.guard.ts` — 30 req/min SHA-256(projectId)
- `src/executions/executions.controller.ts` — 8 endpoints Swagger 100%
- `src/engine/dvfs/__tests__/risk-gate-adversarial.spec.ts` — 58 cenários adversariais

### Gotchas F6 (Engine + OperacaoExecucaoClaude)
- **`private readonly logger` em subclasse de Engine** — NÃO redeclarar `logger` como `private` em `OperacaoExecucaoClaude`. `Operacao.ts` já declara `protected readonly logger`. Redeclarar como `private` causa TS2415 (`incorrectly extends base class`). Usar `this.logger` herdado.
- **Scripts DVFS chave=7 no seed** — combinar `pr-auto-open.js` + `notification-dispatcher.js` em wrapper async: `(async function (op) { await prAutoOpen(op); await notificationDispatcher(op); })`. Cada script é uma `async function` nomeada.
- **`dvfs.seed.ts` path relativo** — usar `path.join(__dirname, '..', '..', 'src', 'engine', 'dvfs')` (de `prisma/seeds/` para `src/engine/dvfs/`).
- **Mock DvfsLoaderHelper em testes** — `DvfsLoaderHelper` faz 2 chamadas `findFirst` por chaveScript (idClasse concreto → fallback -300). Mock deve responder ao `where.chaveScript` (não ao `where.idClasse`).
- **R-CHAVE-5 / R-CHAVE-7 são BLOQUEANTES** — testes em `OperacaoPedido.regressao-dvfs.spec.ts`. F6 não fecha sem ambos verdes. Valida que `_funcPosCalculo` (chave 5) e `_funcPosGravacao` (chave 7) são carregados e executados.
- **`OperacaoExecucaoClaude` não reexporta IExecucaoData** — interface é importada de `IExecucaoData.ts` separado. Arquivo `OperacaoExecucaoClaude.ts` importa direto de `../interfaces/IExecucaoData`.
- **`agentTunnelService` é `any` em F6** — STUB. Service retorna mock `{ exitCode: 0, stdout, stderr, headBefore, headAfter, ... }`. F13 tipará corretamente.
- **`ScheduleModule.forFeature()` não existe** — usar `forRoot()` (já no AppModule). Evitar duplicar forRoot() no ExecutionsModule — NestJS singleton.
- **`agentId` deve ser BigInt-convertível** — string numérica ('100'), não 'agent-stub-100'. OperacaoExecucaoClaude faz `BigInt(params.agentId)`.
- **`gravarAposAprovacaoManual()` usa UPDATE** — método adicionado ao Engine em Task 2. Reconstrói state sem nova() e faz dPedido.update(), não create(). Chama `_carregaScriptsGrav()` se scripts não carregados.
- **TRUNCATE promovido para HIGH** — Task 1 tinha TRUNCATE como MEDIUM; Task 2 o moveu para HIGH (25 patterns). Teste OperacaoExecucaoClaude.unit.spec.ts atualizado.
- **risk-gate-adversarial spec em TypeScript** — Jest só reconhece `.spec.ts`. Usar eval IIFE: `eval('(function(){ ' + scriptContent + '; return riskGateValidator; })()')`.
- **race condition em approve()** — `$executeRaw` com WHERE condicional. Se `updated === 0`: outro admin venceu → ConflictException. Não usar findFirst + update sequencial (não race-safe).
- **dPedido.update mock em testes** — `_executarClaude()` → `_atualizarPedidoCompleto()` chama `dPedido.update`. Mock do Prisma em testes deve incluir `dPedido.update: jest.fn()`.

### Gotchas F5 (Blocos C+E+F)
- **zod NÃO está instalado** — não usar `import { z } from 'zod'`. Usar interfaces TypeScript + funções parse helper
- **DTask não tem campo `codigo`** — usar `dados.identifier` para DEV-N identifier (não `DTask.codigo`)
- **Circular dependency AuthModule ↔ OrganizationsModule** — resolver com `forwardRef()` em ambos
- **auth.service.spec.ts** — ao injetar novo service no AuthService, adicionar mock no spec
- **TeamsController multi-prefixo** — usar `@Controller()` sem prefixo + path completo nas rotas
- **auth.service register()** — refatorado para 2 transactions separadas (usuário + org)
- **WorkflowStatusesService.seedDefaults** — usa `-441` (INBOX) como sentinela de idempotência
- **TasksIdentifierService** — receber `PrismaService` via DI mas NÃO armazenar como `private readonly` (TS6138). Usar `constructor(_prisma: PrismaService) {}` pois métodos usam `tx` passado por parâmetro
- **idClasse DProject/DTask** — sem definição explícita no plano; usados -300 e -200 como placeholder. Confirmar com seed real
- **DTask.idStatus → DTabela.chave** — filtrar tasks por status V3 requer buscar DTabela com idClasse=-44X primeiro, depois filtrar DTask.idStatus IN ids
- **Telemetria workSessions** — ao DONE: buscar última session sem endedAt via `.reverse().find(s => !s.endedAt)`
- **OrganizationsService** — `buildResponse` aceita `dados` como parâmetro opcional para evitar double-read

### Gotchas F4
- **`APP_INTERCEPTOR`/`APP_FILTER`** vêm de `@nestjs/core`, NÃO de `@nestjs/common`
- **DTOs TypeScript strict** — campos sem inicializador precisam de `campo!: tipo`
- **`private readonly config` em providers** — se config é usado apenas no construtor e NÃO como propriedade, remover `private readonly` para evitar TS6138
- **DEntidade usa `criadoEm`** (não `chcriacao`) para filtro de data
- **DEvento não tem `idUsuario`** — passar userId em `metaDados` como string
- **TimezoneService depende de `date-fns` + `date-fns-tz`** (não apenas `luxon`)
- **Quando adicionar dependência em Service, atualizar spec** adicionando o provider no módulo de teste

### Codepaths F8 Task#2 (SearchModule)
- `src/search/search.module.ts` — importa AuthModule para guards
- `src/search/search.controller.ts` — GET /search com JwtAuthGuard + OrgTenantGuard
- `src/search/search.service.ts` — Promise.all(queryTasks, queryProjects, queryPeople)
- `src/search/dto/search-query.dto.ts` — SearchQueryDto com MinLength(2)
- `src/search/dto/search-response.dto.ts` — SearchResponseDto + sub-DTOs

### Gotchas F8 Task#2 (Search)
- **queryPeople é via DVincula, NÃO via idEstab** — OrganizationsService.addMember() cria DVincula idClasse in [-161,-162,-163] com idLocEscritu=orgId. DEntidade USER (-150) NÃO tem idEstab apontando para org. Buscar membros: dVincula.findMany({ idLocEscritu: orgId, idClasse: in [...] }) → pegar idEntidade → dEntidade.findMany({ chave: in [...], idClasse: -150 }).
- **queryPeople usa 2 queries** (DVincula + DEntidade) encapsuladas em 1 branch do Promise.all — total 4 queries por request, não 3. Ainda ZERO N+1.
- **people=[] quando DVincula vazio** — testar edge case: se org sem membros, dEntidade.findMany não deve ser chamado (early return).
- **Spec 13 ForbiddenException** — testar com organizationId='' para garantir guard no service (não apenas no guard).
- **Falso-positivo grep eventProducer** — comentário em texto em spec gera match. Não é código funcional — verificar que é apenas comentário.

### Gotchas F8 (Flow Metrics + Forecast — read-only analytics)
- **ThroughputService `$queryRaw` com Prisma.sql** — `IN (${id1}, ${id2})` funciona com valores explícitos. NÃO usar `IN (${arrayDeBigInt})` — Prisma não serializa BigInt[] corretamente no template literal. Expandir manualmente.
- **CFD sem `idProject` em DEvento -498** — DEvento -498 não tem FK para DProject. Filtrar via `metaDados.taskId` (string) comparado ao Set de taskIds do projeto. Fallback via `identificadorExterno`.
- **WipAgeService — OnModuleInit** — carrega mapa de status (DTabela -441..-449) uma vez no boot sem TTL. Em testes, chamar `loadStatusCodes()` manualmente no `beforeEach` após `jest.clearAllMocks()`.
- **PeriodResolver é `@Injectable()`** — deve ser declarado em `providers` do módulo (não é global). ForecastModule reusa o PeriodResolver do FlowMetricsModule via imports (registrar também como provider no ForecastModule).
- **Forecast: WipAgeService não é necessário no ForecastService** — contagem de tasks restantes via `prisma.dTask.count` direto (sem injetar WipAgeService).
- **Monte Carlo Mulberry32** — seed via closure funciona: `let s = seed >>> 0`. Para seeds negativos ou undefined: usar `Math.random` puro (não quebra).
- **Coverage dos controllers** — controllers têm 0% coverage sem testes e2e. Não bloqueia DoD desta task. Testar via request HTTP em integração é responsabilidade de F14.

### Codepaths F9 Bloco X (ReportsModule)
- `src/reports/reports.module.ts` — imports: AuthModule, DashboardsModule, AnalyticsModule, ForecastModule
- `src/reports/reports.controller.ts` — GET /reports/projects/:projectId/pdf + res.end(buffer)
- `src/reports/reports.service.ts` — assembleReportData via Promise.allSettled + TtlCacheService 5min
- `src/reports/pdf-generator.service.ts` — PDFKit 8 seções, sem Prisma, sem Engine
- `src/reports/dto/report-query.dto.ts` — periodDays (1-180), periodFrom, periodTo, includeTasks, includeStakeholderSummary
- `src/reports/dto/project-report-data.dto.ts` — payload completo com warnings[]

### Codepaths F10 Bloco A (ChannelsModule — Core)
- `src/channels/channels.module.ts` — importa EntidadesModule, AuthModule, TasksModule; exporta 4 services; `onModuleInit` verifica CHANNELS_ENABLED
- `src/channels/pairing.controller.ts` — POST /channels/pairing/generate + /link; JwtAuthGuard; converte DUserGroup→DEntidade antes de chamar PairingService
- `src/channels/core/channel-adapter.interface.ts` — ChannelAdapter + InboundMessage (interfaces puras)
- `src/channels/core/pairing.service.ts` — generate() + consume() com $transaction
- `src/channels/core/account-link.service.ts` — findByChat() com query única via metaDados JSONB
- `src/channels/core/message-router.service.ts` — handleInbound() + registerIntentHandler() + IntentHandler interface
- `src/channels/core/command-registry.service.ts` — CommandHandler interface + register() + resolve()

### Gotchas F10 Bloco A (Core Channels)
- **DVincula usa `metaDados` (não `dados`)** — DTabela tem AMBOS (`dados` e `metaDados`); DVincula tem APENAS `metaDados`. Verificar schema.prisma antes de usar campo polimórfico em DVincula. Erro TS2353 sinaliza campo errado.
- **Busca de token por hash usa `findMany` + filter em memória** — não `$queryRaw` — para evitar SQL raw com JSONB path. Seguro porque o conjunto de tokens ativos é pequeno (TTL curto).
- **`chatId` do Telegram é Int64** — SEMPRE `BigInt(chatId)` no ponto de entrada. Nunca `parseInt` ou `Number`.
- **CHANNELS_ENABLED — módulo inerte, não ausente** — quando `!== 'true'`, loga warn mas NÃO lança. Permite que testes importem o módulo sem env var.
- **Mocks de $transaction** — passar callback `(fn) => fn(txMock)`. txMock deve incluir TODOS os models usados dentro da tx (dTabela, dVincula). Se faltar um model no mock, o teste trava.
- **Teste de "fail-safe" gera ERROR no logger** — esperado. O teste verifica que erros de handler são capturados sem propagar. O logger.error aparece no output do Jest mas o teste PASSA.

### Gotchas F10 Bloco B (Telegram Webhook)
- **ioredis SET NX sintaxe** — usar `redis.set(key, '1', 'PX', ttlMs, 'NX')` (PX antes de NX). A assinatura `set(key, value, 'NX', 'PX', ttl)` gera TS2769 no ioredis v5.
- **fetch nativo Node 18+ para multipart** — Construir multipart/form-data manualmente via `Buffer.concat` sem dependência de `form-data`. Projeto usa Node 18+ com fetch global.
- **`@types/supertest` não instalado** — Testes de controller usam TestingModule direto (sem HTTP stack real). Instalar em F14 para testes e2e. Evitar import de supertest em specs existentes.
- **TelegramModule declara AccountLinkService como provider próprio** — Para evitar dependência circular com ChannelsModule (que importa TelegramModule), TelegramModule inclui AccountLinkService, MessageRouterService e CommandRegistryService em seus providers. NestJS cria instâncias separadas (correto).
- **handleText usa $transaction; handleVoice não** — handleText afeta DEvento + DVincula (multi-tabela → $transaction). handleVoice afeta apenas DEvento (tabela única → create direto). Esta distinção é intencional.
- **event-types.ts requer adição manual de novos tipos** — EventProducerService lança BadRequestException se o tipo não estiver em ALL_EVENT_TYPES_SET. Adicionar SEMPRE em event-types.ts antes de emitir novo tipo. F10 Bloco B adicionou TELEGRAM_MESSAGE_RECEIVED e TELEGRAM_VOICE_RECEIVED.
- **isDuplicate retorna false em modo degradado** — Se Redis indisponível, permite processamento (fail-open para deduplicação). Aceitável pois Telegram tem retry limitado. Não lança exceção.
- **TelegramWebhookService.onModuleInit inicializa Redis** — Redis deve ser inicializado apenas se CHANNELS_ENABLED=true. Testes precisam mockar `initRedis` para evitar conexão real.

### Gotchas F10 Bloco C (Telegram Commands)
- **DProject não tem `idCreator`** — Schema de DProject (F5) tem apenas `idClasse`, `idEstab`, `nome`, `descricao`, `dados`. NÃO tem `idCreator`. Para resolver projeto padrão do usuário, buscar por `idEstab = userId` e fallback para projeto mais recente não excluído.
- **`TasksService.findMany` sem filtro de data** — `ListTasksQueryDto` não tem `dateFrom`/`dateTo`. Para handlers que precisam de filtro por período (today/week), buscar com `limit: 100` e filtrar em memória via `TimezoneService.getPeriodDates`. Aceitável pois volume via Telegram é pequeno.
- **`PairingService` deve ser provido no TelegramModule** — `PairHandler` precisa de `PairingService`. Padrão: adicionar ao array `providers` do TelegramModule (mesma abordagem de AccountLinkService, MessageRouterService etc. do Bloco B).
- **Variável não usada em spec gera TS6133** — TypeScript strict rejeita `let service: Type` sem uso em spec, mesmo com `_` prefix. Remover a declaração se não for usada nas asserções.
- **`canHandle` para text livre** — verificar `message.type === 'text' && typeof message.text === 'string' && message.text.length > 0`. Checar `typeof` evita falso positivo com `undefined`.
- **Status de erros em testes são logs esperados** — `logger.error` aparece no output do Jest quando testamos o path de erro. O teste PASSA; o log é comportamento correto do error handling.

### Gotchas F9 Bloco X (Reports PDF)
- **PDFKit import** — `const PDFDocument: new (options?) => PDFKit.PDFDocument = require('pdfkit')` é o único padrão que compila. `import * as PDFDocument from 'pdfkit'` → TS2351 (not constructable). `import PDFDocument from 'pdfkit'` sem esModuleInterop falha. Usar require com tipagem explícita.
- **Promise.allSettled vs Promise.all** — usar allSettled para relatórios: ForecastService lança BadRequestException quando histórico insuficiente (comportamento esperado). allSettled captura e converte em warning; allSettled permite relatório parcial.
- **Cache de payload, não de Buffer** — cachear ProjectReportDataDto (não o Buffer PDF). Buffer é gerado em <500ms; cachear Buffer consumiria mais RAM e impediria personalização futura.
- **res.end(buffer) para PDF binário** — usar Response Express diretamente em vez de StreamableFile do NestJS. StreamableFile não permite setar Content-Disposition facilmente. Anotar parâmetro com @Res() e chamar res.setHeader() + res.end().
- **AnalyticsService exportado via AnalyticsModule** — importar AnalyticsModule no ReportsModule (não apenas AnalyticsService diretamente). AnalyticsModule exporta AnalyticsService e reexporta DashboardsModule.
- **DashboardsModule exporta DashboardsService** — importar DashboardsModule no ReportsModule garante acesso a DashboardsService sem reimportar FlowMetricsModule separadamente.

### Módulos V2 (lista oficial — usar exatamente esses scope names)

`engine | seeds | endpoints | core | auth | eventos | entidades | tabelas | classes | common | channels | mcp | webhooks | automation | executions | flow-metrics | reports | email | permissoes | docs | agents`

**NÃO usar `pagamento` (V2 não é financeiro).**

---

## OS 21 PADRÕES OBRIGATÓRIOS

Skill `devari-backend-patterns` é auto-injetada. Os 21 padrões:

1. **PrismaService** (não DatabaseService)
2. **BigInt** para IDs (não parseInt/Number)
3. **Transactions** (`prisma.$transaction`) em multi-tabela
4. **TimezoneService** para filtros de data (America/Sao_Paulo)
5. **EntidadeService.getEntidadeIdFromUserGroup** (DUserGroup → DEntidade)
6. **N+1 queries: ZERO** (use `include`/`select` JOIN ou batch)
7. **Eventos APÓS persistência** (não antes!)
8. **Decimal(19,4)** para valores monetários (não aplicável intensamente em V2 — Scrumban não é financeiro)
9. **DTOs com class-validator + Swagger**
10. **Guards** em endpoints privados (JwtAuthGuard, ApiKeyGuard, McpKeyGuard, AuthCompositeGuard)
11. **Logger NestJS** (não console.log — eslint bloqueia)
12. **HttpException apropriada** (NotFoundException, ConflictException, BadRequestException, UnauthorizedException)
13. **Padrão Controller** (orquestra, não implementa)
14. **Padrão Service** (lógica de negócio isolada)
15. **EventProducerService + naming** (`order.created`, `entity.created`, `system.audit.log`...)
16. **Cursor pagination** (não offset) + `select` para reduzir payload
17. **Testes unit + integration**
18. **Swagger decorators completos** (@ApiOperation, @ApiResponse, @ApiParam, @ApiQuery, @ApiBody)
19. **Imports organizados** (NestJS → libs externas → services → DTOs → tipos/enums)
20. **Constantes de IDs** apenas no seed (NUNCA hardcoded em services)
21. **Checklist final** antes de marcar pronto

---

## ANTI-PADRÕES V2 (8 + extras)

### Os 8 clássicos
1. **DatabaseService deprecated** — use `PrismaService`
2. **`parseInt(id)`** — use `BigInt(id)`
3. **`setHours()` / UTC manual** — use `TimezoneService`
4. **N+1 queries** (loop com `findFirst`) — use `include`/`select` ou batch
5. **`eventProducer.emit()` antes de persistir** — persista primeiro, emita depois
6. **`prisma.dPedido.create()` direto** — Pilar 1 violado, use `OperacaoExecucaoClaude`
7. **UserController/SprintController/StatusController** — Pilar 2 violado, reusar `/entidades` `/tabelas`
8. **Seed faltando** — Pilar 3 violado, sistema não inicia

### Extras V2
9. **Modelo novo no schema.prisma** (qualquer fora das 17) → hook `enforce-canonical-tables.sh` bloqueia
10. **Coluna nova em tabela canônica sem ADR** → use `dados`/`metaDados` Json ou redija ADR-V2-XXX
11. **Sequestro de DClasse canônica (-40, -45, -47, -49, -50, -1..-110)** → renumerar para -150..-529
12. **Engine em cadastro estrutural** (DEntidade/DTask/DProject/DTabela) → use Service + Prisma direto
13. **Chave POSITIVA no seed** → seeds são SEMPRE chaves negativas
14. **`role` enum em DUserGroup** → RBAC via DVincula + idClasse (-161/-162/-163, -171/-172/-173)
15. **DProjectMember/DNotification/DWebhook/DAgent/DExecution** → eliminadas; use canônicas

---

## REGRA V2 ABSOLUTA: ENGINE APENAS EM DPedido idClasse=-300

```typescript
// CORRETO — F6 e F13
import OperacaoExecucaoClaude from 'src/engine/lib/operacao/OperacaoExecucaoClaude';

const op = new OperacaoExecucaoClaude({
  usuario: userId.toString(),
  classe: '-301',  // ou -302/-303 conforme Risk Gate
  bd: this.prisma
});
await op.nova();
op.pedidoCab.setDados({ command, riskLevel, category });
await op.calcula();
await op.aprova({ aprovador: userId.toString() });
await op.grava();

// ERRADO — Engine para criar Org/Project/Task estrutural
const op = new OperacaoExecucaoClaude({ classe: '-152', ... });  // -152 = ORGANIZATION
// ❌ Org é DEntidade estrutural; criar com Service + Prisma direto
```

**Cadastros estruturais (DEntidade/DTask/DProject):**
```typescript
// CORRETO — Service + Prisma + transaction
return await this.prisma.$transaction(async (tx) => {
  const org = await tx.dEntidade.create({ data: { idClasse: -152n, nome: dto.nome, ... } });
  // criar vínculo Org-User como ADMIN (DVincula idClasse=-161)
  await tx.dVincula.create({ data: { idClasse: -161n, idLocEscritu: org.chave, idEntidade: userId } });
  return org;
});
```

---

## DVFS — CHAVES DE SCRIPT

Para `OperacaoExecucaoClaude` (F6), DVFS na tabela tem 5 chaves de script:

| Chave | Momento | Propósito V2 |
|-------|---------|--------------|
| 3 | Pré-cálculo | Validar comando, classificar risco (Risk Gate) |
| 4 | Cálculo | Calcular custos estimados, prazo |
| 5 | Pós-cálculo | Ajustes finais antes de aprova |
| 6 | Pré-gravação | Validar aprovador (HIGH precisa aprovação manual) |
| 7 | Pós-gravação | Side-effects (DEvento -496 EXECUTION_LOG, fila BullMQ para executar) |

**ATENÇÃO bug latente:** auditoria detectou risco `s.id` vs `s.chave` em `_carregaScriptsCalc` e `_carregaScriptsGrav`. F6 DoD obrigatório com 2 testes regressivos adversariais bloqueantes (ver ADR-V2-007 e §5 plano-mestre).

---

## BUILD DINÂMICO

```bash
if [ -f Makefile ] && grep -q "^build:" Makefile; then
  make build
else
  npm run build
fi

npx tsc --noEmit  # 0 errors obrigatório
npx eslint src/ --ext .ts --max-warnings 0  # 0 errors
```

Hook `validate-implementation.sh` (Stop, 180s) executa build automático.
Hook `validate-implementer-build.sh` (SubagentStop) double-check antes de retornar à conversa principal.

---

## CONVENÇÃO DE QUERY V2 (ADR-V2-016 a ratificar)

- `?classe=NOME` (string, ex: `?classe=SPRINT`) — convenção PRIMÁRIA do TabelaController herdada
- `?idClasse=N` (numérico, ex: `?idClasse=-400`) — wrapper de compatibilidade aceito por 2 sprints, depois deprecated

EntidadeController aceita ambos hoje:
- `GET /entidades?idClasse=-150&nome=Joao&page=1&pageSize=10` (USER)
- `GET /entidades?idClasse=-152` (ORGANIZATION)

---

## GOTCHAS V2 CONHECIDOS

- **`jsonb_set` para identifier público (DEV-N):** usar raw UPDATE + RETURNING dentro de transação. 10-thread test obrigatório (concorrência).
- **F13 command injection:** TDD com 58 testes adversariais ANTES do código (whitelist + AST + regex em camadas).
- **F13 SSH reverso:** TOFU + HMAC nos comandos; rotação de chaves.
- **F1 hierarquia idPai do seed:** validator automatizado (todos `idPai` existem); peer-review obrigatório.
- **F15 cutover:** 3 ensaios cronometrados em staging; abort policy às 04:00.
- **TypeScript com Prisma BigInt:** uso de `BigInt(id)` em wheres e tipos. Nunca `as any`.
- **TS2564 em DTOs (strictPropertyInitialization):** tsconfig tem `strict: true`. DTOs de resposta sem construtor precisam de `!` em todos os campos obrigatórios (ex: `chave!: string`).
- **Prisma Json + Record<string, unknown>:** Campos Json do Prisma exigem cast `as Prisma.InputJsonValue`. `Record<string, unknown>` não é compatível diretamente.
- **Windows: `make` não disponível** — usar `npm run build` diretamente. `make build` falha com "command not found".
- **npm install necessário** antes do primeiro build (node_modules não commitado).
- **ESLint path para scan:** `npx eslint "src/**/*.ts" --max-warnings 0` (com aspas para glob no Windows).

## CONVENÇÃO ADR-V2-015 IMPLEMENTADA (F2)

**Canônico:** `?idClasse=-150` → BigInt direto, sem log
**Deprecated:** `?classe=USER` → LRU cache (TTL 5min) + Logger.warn + headers `Deprecation: true`, `Sunset: 2026-06-05`
**Ambos:** → 400 BadRequest
**Nenhum:** → 400 BadRequest
**Sunset date:** 2026-06-05 (2 sprints a partir de F2)

## F2 IMPLEMENTADO — ESTRUTURA DE ARQUIVOS

```
src/common/pipes/parse-bigint.pipe.ts           # string → bigint, valida ^-?\d+$
src/common/pipes/parse-optional-bigint.pipe.ts  # versão opcional
src/common/decorators/skip-guard.decorator.ts   # TOMBSTONE F3 — não usar; usar @Public()
src/common/helpers/lru-cache.ts                 # LRU genérico max:200 ttl:5min
src/common/dto/pagination-meta.dto.ts           # movida de src/entidades/dto/ em F3
src/common/helpers/validar-classe.helper.ts     # extraída de entidades+tabelas em F3

src/entidades/entidades.service.ts              # 8 métodos (inclui getEntidadeIdFromUserGroup)
src/entidades/entidades.controller.ts           # F3: AuthCompositeGuard + OrgTenantGuard
src/entidades/entidades.module.ts               # F3: forwardRef(AuthModule)

src/tabelas/tabelas.service.ts                  # F3: usa validarClasse helper + formatTabelaResponse
src/tabelas/tabelas.controller.ts               # F3: AuthCompositeGuard + OrgTenantGuard
src/tabelas/helpers/format-tabela-response.ts   # extraída de tabelas.service.ts em F3

src/classes/classes.controller.ts               # F3: AuthCompositeGuard, POST retorna 403
```
- **DEvento.idUsuario aponta para DEntidade.chave (não DUserGroup.chave)** — usar `EntidadeService.getEntidadeIdFromUserGroup(userGroupId)` para conversão.

## F3 IMPLEMENTADO — AUTH + RBAC DUPLO

```
src/auth/auth.module.ts              # JWT + Passport + forwardRef(EntidadesModule)
src/auth/auth.service.ts             # register (tx), login, refresh, logout, getMe, updateMe, deleteMe
src/auth/auth.controller.ts          # 13 endpoints /auth/*, /auth/me/api-key, /auth/me/mcp-key
src/auth/strategies/jwt.strategy.ts  # PassportStrategy JWT
src/auth/guards/jwt-auth.guard.ts    # NÃO lança; @Public() bypass
src/auth/guards/api-key.guard.ts     # X-API-Key; popula req['project']; NÃO lança
src/auth/guards/mcp-key.guard.ts     # X-MCP-Key; NÃO lança
src/auth/guards/auth-composite.guard.ts # OR: MCP→APIKey→JWT; ÚNICO que lança 401
src/auth/guards/org-tenant.guard.ts  # DProject.idEstab + LRU cache (decisão CEO Q1)
src/auth/guards/roles.guard.ts       # DVincula role + LRU cache
src/auth/decorators/public.decorator.ts  # @Public() substitui @SkipGuard()
src/auth/services/role-resolver.service.ts # LRU 1000 entries TTL 5min; N+1 ZERO
src/auth/services/api-key.service.ts # DTabela(-471): generate/validate (SHA-256)/revoke
src/auth/services/mcp-key.service.ts # DTabela(-472) + DUserGroup.dados.mcpKeyHash
src/auth/services/refresh-token.service.ts # rotação estrita; reuse detection

src/permissoes/permissoes.module.ts
src/permissoes/permissoes.controller.ts # @Roles('ADMIN')
src/permissoes/permissoes.service.ts    # CRUD DPermissao
```

**Gotchas F3 críticos:**
- **forwardRef obrigatório** entre AuthModule↔EntidadesModule/TabelasModule/ClassesModule (circular dep)
- **Guards internos NÃO lançam** — apenas retornam false; AuthCompositeGuard é o único que lança
- **Refresh token scan em POST /auth/refresh** — acessa DUserGroup.dados.refreshTokenHash em scan; F14 precisa indexar
- **BCRYPT_ROUNDS = 12** — constante em auth.service.ts
- **bcryptjs** (não bcrypt) está instalado; import `* as bcrypt from 'bcryptjs'`
- **JwtPayload sub/entidadeId/organizationId são strings** (não BigInt) — evita BigInt serialization
- **AuthCompositeGuard** verificar req.user após JwtAuthGuard.canActivate (JWT pode retornar true mas sem user)

---

## ENDPOINTS V2 — 128 a entregar (escopo Scrumban-hoje)

Distribuição por bloco de fases:
- **F2 (genéricos):** /entidades, /tabelas, /classes (~3 controllers cobrem ~50 endpoints lógicos via idClasse)
- **F3 (auth):** /auth/login, /auth/refresh, /auth/me, /users (auth wrapper)
- **F5 (estrutural):** /projects, /tasks, /sprints (wrapper), /workflow-statuses (wrapper)
- **F6 (engine):** /executions
- **F8/F9:** /flow-metrics, /forecast, /reports, /dashboards
- **F10:** /channels, /channels/telegram/webhook
- **F11:** /mcp/* (5 tools)
- **F12:** /webhooks (CRUD config), /webhooks/test
- **F13:** /agents, /agents/{id}/install, /executions (Automation flow)

Contrato HTTP detalhado: `Scrumbam-Backend/docs/API-CONTRACT.md`.

---

## OUTPUT OBRIGATÓRIO

`workspace/implementations/impl-[modulo]-[descricao]-task[N].md`

Modulos válidos = lista no agent file. Lowercase + hífens + prefixo módulo + sufixo task[N].

---

## NOTAS

- Se não achar arquivo do plan: PARAR e pedir à conversa principal. NÃO improvisar.
- Se 3 Pilares estão envolvidos: confirmar que o Strategist redigiu plan (não fazer Fast Mode em F1, F2, F3, F5, F6, F7, F13, F15).
- Se o build quebra apenas com 1 import: checar `tsconfig.json` paths e `package.json` deps.
- Em dúvida arquitetural: NÃO improvisar — pedir ao Strategist via conversa principal.
