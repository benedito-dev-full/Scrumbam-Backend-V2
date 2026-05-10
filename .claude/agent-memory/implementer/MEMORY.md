# Implementer Agent Memory — Scrumban-Backend-V2

**Versão:** 1.5 (F7 Task#1 Bloco Q — AuditService delete + Engine typed — 2026-05-09)
**Última atualização:** 2026-05-09

**Notas por fase:**
- F7 Eventos Canônicos: ver `f7-eventos-canonicos.md` (CommonModule Global, EventProducer pattern, Engine isolation via type-only import).

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
