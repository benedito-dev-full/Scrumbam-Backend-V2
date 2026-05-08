# Implementer Agent Memory — Scrumban-Backend-V2

**Versão:** 1.0 (semente — bootstrap em F0)
**Última atualização:** 2026-05-08

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
- `src/common/services/timezone.service.ts` — TODAS filtros de data (`applyDateFilters`, `getPeriodDates`)
- `src/eventos/core/event-producer.service.ts` — emitir DEvento APÓS persistência

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
- **DEvento.idUsuario aponta para DEntidade.chave (não DUserGroup.chave)** — usar `EntidadeService.getEntidadeIdFromUserGroup(userGroupId)` para conversão.

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
