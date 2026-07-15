---
name: padroes-engine-dvfs-build-reference
description: Referência permanente — 21 padrões, anti-padrões V2, regra Engine (OperacaoExecucaoClaude), chaves DVFS, build dinâmico, gotchas V2. Muito já vem do skill devari-backend-patterns auto-injetado.
metadata:
  type: project
---

# Padrões / Engine / DVFS / Build — Referência Permanente

Grande parte já é auto-injetada pelos skills `devari-backend-patterns` e
`devari-3-pilares`. Aqui fica o resumo V2-específico movido de `MEMORY.md`.

## 21 padrões obrigatórios (skill devari-backend-patterns)
1 PrismaService (não DatabaseService) · 2 BigInt IDs · 3 $transaction multi-tabela · 4 TimezoneService · 5 EntidadeService.getEntidadeIdFromUserGroup · 6 N+1 ZERO (include/select/batch) · 7 Eventos APÓS persistência · 8 Decimal(19,4) (raro em V2) · 9 DTOs class-validator+Swagger · 10 Guards em endpoints privados · 11 Logger NestJS (não console.log) · 12 HttpException apropriada · 13 Controller orquestra · 14 Service isola lógica · 15 EventProducerService + naming · 16 Cursor pagination + select · 17 Testes unit+integration · 18 Swagger completo · 19 Imports organizados · 20 Constantes de IDs só no seed · 21 Checklist final.

## Anti-padrões V2
**8 clássicos:** DatabaseService deprecated → PrismaService; parseInt → BigInt; setHours/UTC → TimezoneService; N+1 loop → include/batch; emit antes de persistir → depois; `prisma.dPedido.create()` direto → OperacaoExecucaoClaude; User/Sprint/StatusController → reusar /entidades /tabelas; seed faltando → sistema não inicia.
**Extras V2:** 9 modelo novo no schema.prisma → hook `enforce-canonical-tables.sh` bloqueia; 10 coluna nova em canônica sem ADR → `dados`/`metaDados` Json; 11 sequestro de DClasse canônica (-40,-45,-47,-49,-50,-1..-110) → renumerar -150..-529; 12 Engine em cadastro estrutural (DEntidade/DTask/DProject/DTabela) → Service+Prisma; 13 chave POSITIVA no seed → sempre negativa; 14 `role` enum em DUserGroup → RBAC via DVincula+idClasse (-161/-162/-163, -171/-172/-173); 15 DProjectMember/DNotification/DWebhook/DAgent/DExecution → eliminadas, usar canônicas.

## REGRA ABSOLUTA: Engine APENAS em DPedido idClasse=-300/-301/-302/-303
```typescript
// CORRETO — F6/F13
import OperacaoExecucaoClaude from 'src/engine/lib/operacao/OperacaoExecucaoClaude';
const op = new OperacaoExecucaoClaude({ usuario: userId.toString(), classe: '-301', bd: this.prisma }); // -301/-302/-303 conforme Risk Gate
await op.nova();
op.pedidoCab.setDados({ command, riskLevel, category });
await op.calcula();
await op.aprova({ aprovador: userId.toString() });
await op.grava();
```
Cadastros estruturais (DEntidade/DTask/DProject) → Service + Prisma + `$transaction` (NUNCA Engine):
```typescript
return await this.prisma.$transaction(async (tx) => {
  const org = await tx.dEntidade.create({ data: { idClasse: -152n, nome: dto.nome } });
  await tx.dVincula.create({ data: { idClasse: -161n, idLocEscritu: org.chave, idEntidade: userId } }); // ADMIN
  return org;
});
```

## DVFS — chaves de script (OperacaoExecucaoClaude, F6)
| Chave | Momento | Propósito V2 |
|---|---|---|
| 3 | Pré-cálculo | Validar comando, classificar risco (Risk Gate) |
| 4 | Cálculo | Custos estimados, prazo |
| 5 | Pós-cálculo | Ajustes finais antes de aprova |
| 6 | Pré-gravação | Validar aprovador (HIGH = aprovação manual) |
| 7 | Pós-gravação | Side-effects (DEvento -496 EXECUTION_LOG, fila BullMQ) |

**Bug latente:** risco `s.id` vs `s.chave` em `_carregaScriptsCalc`/`_carregaScriptsGrav`. F6 DoD exige 2 testes regressivos adversariais bloqueantes (ADR-V2-007, §5 plano-mestre).

## Build
```bash
if [ -f Makefile ] && grep -q "^build:" Makefile; then make build; else npm run build; fi
npx tsc --noEmit          # 0 errors
npx eslint "src/**/*.ts" --max-warnings 0   # aspas p/ glob no Windows
```
Hooks: `validate-implementation.sh` (Stop 180s), `validate-implementer-build.sh` (SubagentStop).

## Convenção de query V2 (ADR-V2-015/016)
`?idClasse=-150` canônico (BigInt direto); `?classe=NOME` deprecated (LRU 5min + warn + Sunset 2026-06-05). Ambos ou nenhum → 400. EntidadeController aceita ambos (USER -150, ORGANIZATION -152).

## Gotchas V2 conhecidos
- **jsonb_set identifier DEV-N**: raw UPDATE + RETURNING em transação; 10-thread test obrigatório.
- **F13 command injection**: TDD 58 testes adversariais ANTES do código (whitelist+AST+regex).
- **F13 SSH reverso**: TOFU + HMAC; rotação de chaves.
- **F1 idPai do seed**: validator automatizado (todos idPai existem) + peer-review.
- **F15 cutover**: 3 ensaios cronometrados em staging; abort às 04:00.
- **TS2564 DTOs (strictPropertyInitialization)**: `campo!: tipo` em campos obrigatórios sem construtor.
- **Prisma Json**: cast `as Prisma.InputJsonValue` (Record<string,unknown> não compatível direto).
- **Windows**: `make` indisponível → `npm run build`. `npm install` antes do 1º build.

## Endpoints V2 (128 — escopo Scrumban-hoje)
F2 /entidades /tabelas /classes · F3 /auth /users · F5 /projects /tasks /sprints(wrapper) /workflow-statuses(wrapper) · F6 /executions · F8-F9 /flow-metrics /forecast /reports /dashboards · F10 /channels /channels/telegram/webhook · F11 /mcp/* · F12 /webhooks · F13 /agents. Contrato: `Scrumbam-Backend/docs/API-CONTRACT.md`.

---

# Blocos movidos do MEMORY.md (compactacao 2026-07-14)

Verbatim das secoes que viviam no indice (21 padroes, anti-padroes, regra do
Engine, DVFS, build, convencao de query, gotchas, F2/F3, endpoints, output).

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

## NOTAS OPERACIONAIS

- Se não achar arquivo do plan: PARAR e pedir à conversa principal. NÃO improvisar.
- Se 3 Pilares estão envolvidos: confirmar que o Strategist redigiu plan (não Fast Mode em F1, F2, F3, F5, F6, F7, F13, F15).
- Se o build quebra apenas com 1 import: checar `tsconfig.json` paths e `package.json` deps.
- Em dúvida arquitetural: NÃO improvisar — pedir ao Strategist via conversa principal.
- ESLint path para scan no Windows: `npx eslint "src/**/*.ts" --max-warnings 0` (aspas obrigatórias para glob).
