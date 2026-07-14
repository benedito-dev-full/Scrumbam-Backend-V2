---
name: codepaths-gotchas-f3-f10
description: Codepaths e gotchas históricos por fase (F4-F10) — Priority DTabela, Engine/OperacaoExecucaoClaude, Auth/RBAC, Search, Flow Metrics, Reports, Channels/Telegram. Consultar ao tocar esses módulos.
metadata:
  type: project
---

# Codepaths & Gotchas por Fase (F4–F10)

Detalhe movido de `MEMORY.md` para manter o índice enxuto. Consultar ANTES de
codar no módulo correspondente.

## Codepaths F5 (estrutural)
- `src/organizations/` — OrganizationsModule (DEntidade -152 + DVincula -161/-162/-163)
- `src/teams/` — TeamsModule (DEntidade -180 + DVincula -181 + DTabela -475)
- `src/sprints/` — ZERO controller TS; apenas README.md + sprints.module.ts (Sprint revogado ADR-V2-060)
- `src/workflow-statuses/` — WorkflowStatusesModule (apenas seedDefaults + README)
- `src/projects/` — ProjectsModule (DProject + DVincula -171/-172/-173 + SeedBootstrap)
- `src/tasks/` — TasksModule (DTask + V3 Intentions + identifier atômico DEV-N + state machine)

## Gotchas F4 — Priority DTabela (ADR-V2-034)
- **Priority segue padrão Status V3**: DTabela escopada por projeto (`dEntidadeId=projectId`), idClasse -421..-424. Cada projeto novo precisa das 4 DTabelas via `SeedBootstrapService.seedPrioritiesIfMissing`. Backfill em `prisma/scripts/backfill-priority-tabelas.ts`.
- **Helpers em tasks.service.ts**: `resolvePriorityId` (enum→chave), `buildPriorityMap` (batch ZERO N+1), `mapPriorityEnum` (BigInt→enum), `buildResponse(task, priorityMap?)`.
- **DTOs alinhados com seed**: `CRITICAL` → `URGENT`. Frontend e legado usam URGENT. Sem migration.
- **Update semântica**: `undefined`=não toca, `null`=limpa, `string`=resolve. `priority: string | null` no DTO.
- **Fallback silencioso**: DTabela ausente → `logger.warn` + `null` (não BadRequest). Operador roda backfill.
- **`eslint.config.js` precisa de glob explícito**: `prisma/scripts/**/*.ts` (junto com `prisma/seeds/**/*.ts`). Sem isso, ESLint ignora e hook bloqueia "File ignored".
- **Hook PostToolUse:Edit dispara ESLint a cada Edit** — agrupar `const X = ...` + primeiro uso na mesma Edit, senão `no-unused-vars` bloqueia.

## Gotchas F4 (gerais)
- **`APP_INTERCEPTOR`/`APP_FILTER`** vêm de `@nestjs/core`, NÃO `@nestjs/common`.
- **DTOs strict** — campos sem inicializador precisam de `campo!: tipo`.
- **`private readonly config`** — se só usado no construtor, remover para evitar TS6138.
- **DEntidade usa `criadoEm`** (não `chcriacao`) para filtro de data.
- **DEvento não tem `idUsuario`** — passar userId em `metaDados` como string.
- **TimezoneService depende de `date-fns` + `date-fns-tz`** (não apenas `luxon`).
- **Ao adicionar dependência em Service, atualizar spec** (provider no módulo de teste).

## Codepaths F6 Task 2 (ExecutionsModule)
- `src/executions/executions.service.ts` — execute() Engine completo + decisão LOW/MEDIUM/HIGH
- `src/executions/approval-flow.service.ts` — approve() race-safe ($executeRaw) + reject() + rollback()
- `src/executions/approval-flow-sweeper.service.ts` — @Cron EVERY_MINUTE expira awaiting_approval
- `src/executions/execution-history.service.ts` — findMany() cursor pagination ZERO N+1
- `src/executions/claude-runner.service.ts` — STUB F6 (STUB_CLAUDE_FAIL=true)
- `src/executions/guards/execution-access.guard.ts` — membership + ADMIN
- `src/executions/guards/execution-throttler.guard.ts` — 30 req/min SHA-256(projectId)
- `src/executions/executions.controller.ts` — 8 endpoints Swagger 100%
- `src/engine/dvfs/__tests__/risk-gate-adversarial.spec.ts` — 58 cenários adversariais

