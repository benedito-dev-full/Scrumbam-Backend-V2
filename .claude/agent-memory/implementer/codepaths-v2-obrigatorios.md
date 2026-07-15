---
name: codepaths-v2-obrigatorios
description: "Codepaths V2 obrigatorios (Engine, seeds, endpoints genericos, core, modulos) — movido do MEMORY.md na compactacao de 2026-07-14."
metadata:
  type: reference
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