## Gotchas F6 (Engine + OperacaoExecucaoClaude)
- **`private readonly logger` em subclasse de Engine** — NÃO redeclarar como `private` (Operacao.ts já tem `protected readonly logger`). Redeclarar → TS2415. Usar `this.logger` herdado.
- **Scripts DVFS chave=7 no seed** — combinar `pr-auto-open.js` + `notification-dispatcher.js` em wrapper async `(async function (op) { await prAutoOpen(op); await notificationDispatcher(op); })`.
- **`dvfs.seed.ts` path relativo** — `path.join(__dirname, '..', '..', 'src', 'engine', 'dvfs')`.
- **Mock DvfsLoaderHelper** — 2 `findFirst` por chaveScript (idClasse concreto → fallback -300). Mock responde ao `where.chaveScript`.
- **R-CHAVE-5 / R-CHAVE-7 BLOQUEANTES** — `OperacaoPedido.regressao-dvfs.spec.ts`. Valida `_funcPosCalculo` (5) e `_funcPosGravacao` (7) carregados e executados.
- **`OperacaoExecucaoClaude` não reexporta IExecucaoData** — importa de `../interfaces/IExecucaoData`.
- **`agentTunnelService` é `any` em F6** — STUB retorna mock `{ exitCode: 0, stdout, stderr, headBefore, headAfter }`. F13 tipa.
- **`ScheduleModule.forFeature()` não existe** — usar `forRoot()` (já no AppModule); não duplicar.
- **`agentId` BigInt-convertível** — string numérica ('100'), não 'agent-stub-100'.
- **`gravarAposAprovacaoManual()` usa UPDATE** — reconstrói state sem nova(), dPedido.update(). Chama `_carregaScriptsGrav()` se não carregados.
- **TRUNCATE promovido para HIGH** — Task 2 moveu de MEDIUM (25 patterns).
- **risk-gate-adversarial spec em TS** — eval IIFE: `eval('(function(){ ' + scriptContent + '; return riskGateValidator; })()')`.
- **race em approve()** — `$executeRaw` WHERE condicional. `updated === 0` → ConflictException. NÃO findFirst+update sequencial.
- **dPedido.update mock** — `_executarClaude()`→`_atualizarPedidoCompleto()` chama `dPedido.update`. Incluir no mock.

## Gotchas F5 (Blocos C+E+F)
- **zod NÃO instalado** — usar interfaces TS + parse helpers.
- **DTask não tem `codigo`** — usar `dados.identifier` para DEV-N.
- **Circular dep AuthModule ↔ OrganizationsModule** — `forwardRef()` em ambos.
- **auth.service.spec.ts** — ao injetar novo service, adicionar mock.
- **TeamsController multi-prefixo** — `@Controller()` sem prefixo + path completo nas rotas.
- **auth.service register()** — 2 transactions separadas (usuário + org).
- **WorkflowStatusesService.seedDefaults** — `-441` (INBOX) como sentinela de idempotência.
- **TasksIdentifierService** — receber `PrismaService` como `_prisma` (NÃO `private readonly` → TS6138); métodos usam `tx` por parâmetro.
- **idClasse DProject/DTask** — placeholders -300/-200; confirmar com seed real.
- **DTask.idStatus → DTabela.chave** — filtrar por status V3: buscar DTabela idClasse=-44X primeiro, depois `DTask.idStatus IN ids`.
- **Telemetria workSessions** — ao DONE: última session sem endedAt via `.reverse().find(s => !s.endedAt)`.
- **OrganizationsService.buildResponse** — aceita `dados` opcional (evita double-read).

## Gotchas F3 críticos (Auth + RBAC duplo)
- **forwardRef obrigatório** AuthModule↔EntidadesModule/TabelasModule/ClassesModule (circular dep).
- **Guards internos NÃO lançam** — retornam false; AuthCompositeGuard é o único que lança 401.
- **Refresh token scan em POST /auth/refresh** — DUserGroup.dados.refreshTokenHash em scan; F14 indexa.
- **BCRYPT_ROUNDS = 12** em auth.service.ts.
- **bcryptjs** (não bcrypt); `import * as bcrypt from 'bcryptjs'`.
- **JwtPayload sub/entidadeId/organizationId são strings** (evita BigInt serialization).
- **AuthCompositeGuard** verifica req.user após JwtAuthGuard.canActivate (JWT pode retornar true sem user).

Arquivos F3 (auth/permissoes): guards em `src/auth/guards/` (jwt-auth, api-key, mcp-key, auth-composite [único que lança], org-tenant [LRU], roles [LRU]); services em `src/auth/services/` (role-resolver LRU 1000/5min, api-key DTabela -471 SHA-256, mcp-key DTabela -472 + DUserGroup.dados.mcpKeyHash, refresh-token rotação estrita reuse-detection); `@Public()` substitui `@SkipGuard()`.

## Codepaths F8 Task#2 (SearchModule)
- `src/search/search.module.ts` — importa AuthModule para guards
- `src/search/search.controller.ts` — GET /search com JwtAuthGuard + OrgTenantGuard
- `src/search/search.service.ts` — Promise.all(queryTasks, queryProjects, queryPeople)
- `src/search/dto/search-query.dto.ts` — SearchQueryDto com MinLength(2)

## Gotchas F8 Task#2 (Search)
- **queryPeople via DVincula, NÃO idEstab** — membros: `dVincula.findMany({ idLocEscritu: orgId, idClasse: in [-161,-162,-163] })` → `idEntidade` → `dEntidade.findMany({ chave: in [...], idClasse: -150 })`.
- **queryPeople usa 2 queries** (DVincula + DEntidade) — total 4 por request, ainda ZERO N+1.
- **people=[] quando DVincula vazio** — early return (não chamar dEntidade.findMany).
- **Spec 13 ForbiddenException** — testar com organizationId='' (guard no service).
- **Falso-positivo grep eventProducer** — comentário em spec gera match; verificar que é só comentário.

## Gotchas F8 (Flow Metrics + Forecast — read-only analytics)
- **ThroughputService `$queryRaw`** — `IN (${id1}, ${id2})` com valores explícitos. NÃO `IN (${arrayDeBigInt})` (Prisma não serializa BigInt[]). Expandir manualmente.
- **CFD sem `idProject` em DEvento -498** — filtrar via `metaDados.taskId` vs Set de taskIds; fallback `identificadorExterno`.
- **WipAgeService OnModuleInit** — carrega status (DTabela -441..-449) no boot sem TTL. Testes: `loadStatusCodes()` no beforeEach após clearAllMocks.
- **PeriodResolver é `@Injectable()`** — declarar em `providers`. ForecastModule reusa via imports (+registrar como provider).
- **Forecast: WipAgeService desnecessário** — contagem via `prisma.dTask.count` direto.
- **Monte Carlo Mulberry32** — seed `let s = seed >>> 0`; seeds negativos/undefined → Math.random.
- **Coverage controllers 0% sem e2e** — não bloqueia DoD; e2e é F14.

## Codepaths F9 Bloco X (ReportsModule)
- `src/reports/reports.controller.ts` — GET /reports/projects/:projectId/pdf + res.end(buffer)
- `src/reports/reports.service.ts` — assembleReportData via Promise.allSettled + TtlCacheService 5min
- `src/reports/pdf-generator.service.ts` — PDFKit 8 seções, sem Prisma, sem Engine

## Gotchas F9 Bloco X (Reports PDF)
- **PDFKit import** — `const PDFDocument: new (options?) => PDFKit.PDFDocument = require('pdfkit')`. `import * as` → TS2351.
- **Promise.allSettled vs all** — allSettled: ForecastService lança quando histórico insuficiente; captura em warning, relatório parcial.
- **Cache de payload, não de Buffer** — cachear ProjectReportDataDto.
- **res.end(buffer) para PDF binário** — Response Express direto (StreamableFile não seta Content-Disposition fácil).
- **AnalyticsModule/DashboardsModule** — importar os MÓDULOS no ReportsModule (exportam os services).

## Codepaths F10 Bloco A (ChannelsModule — Core)
- `src/channels/channels.module.ts` — importa Entidades/Auth/Tasks; `onModuleInit` verifica CHANNELS_ENABLED
- `src/channels/pairing.controller.ts` — POST /channels/pairing/generate + /link (converte DUserGroup→DEntidade)
- `src/channels/core/` — channel-adapter.interface, pairing.service ($transaction), account-link.service (metaDados JSONB), message-router.service, command-registry.service

## Gotchas F10 Bloco A (Core Channels)
- **DVincula usa `metaDados` (não `dados`)** — DTabela tem ambos; DVincula só `metaDados`. TS2353 sinaliza campo errado.
- **Token por hash: `findMany` + filter em memória** (não $queryRaw JSONB); seguro pois conjunto ativo é pequeno (TTL curto).
- **`chatId` Telegram é Int64** — SEMPRE `BigInt(chatId)` no ponto de entrada.
- **CHANNELS_ENABLED — módulo inerte, não ausente** — `!== 'true'` loga warn mas NÃO lança.
- **Mocks de $transaction** — callback `(fn) => fn(txMock)`; txMock inclui TODOS os models usados (dTabela, dVincula).
- **Teste "fail-safe" gera ERROR no logger** — esperado; teste PASSA.

## Gotchas F10 Bloco B (Telegram Webhook)
- **ioredis SET NX** — `redis.set(key, '1', 'PX', ttlMs, 'NX')` (PX antes de NX). `set(key,value,'NX','PX',ttl)` → TS2769.
- **fetch nativo Node 18+ multipart** — Buffer.concat manual sem `form-data`.
- **`@types/supertest` não instalado** — controller specs via TestingModule direto; e2e é F14.
- **TelegramModule declara AccountLink/MessageRouter/CommandRegistry como providers próprios** — evita dep circular com ChannelsModule (instâncias separadas, correto).
- **handleText usa $transaction; handleVoice não** — text afeta DEvento+DVincula (multi-tabela); voice só DEvento.
- **event-types.ts requer adição manual** — EventProducerService lança se tipo não em ALL_EVENT_TYPES_SET. F10B adicionou TELEGRAM_MESSAGE_RECEIVED, TELEGRAM_VOICE_RECEIVED.
- **isDuplicate false em modo degradado** — Redis indisponível → fail-open (Telegram tem retry limitado).
- **TelegramWebhookService.onModuleInit** — Redis só se CHANNELS_ENABLED=true; testes mockam `initRedis`.

## Gotchas F10 Bloco C (Telegram Commands)
- **DProject não tem `idCreator`** — resolver projeto padrão por `idEstab = userId` + fallback mais recente não excluído.
- **`TasksService.findMany` sem filtro de data** — buscar `limit: 100` + filtrar em memória via `TimezoneService.getPeriodDates`.
- **`PairingService` provido no TelegramModule** — PairHandler precisa dele (mesmo padrão dos services do Bloco B).
- **Var não usada em spec → TS6133** — remover declaração (nem `_` prefix salva).
- **`canHandle` text livre** — `message.type === 'text' && typeof message.text === 'string' && message.text.length > 0`.
- **`logger.error` em testes de erro** — esperado; teste PASSA.
